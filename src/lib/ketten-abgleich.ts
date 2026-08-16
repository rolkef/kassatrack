import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { chainSyncUngeklaert } from "@/db/schema/chain-sync";
import { product, storeProduct } from "@/db/schema/katalog";
import type { Basiseinheit } from "@/lib/einheiten";
import { sichereKettenProdukt } from "@/lib/katalog";
import type { DbOderTransaktion } from "@/lib/zugriff";

/**
 * Der Wert, der für einen Feed-Produktcode in `store_product.rohNamen`
 * abgelegt wird — mit Präfix, damit er nie zufällig mit einem echten
 * Anzeigenamen kollidiert.
 */
export function feedSchluessel(feedId: string): string {
  return `feed:${feedId}`;
}

/** Sucht eine Ketten-Zuordnung über den zuvor bestätigten Feed-Produktcode. */
export async function findeStoreProductPerFeedCode(
  db: DbOderTransaktion,
  chainId: string,
  feedId: string,
): Promise<string | null> {
  const schluessel = feedSchluessel(feedId);
  const [zeile] = await db
    .select({ id: storeProduct.id })
    .from(storeProduct)
    .where(and(eq(storeProduct.chainId, chainId), sql`${schluessel} = any(${storeProduct.rohNamen})`))
    .limit(1);

  return zeile?.id ?? null;
}

/**
 * Sucht eine Ketten-Zuordnung über exakten Namen (Groß-/Kleinschreibung und
 * Randleerzeichen bleiben außer Betracht) sowie exakte Menge und Einheit.
 *
 * Kein unscharfes Matching — eine Verwechslung hier schriebe einen Preis
 * unter dem falschen Produkt fest.
 */
export async function findeStoreProductPerName(
  db: DbOderTransaktion,
  chainId: string,
  eingabe: { rohname: string; menge: number; einheit: Basiseinheit },
): Promise<string | null> {
  const normalisiert = eingabe.rohname.trim().toLowerCase();

  const [zeile] = await db
    .select({ id: storeProduct.id })
    .from(storeProduct)
    .innerJoin(product, eq(product.id, storeProduct.productId))
    .where(
      and(
        eq(storeProduct.chainId, chainId),
        eq(product.menge, eingabe.menge),
        eq(product.einheit, eingabe.einheit),
        sql`exists (
          select 1 from unnest(${storeProduct.rohNamen}) as rn
          where lower(btrim(rn)) = ${normalisiert}
        )`,
      ),
    )
    .limit(1);

  return zeile?.id ?? null;
}

export type UngeklaertZeile = {
  id: string;
  chainId: string;
  feedId: string;
  rohname: string;
  menge: number;
  einheit: Basiseinheit;
  letzterPreis: number;
  zuerstGesehenAm: Date;
  zuletztGesehenAm: Date;
};

const UNGEKLAERT_SPALTEN = {
  id: chainSyncUngeklaert.id,
  chainId: chainSyncUngeklaert.chainId,
  feedId: chainSyncUngeklaert.feedId,
  rohname: chainSyncUngeklaert.rohname,
  menge: chainSyncUngeklaert.menge,
  einheit: chainSyncUngeklaert.einheit,
  letzterPreis: chainSyncUngeklaert.letzterPreis,
  zuerstGesehenAm: chainSyncUngeklaert.zuerstGesehenAm,
  zuletztGesehenAm: chainSyncUngeklaert.zuletztGesehenAm,
};

function alsUngeklaertZeile(zeile: Record<string, unknown>): UngeklaertZeile {
  return {
    ...(zeile as Omit<UngeklaertZeile, "letzterPreis" | "einheit">),
    einheit: zeile.einheit as Basiseinheit,
    letzterPreis: Number(zeile.letzterPreis),
  };
}

/**
 * Legt einen Prüflisten-Eintrag an oder frischt ihn auf, falls er (über
 * Kette + Feed-Produktcode) schon existiert. Aktualisiert dabei bewusst nur
 * Anzeigename, Preis und Zeitpunkt — Menge/Einheit ändern sich für denselben
 * Produktcode nicht.
 */
export async function meldeUngeklaert(
  db: DbOderTransaktion,
  eingabe: {
    chainId: string;
    feedId: string;
    rohname: string;
    menge: number;
    einheit: Basiseinheit;
    preis: number;
  },
): Promise<void> {
  await db
    .insert(chainSyncUngeklaert)
    .values({
      id: randomUUID(),
      chainId: eingabe.chainId,
      feedId: eingabe.feedId,
      rohname: eingabe.rohname,
      menge: eingabe.menge,
      einheit: eingabe.einheit,
      letzterPreis: eingabe.preis.toFixed(4),
    })
    .onConflictDoUpdate({
      target: [chainSyncUngeklaert.chainId, chainSyncUngeklaert.feedId],
      set: {
        rohname: eingabe.rohname,
        letzterPreis: eingabe.preis.toFixed(4),
        zuletztGesehenAm: new Date(),
      },
    });
}

/**
 * Die offene Prüfliste, ältester Eintrag zuerst.
 *
 * Die Sortierung ist keine Kosmetik. Ohne `order by` darf Postgres die Zeilen
 * bei jedem Aufruf in einer anderen Reihenfolge liefern, und auf
 * `/produkte/abgleich` löst jede einzelne Zuordnung ein `revalidatePath` aus:
 * Die Liste sortierte sich unter den Händen der Person neu, die sie gerade
 * abarbeitet. Ältestes zuerst, weil dieser Vorrat als Warteschlange gelesen
 * wird — was am längsten liegt, gehört nach oben.
 */
export async function holeUngeklaerte(db: DbOderTransaktion): Promise<UngeklaertZeile[]> {
  const zeilen = await db
    .select(UNGEKLAERT_SPALTEN)
    .from(chainSyncUngeklaert)
    // `id` als zweites Merkmal: Zwei Einträge aus demselben Lauf haben
    // denselben Zeitstempel, und ohne Tiebreak wäre ihre Reihenfolge
    // untereinander wieder dem Zufall überlassen.
    .orderBy(asc(chainSyncUngeklaert.zuerstGesehenAm), asc(chainSyncUngeklaert.id));

  return zeilen.map(alsUngeklaertZeile);
}

export async function verwerfeUngeklaert(db: DbOderTransaktion, ungeklaertId: string): Promise<void> {
  await db.delete(chainSyncUngeklaert).where(eq(chainSyncUngeklaert.id, ungeklaertId));
}

/**
 * Bestätigt eine Prüflisten-Zeile als ein bestehendes (oder eben erst
 * angelegtes) Katalogprodukt: legt/findet die Ketten-Zuordnung, trägt
 * Anzeigename **und** Feed-Produktcode in `rohNamen` nach (Lese-Ändere-
 * Schreibe in JS statt SQL-Array-Verkettung, damit keine Dubletten
 * entstehen und die Logik ohne rohes SQL lesbar bleibt), und löscht den
 * Prüflisten-Eintrag.
 */
export async function bestaetigeZuordnung(
  db: DbOderTransaktion,
  eingabe: { ungeklaertId: string; chainId: string; feedId: string; rohname: string; productId: string },
): Promise<void> {
  const storeProductId = await sichereKettenProdukt(db, {
    chainId: eingabe.chainId,
    productId: eingabe.productId,
  });

  const [zeile] = await db
    .select({ rohNamen: storeProduct.rohNamen })
    .from(storeProduct)
    .where(eq(storeProduct.id, storeProductId))
    .limit(1);

  const neueWerte = [eingabe.rohname, feedSchluessel(eingabe.feedId)];
  const vereinigt = Array.from(new Set([...(zeile?.rohNamen ?? []), ...neueWerte]));

  await db.update(storeProduct).set({ rohNamen: vereinigt }).where(eq(storeProduct.id, storeProductId));
  await verwerfeUngeklaert(db, eingabe.ungeklaertId);
}

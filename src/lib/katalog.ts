import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { chain, product, storeProduct } from "@/db/schema/katalog";
import type { Basiseinheit } from "@/lib/einheiten";
import type { DbOderTransaktion } from "@/lib/zugriff";

export type Kette = { id: string; name: string; kuerzel: string };

/**
 * Die Ketten, die KassaTrack vergleicht.
 *
 * Reihenfolge ist Absicht: die beiden Vollsortimenter zuerst, weil dort die
 * meisten Preise entstehen, danach die Discounter. Alphabetisch wäre für
 * niemanden hilfreich.
 */
export const KETTEN = [
  { kuerzel: "billa", name: "Billa", sortierung: 10 },
  { kuerzel: "spar", name: "Spar", sortierung: 20 },
  { kuerzel: "hofer", name: "Hofer", sortierung: 30 },
  { kuerzel: "lidl", name: "Lidl", sortierung: 40 },
  { kuerzel: "penny", name: "Penny", sortierung: 50 },
] as const;

/** Legt fehlende Ketten an. Mehrfach aufrufbar. */
export async function legeKettenAn(db: DbOderTransaktion): Promise<void> {
  for (const eintrag of KETTEN) {
    await db
      .insert(chain)
      .values({ id: randomUUID(), ...eintrag })
      .onConflictDoNothing({ target: chain.kuerzel });
  }
}

export async function holeKetten(db: DbOderTransaktion): Promise<Kette[]> {
  return db
    .select({ id: chain.id, name: chain.name, kuerzel: chain.kuerzel })
    .from(chain)
    .orderBy(asc(chain.sortierung));
}

export type Produkt = {
  id: string;
  name: string;
  marke: string | null;
  menge: number;
  einheit: Basiseinheit;
};

export async function legeProduktAn(
  db: DbOderTransaktion,
  eingabe: { name: string; marke?: string | null; menge: number; einheit: Basiseinheit },
): Promise<Produkt> {
  const [zeile] = await db
    .insert(product)
    .values({
      id: randomUUID(),
      name: eingabe.name.trim(),
      marke: eingabe.marke?.trim() || null,
      menge: eingabe.menge,
      einheit: eingabe.einheit,
    })
    .returning({
      id: product.id,
      name: product.name,
      marke: product.marke,
      menge: product.menge,
      einheit: product.einheit,
    });

  return zeile as Produkt;
}

/**
 * Sucht das Produkt, das dieselbe Ware meint wie die Eingabe.
 *
 * Ohne diese Suche gäbe es den Vergleich nicht, um den es in KassaTrack geht:
 * Wer „Butter, 250 g" einmal bei Billa und einmal bei Spar erfasst, muss beide
 * Male dasselbe Produkt treffen. Entstünden zwei Produkte, stünde je ein Preis
 * daneben, und die Preismatrix hätte nie mehr als eine gefüllte Zeile.
 *
 * Groß-/Kleinschreibung und Randleerzeichen bleiben außer Betracht — im
 * Geschäft tippt man „butter", zuhause „Butter". Menge und Einheit dagegen
 * zählen streng: 250 g und 500 g sind zwei Waren, und ihre Grundpreise dürfen
 * sich nicht in einer Reihe mischen.
 *
 * Bewusst kein Datenbank-Index auf dieser Bedingung und keine
 * Eindeutigkeitsregel: Die Zusammenführung ist eine Annahme über Absicht, keine
 * Tatsache. Plan 3 ordnet über den Strichcode zu und darf diese Annahme dann
 * überstimmen, ohne gegen eine Bedingung zu laufen.
 */
export async function findeProdukt(
  db: DbOderTransaktion,
  eingabe: { name: string; marke?: string | null; menge: number; einheit: Basiseinheit },
): Promise<Produkt | null> {
  const name = eingabe.name.trim().toLowerCase();
  const marke = eingabe.marke?.trim().toLowerCase() || null;

  const [zeile] = await db
    .select({
      id: product.id,
      name: product.name,
      marke: product.marke,
      menge: product.menge,
      einheit: product.einheit,
    })
    .from(product)
    .where(
      and(
        sql`lower(btrim(${product.name})) = ${name}`,
        // `= null` trifft in SQL nie, auch nicht auf NULL. Ein Produkt ohne
        // Marke ließe sich sonst niemals wiederfinden und entstünde bei jeder
        // Erfassung neu.
        marke === null ? isNull(product.marke) : sql`lower(btrim(${product.marke})) = ${marke}`,
        eq(product.menge, eingabe.menge),
        eq(product.einheit, eingabe.einheit),
      ),
    )
    .limit(1);

  return (zeile as Produkt | undefined) ?? null;
}

/**
 * Liefert die Kennung der Ketten-Ausprägung eines Produkts und legt sie an,
 * falls es sie noch nicht gibt.
 *
 * Diese Zeile ist die Klammer, ohne die `schreibeBeobachtung` seit Task 6
 * verweigert: Sie prüft, dass `storeProductId`, `chainId` und `productId`
 * zusammenpassen, weil ein widersprüchliches Tripel den Preis der falschen
 * Kette gutgeschrieben hätte.
 *
 * Erst lesen, dann schreiben, dann noch einmal lesen: Der zweite Versuch fängt
 * den Fall ab, dass zwischen Prüfung und Einfügen jemand anderes dieselbe
 * Zuordnung angelegt hat. `onConflictDoNothing` allein genügte nicht, weil es
 * dann nichts zurückgibt.
 */
export async function sichereKettenProdukt(
  db: DbOderTransaktion,
  eingabe: { chainId: string; productId: string },
): Promise<string> {
  const suche = () =>
    db
      .select({ id: storeProduct.id })
      .from(storeProduct)
      .where(
        and(
          eq(storeProduct.chainId, eingabe.chainId),
          eq(storeProduct.productId, eingabe.productId),
        ),
      )
      .limit(1);

  const [vorhanden] = await suche();
  if (vorhanden) return vorhanden.id;

  const [angelegt] = await db
    .insert(storeProduct)
    .values({ id: randomUUID(), chainId: eingabe.chainId, productId: eingabe.productId })
    .onConflictDoNothing({ target: [storeProduct.chainId, storeProduct.productId] })
    .returning({ id: storeProduct.id });

  if (angelegt) return angelegt.id;

  const [nachgereicht] = await suche();
  if (!nachgereicht) {
    throw new Error(
      `Ketten-Zuordnung für Kette ${eingabe.chainId} und Produkt ${eingabe.productId} ` +
        `ließ sich weder anlegen noch finden.`,
    );
  }
  return nachgereicht.id;
}

export async function holeProdukt(db: DbOderTransaktion, id: string): Promise<Produkt | null> {
  const [zeile] = await db
    .select({
      id: product.id,
      name: product.name,
      marke: product.marke,
      menge: product.menge,
      einheit: product.einheit,
    })
    .from(product)
    .where(eq(product.id, id))
    .limit(1);

  return (zeile as Produkt | undefined) ?? null;
}

/**
 * Täglicher Preisabgleich gegen den aggregierten Datensatz von
 * heisse-preise.io. Läuft im Produktions-Image über
 * `scripts/synchronisiere-ketten.js` (siehe Dockerfile), gestartet von
 * einem Coolify Scheduled Task — kein HTTP-Endpunkt, kein Webhook.
 *
 * `fuehreSyncAus` ist die testbare Kernlogik (nimmt `db` und `abrufen` als
 * Parameter); `main` unten ist nur die dünne Hülle für den echten Lauf.
 */
import { eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { storeProduct } from "@/db/schema/katalog";
import { holeKetten, legeKettenAn } from "@/lib/katalog";
import { findeStoreProductPerFeedCode, findeStoreProductPerName, meldeUngeklaert } from "@/lib/ketten-abgleich";
import { feedMengeZuBasiseinheit, gruppiereNachKette, holeFeed, istKetteAktuell } from "@/lib/ketten-feed";
import { synchronisiereBeobachtungen } from "@/lib/ketten-preise";
import type { DbOderTransaktion } from "@/lib/zugriff";

export type LaufBericht = {
  verarbeiteteKetten: string[];
  uebersprungeneKetten: string[];
  ignorierteKetten: string[];
  neueUngeklaerte: number;
  verworfeneEinheiten: number;
  uebersprungenUnavailable: number;
  geschriebeneBeobachtungen: number;
};

export async function fuehreSyncAus(
  db: DbOderTransaktion,
  abrufen: typeof fetch,
  jetzt: Date,
): Promise<LaufBericht> {
  await legeKettenAn(db);
  const ketten = await holeKetten(db);
  const kettenNachKuerzel = new Map(ketten.map((k) => [k.kuerzel, k]));

  const feed = await holeFeed(abrufen);
  const gruppen = gruppiereNachKette(feed);

  const bericht: LaufBericht = {
    verarbeiteteKetten: [],
    uebersprungeneKetten: [],
    ignorierteKetten: [],
    neueUngeklaerte: 0,
    verworfeneEinheiten: 0,
    uebersprungenUnavailable: 0,
    geschriebeneBeobachtungen: 0,
  };

  for (const feedStore of gruppen.keys()) {
    if (!kettenNachKuerzel.has(feedStore)) bericht.ignorierteKetten.push(feedStore);
  }

  /*
   * Die Schleife läuft über den Katalog, nicht über die Feed-Gruppen: Eine
   * Kette, die der Feed gar nicht führt (aktuell Lidl und Penny), hat keine
   * Gruppe und käme in einem feedgetriebenen Lauf in keiner der drei Listen
   * vor — sie verschwände still aus dem Protokoll. Über den Katalog gezählt
   * fällt sie mit leerem Eintragsarray durch `istKetteAktuell` und wird wie
   * jede ausgefallene Kette als übersprungen vermerkt.
   */
  for (const kette of ketten) {
    const eintraege = gruppen.get(kette.kuerzel) ?? [];

    if (!istKetteAktuell(eintraege, jetzt)) {
      bericht.uebersprungeneKetten.push(kette.kuerzel);
      continue;
    }

    bericht.verarbeiteteKetten.push(kette.kuerzel);

    for (const eintrag of eintraege) {
      if (eintrag.unavailable) {
        bericht.uebersprungenUnavailable++;
        continue;
      }

      const menge = feedMengeZuBasiseinheit(eintrag.quantity, eintrag.unit);
      if (!menge) {
        bericht.verworfeneEinheiten++;
        continue;
      }

      const perFeedCode = await findeStoreProductPerFeedCode(db, kette.id, eintrag.id);
      const storeProductId =
        perFeedCode ??
        (await findeStoreProductPerName(db, kette.id, { rohname: eintrag.name, menge: menge.wert, einheit: menge.einheit }));

      if (!storeProductId) {
        await meldeUngeklaert(db, {
          chainId: kette.id,
          feedId: eintrag.id,
          rohname: eintrag.name,
          menge: menge.wert,
          einheit: menge.einheit,
          preis: eintrag.price,
        });
        bericht.neueUngeklaerte++;
        continue;
      }

      const geschrieben = await synchronisiereBeobachtungen(db, {
        storeProductId,
        chainId: kette.id,
        productId: (await holeProductIdFuer(db, storeProductId))!,
        menge,
        verlauf: eintrag.priceHistory,
      });
      bericht.geschriebeneBeobachtungen += geschrieben;
    }
  }

  return bericht;
}

/**
 * `synchronisiereBeobachtungen` braucht `productId` zusätzlich zu
 * `storeProductId` (dieselbe Redundanz wie in `schreibeBeobachtung` selbst
 * — siehe dortigen Kommentar). Ein einzelner Nachschlag hier ist einfacher
 * als jede aufrufende Stelle das Tripel selbst mitführen zu lassen.
 */
async function holeProductIdFuer(db: DbOderTransaktion, storeProductId: string): Promise<string | null> {
  const [zeile] = await db
    .select({ productId: storeProduct.productId })
    .from(storeProduct)
    .where(eq(storeProduct.id, storeProductId))
    .limit(1);
  return zeile?.productId ?? null;
}

async function main() {
  const datenbankUrl = process.env.DATABASE_URL;
  if (!datenbankUrl) {
    console.error("DATABASE_URL ist nicht gesetzt — Abbruch.");
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: datenbankUrl, connectionTimeoutMillis: 10_000 });
  const db: NodePgDatabase<Record<string, never>> = drizzle(pool);

  try {
    const bericht = await fuehreSyncAus(db, fetch, new Date());
    console.log("Ketten-Sync abgeschlossen:", JSON.stringify(bericht, null, 2));
    if (bericht.uebersprungeneKetten.length === bericht.verarbeiteteKetten.length + bericht.uebersprungeneKetten.length) {
      console.warn("Achtung: keine einzige Kette hatte aktuelle Daten — Feed-Ausfall?");
    }
  } catch (fehler) {
    console.error("Ketten-Sync fehlgeschlagen:", fehler);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  void main();
}

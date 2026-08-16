import { and, desc, eq } from "drizzle-orm";
import { priceObservation } from "@/db/schema/preise";
import { grundpreis, type Menge } from "@/lib/einheiten";
import type { FeedPreisPunkt } from "@/lib/ketten-feed";
import { schreibeBeobachtung } from "@/lib/preise";
import type { DbOderTransaktion } from "@/lib/zugriff";

/**
 * Schreibt fehlende `CHAIN_API`-Beobachtungen für ein zugeordnetes Produkt
 * nach — beim Erstimport die ganze Preishistorie (aber nur an den Tagen mit
 * echter Preisänderung), bei jedem weiteren Lauf nur, was seit der letzten
 * bekannten Beobachtung neu und tatsächlich anders ist. Ein Lauf am selben
 * Tag mit unverändertem Verlauf schreibt nichts — das macht den Sync
 * idempotent, ohne eine eigene Sperre zu brauchen.
 *
 * Liefert die Anzahl neu geschriebener Beobachtungen, fürs Laufprotokoll.
 */
export async function synchronisiereBeobachtungen(
  db: DbOderTransaktion,
  eingabe: {
    storeProductId: string;
    chainId: string;
    productId: string;
    menge: Menge;
    verlauf: FeedPreisPunkt[];
  },
): Promise<number> {
  const [letzte] = await db
    .select({ beobachtetAm: priceObservation.beobachtetAm, grundpreis: priceObservation.grundpreis })
    .from(priceObservation)
    .where(
      and(eq(priceObservation.storeProductId, eingabe.storeProductId), eq(priceObservation.quelle, "CHAIN_API")),
    )
    .orderBy(desc(priceObservation.beobachtetAm))
    .limit(1);

  const letztesDatum = letzte ? letzte.beobachtetAm.toISOString().slice(0, 10) : null;

  // Chronologisch (älteste zuerst) -- der Feed liefert absteigend sortiert.
  const chronologisch = [...eingabe.verlauf].sort((a, b) => a.date.localeCompare(b.date));

  let vorherigerGrundpreis = letzte ? Number(letzte.grundpreis) : null;
  let geschrieben = 0;

  for (const punkt of chronologisch) {
    if (letztesDatum && punkt.date <= letztesDatum) continue;

    const grundpreisWert = grundpreis(punkt.price, eingabe.menge);
    if (grundpreisWert === null) continue;

    // Rundungstoleranz statt strikter Ungleichheit: Zwei Grundpreise, die
    // sich nur durch Gleitkomma-Rauschen unterscheiden, sind derselbe Preis.
    if (vorherigerGrundpreis !== null && Math.abs(grundpreisWert - vorherigerGrundpreis) < 0.00005) {
      continue;
    }

    await schreibeBeobachtung(db, {
      storeProductId: eingabe.storeProductId,
      chainId: eingabe.chainId,
      productId: eingabe.productId,
      quelle: "CHAIN_API",
      preisart: "NORMAL",
      einzelpreis: punkt.price,
      zeilensumme: punkt.price,
      grundpreis: grundpreisWert,
      beobachtetAm: new Date(`${punkt.date}T00:00:00.000Z`),
    });

    vorherigerGrundpreis = grundpreisWert;
    geschrieben++;
  }

  return geschrieben;
}

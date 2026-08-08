import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { chain, product } from "@/db/schema/katalog";
import type { Basiseinheit } from "@/lib/einheiten";
import type { ZugriffsDb } from "@/lib/zugriff";

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
export async function legeKettenAn(db: ZugriffsDb): Promise<void> {
  for (const eintrag of KETTEN) {
    await db
      .insert(chain)
      .values({ id: randomUUID(), ...eintrag })
      .onConflictDoNothing({ target: chain.kuerzel });
  }
}

export async function holeKetten(db: ZugriffsDb): Promise<Kette[]> {
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
  db: ZugriffsDb,
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

export async function holeProdukt(db: ZugriffsDb, id: string): Promise<Produkt | null> {
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

import type { Basiseinheit, Menge } from "@/lib/einheiten";
import { MENGE_OBERGRENZE } from "@/lib/einheiten";

const FEED_URL = "https://heisse-preise.io/data/latest-canonical.json";

export type FeedPreisPunkt = { date: string; price: number };

export type FeedEintrag = {
  store: string;
  id: string;
  name: string;
  price: number;
  quantity: number;
  unit: string;
  bio?: boolean;
  unavailable?: boolean;
  priceHistory: FeedPreisPunkt[];
};

/**
 * Ruft den aggregierten Tagesdatensatz von heisse-preise.io ab.
 *
 * `abrufen` ist injizierbar (wie bei `holeOffProdukt`), damit kein Test
 * echtes Internet braucht. Wirft statt `null` zu liefern — anders als
 * `holeOffProdukt`, das einen Benutzereingabefall behandelt, ist ein
 * kaputter oder unerreichbarer Feed hier ein Grund, den ganzen Sync-Lauf
 * abzubrechen, nicht ihn stillschweigend leer weiterlaufen zu lassen.
 */
export async function holeFeed(abrufen: typeof fetch): Promise<FeedEintrag[]> {
  const antwort = await abrufen(FEED_URL);
  if (!antwort.ok) {
    throw new Error(`Feed-Abruf fehlgeschlagen: HTTP ${antwort.status}`);
  }

  const daten = await antwort.json();
  if (!Array.isArray(daten)) {
    throw new Error("Feed-Antwort ist kein Array — Format hat sich vermutlich geändert.");
  }

  return daten as FeedEintrag[];
}

/** Gruppiert Feed-Einträge nach ihrem `store`-Feld (Kettenkürzel, klein). */
export function gruppiereNachKette(eintraege: FeedEintrag[]): Map<string, FeedEintrag[]> {
  const gruppen = new Map<string, FeedEintrag[]>();
  for (const eintrag of eintraege) {
    const liste = gruppen.get(eintrag.store);
    if (liste) {
      liste.push(eintrag);
    } else {
      gruppen.set(eintrag.store, [eintrag]);
    }
  }
  return gruppen;
}

/** Wie viele Tage ein Eintrag höchstens alt sein darf, um als „frisch" zu zählen. */
export const AKTUALITAETS_TAGE = 3;

/** Welcher Anteil der Einträge einer Kette frisch sein muss. */
export const AKTUALITAETS_ANTEIL = 0.5;

/**
 * Ob eine Kette im Feed noch aktuell beliefert wird.
 *
 * Kein hartcodierter Kettenname — eine Kette, die (wie MPreis 2024) ihren
 * Onlineshop schließt oder die der Feed (wie Lidl/Penny) gar nicht führt,
 * fällt hier automatisch heraus, ohne dass der Code sie kennen muss.
 */
export function istKetteAktuell(eintraege: FeedEintrag[], jetzt: Date): boolean {
  if (eintraege.length === 0) return false;

  const grenze = new Date(jetzt);
  grenze.setUTCDate(grenze.getUTCDate() - AKTUALITAETS_TAGE);

  const frische = eintraege.filter((eintrag) => {
    const datum = eintrag.priceHistory[0]?.date;
    if (!datum) return false;
    return new Date(`${datum}T00:00:00.000Z`) >= grenze;
  });

  return frische.length / eintraege.length >= AKTUALITAETS_ANTEIL;
}

const FEED_EINHEITEN: Record<string, { einheit: Basiseinheit; faktor: number }> = {
  g: { einheit: "G", faktor: 1 },
  kg: { einheit: "G", faktor: 1000 },
  ml: { einheit: "ML", faktor: 1 },
  l: { einheit: "ML", faktor: 1000 },
  stk: { einheit: "STK", faktor: 1 },
  stück: { einheit: "STK", faktor: 1 },
};

/**
 * Wandelt Feed-Menge/-Einheit in unsere Basiseinheit um.
 *
 * Der Feed führt neben Lebensmitteln auch Non-Food (Drogerie, Zubehör) mit
 * fachfremden Einheiten wie „cm", „km" oder „Verpackungseinheit" — dafür
 * liefert diese Funktion `null`, der Aufrufer verwirft den Eintrag dann,
 * statt eine bedeutungslose Menge in den Katalog zu schreiben.
 */
export function feedMengeZuBasiseinheit(quantity: number, unit: string): Menge | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const eintrag = FEED_EINHEITEN[unit.trim().toLowerCase()];
  if (!eintrag) return null;

  const wert = Math.round(quantity * eintrag.faktor);
  if (wert <= 0 || wert > MENGE_OBERGRENZE) return null;

  return { wert, einheit: eintrag.einheit };
}

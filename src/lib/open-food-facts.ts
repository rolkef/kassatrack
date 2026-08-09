import { zerlegeMenge, type Basiseinheit } from "@/lib/einheiten";

export type OffTreffer = {
  name: string;
  marke: string | null;
  menge: number;
  einheit: Basiseinheit;
  bildUrl: string | null;
};

type OffAntwort = {
  status?: number;
  product?: {
    product_name?: string;
    brands?: string;
    quantity?: string;
    image_front_url?: string;
  };
};

/**
 * Fragt Open Food Facts nach einer EAN. Liefert `null` für jeden Fall, in
 * dem kein brauchbarer Datensatz entsteht — nicht gefunden, kein Name, keine
 * zerlegbare Menge —, damit der Aufrufer immer denselben Weg geht wie bei
 * einer völlig unbekannten EAN. Ein Netzwerkfehler ist davon ausdrücklich
 * ausgenommen: Er ist kein „nicht gefunden", sondern ein Grund, es später
 * noch einmal zu versuchen, und wird deshalb weitergereicht.
 *
 * Open Food Facts signalisiert „nicht gefunden" auf zwei Arten, die beide in
 * der Praxis vorkommen: mit `status: 0` bei HTTP 200 (ungültiges Format) und
 * mit echtem HTTP 404 (wohlgeformte, aber unbekannte EAN) — deshalb prüft
 * dieser Code beides.
 */
export async function holeOffProdukt(
  ean: string,
  abrufen: typeof fetch,
): Promise<OffTreffer | null> {
  const antwort = await abrufen(
    `https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,brands,quantity,image_front_url`,
    { headers: { "User-Agent": "KassaTrack/1.0 (https://github.com/rolkef/kassatrack)" } },
  );

  if (!antwort.ok) return null;

  const daten = (await antwort.json()) as OffAntwort;
  if (daten.status === 0 || !daten.product) return null;

  const name = daten.product.product_name?.trim();
  if (!name) return null;

  const zerlegt = zerlegeMenge(daten.product.quantity ?? "");
  if (!zerlegt) return null;

  const marke = daten.product.brands?.split(",")[0]?.trim() || null;

  return {
    name,
    marke,
    menge: zerlegt.wert,
    einheit: zerlegt.einheit,
    bildUrl: daten.product.image_front_url ?? null,
  };
}

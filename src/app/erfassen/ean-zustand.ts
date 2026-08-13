import type { Basiseinheit } from "@/lib/einheiten";
import type { OffTreffer } from "@/lib/open-food-facts";
import type { Produkt } from "@/lib/katalog";

/**
 * Ergebnis der EAN-Auflösung. Liegt außerhalb von `ean-aktionen.ts`, weil
 * diese Datei unter `"use server"` steht — genau wie `zustand.ts` neben
 * `aktionen.ts` in Plan 2.
 */
export type EanErgebnis =
  | { art: "bekannt"; produkt: Produkt }
  | { art: "vorschlag"; kandidat: OffTreffer; ean: string; aehnliche: Produkt[] }
  | { art: "unbekannt" };

export type NeuesProdukt = {
  name: string;
  marke: string | null;
  menge: number;
  einheit: Basiseinheit;
};

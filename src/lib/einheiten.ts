/**
 * Mengenangaben zerlegen und Preise vergleichbar machen.
 *
 * Ohne diese Umrechnung ist jeder Vergleich falsch: 2,49 € für 250 g Butter
 * gegen 3,99 € für 500 g sagt nichts, bevor beides auf dieselbe Einheit
 * gebracht ist.
 *
 * Intern wird alles in Gramm, Milliliter oder Stück gehalten — ganzzahlig,
 * damit Rundungsfehler nicht durch die Datenbank wandern.
 */
export type Basiseinheit = "G" | "ML" | "STK";

export type Menge = { wert: number; einheit: Basiseinheit };

const EINHEITEN: Record<string, { einheit: Basiseinheit; faktor: number }> = {
  g: { einheit: "G", faktor: 1 },
  gr: { einheit: "G", faktor: 1 },
  kg: { einheit: "G", faktor: 1000 },
  ml: { einheit: "ML", faktor: 1 },
  cl: { einheit: "ML", faktor: 10 },
  l: { einheit: "ML", faktor: 1000 },
  stk: { einheit: "STK", faktor: 1 },
  stueck: { einheit: "STK", faktor: 1 },
  stück: { einheit: "STK", faktor: 1 },
  st: { einheit: "STK", faktor: 1 },
};

/** Auf welche Menge sich der Grundpreis bezieht. */
const BEZUG: Record<Basiseinheit, number> = { G: 1000, ML: 1000, STK: 1 };

const BEZUGSNAME: Record<Basiseinheit, string> = { G: "kg", ML: "l", STK: "Stk" };

/**
 * Zerlegt eine Eingabe wie `"250 g"` oder `"1,5l"`.
 *
 * Liefert `null` statt zu werfen, weil das hier ein Benutzereingabefeld ist und
 * eine unverständliche Eingabe kein Ausnahmefall, sondern der Normalfall ist.
 *
 * Lehnt mehrdeutige Dezimaltrennzeichen ab: Ein Punkt mit exakt drei nachfolgenden
 * Ziffern ist die deutsche Tausender-Formatierung (1.234 = 1234), nicht ein Dezimaltrennzeichen.
 */
export function zerlegeMenge(eingabe: string): Menge | null {
  const treffer = eingabe.trim().toLowerCase().match(/^(-?[\d]+(?:[.,]\d+)?)\s*([a-zäöü]+)$/);
  if (!treffer) return null;

  const zahlString = treffer[1];

  // Lehne mehrdeutige Punkte ab: Punkt mit genau 3 Ziffern dahinter, aber nur wenn
  // eine Ziffer vor dem Punkt ungleich null ist (z. B. 1.234, 10.000). Ein Punkt mit
  // Leidzahl null (z. B. 0.750) ist immer ein Dezimaltrennzeichen.
  if (/[1-9]\d*\.\d{3}$/.test(zahlString)) {
    return null;
  }

  const zahl = Number(zahlString.replace(",", "."));
  const gefunden = EINHEITEN[treffer[2]];
  if (!gefunden || !Number.isFinite(zahl) || zahl <= 0) return null;

  return { wert: Math.round(zahl * gefunden.faktor), einheit: gefunden.einheit };
}

/**
 * Preis je Kilogramm, Liter oder Stück.
 *
 * Liefert `null` wenn Gesamtpreis null oder negativ ist, oder wenn die Menge null oder negativ ist.
 * Diese Fälle sind Programmfehler (keine Benutzereingaben). Die nullable Rückgabe zwingt jeden Aufrufer
 * zur Compile-Zeit, mit dem null-Fall umzugehen — das verhindert das stille Fortpflanzen von `Infinity`
 * oder anderen ungültigen Werten weiter in Formatierung und Datenbank.
 */
export function grundpreis(gesamtpreis: number, menge: Menge): number | null {
  if (!Number.isFinite(gesamtpreis) || gesamtpreis <= 0) return null;
  if (!Number.isFinite(menge.wert) || menge.wert <= 0) return null;
  return (gesamtpreis / menge.wert) * BEZUG[menge.einheit];
}

export function formatiereGrundpreis(wert: number, einheit: Basiseinheit): string {
  const zahl = wert.toFixed(2).replace(".", ",");
  return `${zahl} €/${BEZUGSNAME[einheit]}`;
}

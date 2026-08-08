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
 * Zerlegt eine Preiseingabe wie `"2,49"`, `"2.49"` oder `"2,49 €"`.
 *
 * Steht hier und nicht bei der Erfassungsseite, weil es dieselbe Aufgabe ist
 * wie bei `zerlegeMenge`: Eine unverständliche Eingabe ist bei einem
 * Eingabefeld kein Ausnahmefall, sondern der Normalfall — deshalb `null` statt
 * eines geworfenen Fehlers.
 *
 * Das Komma ist bewusst gleichberechtigt: In Österreich schreibt man 2,49, und
 * `Number("2,49")` ergäbe `NaN`. Mehr als zwei Nachkommastellen werden
 * abgelehnt statt gerundet — wer 2,499 eintippt, hat sich vertippt, und eine
 * stille Rundung machte daraus eine Beobachtung, die so nie im Regal stand.
 *
 * Null und negative Beträge sind ebenfalls `null`: Aus ihnen entsteht kein
 * Grundpreis, und die Datenbank lehnt sie über `preis_positiv` ohnehin ab —
 * dort aber als technischer Fehler statt als Satz.
 */
export function zerlegePreis(eingabe: string): number | null {
  const bereinigt = eingabe.replace(/[\s€]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(bereinigt)) return null;

  const zahl = Number(bereinigt);
  return Number.isFinite(zahl) && zahl > 0 ? zahl : null;
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

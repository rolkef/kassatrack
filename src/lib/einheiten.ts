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
 * Obergrenze für die Menge in Basiseinheiten.
 *
 * `product.menge` ist `integer`. Eine Menge darüber ließe sich gar nicht
 * ablegen — der Einfügevorgang bräche mit `integer out of range` ab, nachdem
 * alle Prüfungen durch sind. Eine Menge ist damit nicht bloß groß, sondern
 * keine Menge; deshalb steht die Grenze hier und nicht bei der Erfassung.
 */
export const MENGE_OBERGRENZE = 2_147_483_647;

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

  const wert = Math.round(zahl * gefunden.faktor);
  if (wert > MENGE_OBERGRENZE) return null;

  return { wert, einheit: gefunden.einheit };
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
 *
 * Die Obergrenze ist keine Willkür, sondern die Datenbank: `einzelpreis` und
 * `zeilensumme` sind `numeric(10,4)` und müssen betragsmäßig unter 10^6
 * bleiben. Ohne die Grenze käme `"1234567"` bis in die Schreibphase durch und
 * liefe dort in einen `numeric field overflow` — nachdem Produkt und
 * Ketten-Zuordnung bereits angelegt wären. `PREIS_OBERGRENZE` liegt eine
 * Größenordnung darunter, weil ein Lebensmittelpreis über 100.000 € ohnehin
 * ein Tippfehler ist.
 */
export const PREIS_OBERGRENZE = 100_000;

export function zerlegePreis(eingabe: string): number | null {
  const bereinigt = eingabe.replace(/[\s€]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(bereinigt)) return null;

  const zahl = Number(bereinigt);
  return Number.isFinite(zahl) && zahl > 0 && zahl < PREIS_OBERGRENZE ? zahl : null;
}

/**
 * Obergrenze für den Grundpreis.
 *
 * Ein Grundpreis landet in zwei verschieden weiten Spalten: als
 * `price_observation.grundpreis` in `numeric(12,4)` (unter 10^8) und bei einer
 * Aktion als `offer.preis` in `numeric(10,4)` (unter 10^6). Maßgeblich ist die
 * engere der beiden — sonst hinge es an der Preisart, ob eine Eingabe
 * durchgeht, und eine Aktion liefe in einen Überlauf, wo derselbe Normalpreis
 * angenommen würde.
 *
 * Erreichbar ist die Grenze durchaus: `PREIS_OBERGRENZE` auf ein Gramm ergäbe
 * fast 100 Millionen je Kilo. Eine Ware für eine Million Euro je Kilo ist
 * ohnehin ein Tippfehler.
 */
export const GRUNDPREIS_OBERGRENZE = 1_000_000;

/**
 * Untergrenze für den Grundpreis.
 *
 * Beide Spalten halten vier Nachkommastellen, der kleinste Betrag, den sie
 * darstellen können, ist also 0,0001. Alles darunter wird beim Schreiben auf
 * 0,0000 gerundet und läuft in die Bedingung `preis_positiv` — als technischer
 * Fehler mitten in der Transaktion, obwohl Preis und Menge für sich zulässig
 * waren. Erreichbar ist das über das freie Mengenfeld: 0,01 € auf 1000 kg sind
 * ein Tausendstel Cent je Kilo.
 *
 * Bewusst 0,0001 und nicht 0,00005 (der kleinste Wert, der beim Runden noch
 * überlebt): Ein Grundpreis, der erst durch das Runden entsteht, weicht um bis
 * zur Hälfte von dem ab, was gerechnet wurde. Das ist kein Preis, den jemand
 * vergleichen will.
 */
export const GRUNDPREIS_UNTERGRENZE = 0.0001;

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

/**
 * Der Packungspreis zu einem Grundpreis — die Umkehrung von `grundpreis()`.
 *
 * Gebraucht überall dort, wo aus vergleichbaren Preisen wieder ein Betrag
 * werden soll, den man an der Kassa zahlt: Ein Grundpreis ist € je Kilo, Liter
 * oder Stück, und Grundpreise mehrerer Artikel zu addieren ergibt keinen
 * Eurobetrag, solange die Gebindegrößen auseinandergehen. Erst zurückgerechnet
 * sind die Summanden dieselbe Größe.
 */
export function packungspreis(grundpreis: number, menge: Menge): number {
  return (grundpreis * menge.wert) / BEZUG[menge.einheit];
}

export function formatiereGrundpreis(wert: number, einheit: Basiseinheit): string {
  return `${formatiereBetrag(wert)} €/${bezugsName(einheit)}`;
}

/**
 * Ein Betrag ohne Einheit — für Tabellenspalten, die ihre Einheit einmal im
 * Kopf tragen statt in jeder Zelle.
 *
 * Steht hier neben `formatiereGrundpreis` und nicht in der Tabelle, damit
 * beide dieselbe Zahl gleich schreiben. Zwei Formatierungen, die um eine
 * Nachkommastelle auseinanderlaufen, fielen niemandem auf.
 */
export function formatiereBetrag(wert: number): string {
  return wert.toFixed(2).replace(".", ",");
}

/** „kg", „l" oder „Stk" — worauf sich ein Grundpreis bezieht. */
export function bezugsName(einheit: Basiseinheit): string {
  return BEZUGSNAME[einheit];
}

/**
 * Die Gebindegröße, wie sie am Etikett steht — aus den intern gehaltenen
 * Basiseinheiten zurückgerechnet.
 *
 * Das ist auf der Suchliste kein Beiwerk, sondern das Unterscheidungsmerkmal:
 * `findeProdukt` führt „Butter 250 g" und „Butter 500 g" zu zwei Produkten
 * zusammenzuführen ausdrücklich nicht. Ohne die Größe stünden auf der
 * Trefferliste zwei Zeilen namens „Butter" und die Wahl zwischen ihnen wäre
 * ein Ratespiel.
 *
 * Ab 1000 wird auf die größere Einheit umgestellt: „1 kg" liest sich, „1000 g"
 * muss man umrechnen. Drei Nachkommastellen, weil `zerlegeMenge` auf ganze
 * Basiseinheiten rundet und mehr deshalb nie entstehen kann.
 */
export function formatierePackung(menge: number, einheit: Basiseinheit): string {
  if (einheit === "STK") return `${menge} Stk`;

  const klein = einheit === "G" ? "g" : "ml";
  if (menge < 1000) return `${menge} ${klein}`;

  const gross = (menge / 1000).toFixed(3).replace(/\.?0+$/, "").replace(".", ",");
  return `${gross} ${BEZUGSNAME[einheit]}`;
}

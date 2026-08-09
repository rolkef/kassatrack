/**
 * Median einer Zahlenreihe.
 *
 * Warum Median und nicht Durchschnitt: Ein einzelner Tippfehler bei der
 * Erfassung — 299 statt 2,99 — verschiebt einen Durchschnitt dauerhaft und
 * unauffällig. Der Median ignoriert ihn.
 */
export function median(werte: readonly number[]): number | null {
  // Filtere nicht-endliche Werte (NaN, Infinity, -Infinity) heraus.
  // Sie gehören nicht in eine Ordnung. NaN bei Listengrund führt zuverlässig zu NaN,
  // aber bei 9+ Werten nutzt V8 einen anderen Sortieralgorithmus — NaN bleibt erhalten
  // und die Funktion gibt eine unauffällig falsche normale Zahl zurück.
  // Das ist genau das Risiko, vor dem diese Funktion schützen soll.
  const endlich = werte.filter(Number.isFinite);

  if (endlich.length === 0) return null;

  // Kopie: die Aufrufer übergeben oft Ergebnisse, die sie danach weiter
  // benutzen. Ein sortierendes Nebenwirkungen-Rätsel will hier niemand.
  const sortiert = [...endlich].sort((a, b) => a - b);
  const mitte = Math.floor(sortiert.length / 2);

  return sortiert.length % 2 === 1 ? sortiert[mitte] : (sortiert[mitte - 1] + sortiert[mitte]) / 2;
}

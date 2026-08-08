/**
 * Median einer Zahlenreihe.
 *
 * Warum Median und nicht Durchschnitt: Ein einzelner Tippfehler bei der
 * Erfassung — 299 statt 2,99 — verschiebt einen Durchschnitt dauerhaft und
 * unauffällig. Der Median ignoriert ihn.
 */
export function median(werte: readonly number[]): number | null {
  if (werte.length === 0) return null;

  // Kopie: die Aufrufer übergeben oft Ergebnisse, die sie danach weiter
  // benutzen. Ein sortierendes Nebenwirkungen-Rätsel will hier niemand.
  const sortiert = [...werte].sort((a, b) => a - b);
  const mitte = Math.floor(sortiert.length / 2);

  return sortiert.length % 2 === 1 ? sortiert[mitte] : (sortiert[mitte - 1] + sortiert[mitte]) / 2;
}

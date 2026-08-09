/*
 * Die Farben der App-Hülle.
 *
 * Manifest und Layout müssen sich hier einig sein: `theme_color` im Manifest
 * färbt die Statusleiste der installierten App, `viewport.themeColor` im
 * Layout dieselbe Leiste im Browser. Stehen dort zwei Werte, wechselt die
 * Farbe beim Installieren — und kein Test bemerkt es. Deshalb steht der Wert
 * genau einmal.
 *
 * Die Werte spiegeln Tokens aus `globals.css`. CSS lässt sich nicht
 * importieren; wer dort etwas ändert, ändert es auch hier.
 */

/** `--color-hintergrund` — das Papier, auf dem jede Seite steht. */
export const PAPIER = "#f7fbfb";

/** `--color-marke` — das tiefe Petrol des Icons. */
export const MARKE = "#005860";

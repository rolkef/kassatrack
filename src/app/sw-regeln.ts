/*
 * Was der Service Worker in den Cache legen darf — und warum die Liste so
 * kurz ist.
 *
 * Der Cache-Speicher gehört der Herkunft, nicht der Sitzung. Er überlebt das
 * Abmelden, und der Server erfährt nichts davon, wenn daraus ausgeliefert
 * wird. Eine einmal zwischengespeicherte Verwaltungsseite läge damit auch
 * dann noch auf dem Gerät, wenn der Zugang längst entzogen ist — genau die
 * Handlung, die diese App als Sicherheitsversprechen anbietet.
 *
 * Deshalb gilt: zwischengespeichert wird nur, was ohnehin öffentlich ist und
 * sich unter seiner Adresse nie wieder ändert. Für alles andere gibt es keine
 * Route; solche Anfragen behandelt der Worker gar nicht, sie laufen unberührt
 * ins Netz wie ohne Worker.
 */

/**
 * Verzeichnisse, deren Inhalt unveränderlich ist.
 *
 * Unter `/_next/static/` liegen ausschließlich Bau-Ergebnisse, deren Dateiname
 * den Inhalt hasht: ändert sich der Inhalt, ändert sich der Name. Sie können
 * deshalb gefahrlos dauerhaft liegen bleiben.
 */
const UNVERAENDERLICHE_VERZEICHNISSE = ["/_next/static/"];

/**
 * Einzelne Dateien aus `public/`, die unter festem Namen liegen.
 *
 * Sie sind nicht gehasht, aber sie sind Teil des Precache und tragen dort eine
 * Revision aus dem Bau. Die Liste ist bewusst abgezählt statt als Endungsmuster
 * geschrieben — ein Muster wie „alles auf .png" würde auch eine Seite treffen,
 * die zufällig so endet.
 */
const UNVERAENDERLICHE_DATEIEN = [
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskierbar-512.png",
  "/apple-icon.png",
];

/**
 * Darf diese Adresse in den Cache?
 *
 * @param url Die angefragte Adresse.
 * @param gleicheHerkunft Ob die Anfrage an diese Herkunft geht. Fremde Server
 *   liefern aus, was sie wollen; ihre Antworten kommen nie in den Cache.
 */
export function istUnveraenderlicheDatei(url: URL, gleicheHerkunft: boolean): boolean {
  if (!gleicheHerkunft) return false;

  return (
    UNVERAENDERLICHE_VERZEICHNISSE.some((v) => url.pathname.startsWith(v)) ||
    UNVERAENDERLICHE_DATEIEN.includes(url.pathname)
  );
}

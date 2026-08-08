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
 *
 * Achtung für spätere Änderungen: diese Liste regelt nur die *Laufzeit*-Regel
 * in `sw.ts`. `@serwist/next` legt daneben unabhängig davon **jede** Datei
 * unter `public/` in den Vorlade-Speicher (`precacheEntries`) —
 * uneingeschränkt, siehe `@serwist/next/dist/index.mjs:196-208`. Käme dort je
 * eine HTML-Datei hinzu (etwa eine `public/offline.html`), läge sie ab dem
 * nächsten Bau automatisch im Precache, unabhängig von jeder Regel hier, und
 * Serwists Standard-Precache-Route würde eine Navigation dorthin aus dem
 * Cache beantworten. Wer künftig Dateien nach `public/` legt, prüft deshalb
 * nicht nur diese Liste, sondern auch, ob die Datei überhaupt nach `public/`
 * gehört.
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
 * Einzelne Icons, die unter festem Namen liegen.
 *
 * Die ersten drei liegen in `public/`: nicht gehasht, aber Teil des Precache,
 * und sie tragen dort eine Revision aus dem Bau. Der vierte Eintrag ist der
 * Sonderfall — siehe den Kommentar bei ihm. Die Liste ist bewusst abgezählt
 * statt als Endungsmuster geschrieben — ein Muster wie „alles auf .png" würde
 * auch eine Seite treffen, die zufällig so endet.
 */
const UNVERAENDERLICHE_DATEIEN = [
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskierbar-512.png",
  /*
   * Einziger Sonderfall: `apple-icon.png` liegt als Metadaten-Datei des App
   * Routers unter `src/app/`, nicht in `public/` — es ist deshalb **nicht** im
   * Precache und hat auch keine Revision aus dem Bau. Es trägt zudem keinen
   * Hash im Namen (Next hängt es unter festem Pfad ein) und wird hier von
   * `CacheFirst` ohne Ablauf bedient. Ändert sich das Icon, sieht eine bereits
   * installierte App das nie — `CacheFirst` liefert die alte Datei, solange der
   * Cache-Eintrag besteht. Bewusst hingenommen: ein einzelnes, praktisch unveränderliches
   * Bild. Ändert sich das Icon künftig doch, braucht genau diese eine Datei
   * eine eigene Route mit Ablauf (`ExpirationPlugin`) oder `NetworkFirst`
   * statt eines Platzes in dieser Liste.
   */
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

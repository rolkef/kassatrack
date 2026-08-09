import { Serwist, type PrecacheEntry } from "serwist";
import { laufzeitCaching } from "./sw-laufzeit-caching";

/*
 * Der Service Worker.
 *
 * Diese Datei läuft nicht im Browserfenster, sondern in einem eigenen
 * Arbeitsprozess. Serwist bündelt sie beim Bau nach `public/sw.js` und trägt
 * dabei die Liste der vorzuladenden Dateien in `__SW_MANIFEST` ein.
 *
 * Zur Typisierung: `self` wird hier bewusst eng und lokal deklariert statt
 * als `ServiceWorkerGlobalScope`. Dieser Typ steht nur in der TypeScript-
 * Bibliothek „webworker", und die neben „dom" zu laden bringt die halbe
 * Standardbibliothek doppelt ins Projekt. Gebraucht wird ohnehin nur das eine
 * Feld; alles Weitere macht Serwist intern.
 */
declare const self: { __SW_MANIFEST: (PrecacheEntry | string)[] | undefined };

new Serwist({
  /*
   * Vorgeladen wird, was der Bau erzeugt hat: die gehashten Bündel unter
   * `_next/static` und der Inhalt von `public/`. Seiten sind nicht dabei —
   * nicht wegen des CSP-Nonce (das entscheidet nur, ob eine Antwort dynamisch
   * gerendert wird, nicht ob sie vorgeladen werden könnte), sondern weil
   * `@serwist/next` sie beim Bau ausdrücklich ausschließt: Jede kompilierte
   * Seite liegt unter `server/` im Bau-Ergebnis, und dessen Precache-Filter
   * verwirft alles, dessen Name mit `server/` beginnt
   * (`@serwist/next/dist/index.mjs:218`). Das gilt unabhängig davon, ob die
   * CSP je gelockert würde.
   */
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  /*
   * Aus: Navigation Preload beschleunigt nur, wenn der Worker Navigationen
   * auch beantwortet. Das tut er hier absichtlich nicht (siehe unten). Aktiv
   * ließe es den Browser eine Anfrage stellen, die niemand entgegennimmt.
   */
  navigationPreload: false,
  disableDevLogs: true,
  /*
   * Bewusst nur eine Regel, aus `sw-laufzeit-caching.ts` — und ausdrücklich
   * nicht `defaultCache`.
   *
   * `defaultCache` aus `@serwist/next/worker` legt Seiten, RSC-Antworten und
   * GET-Schnittstellen mit „Network First" in den Cache. In einer App, die nur
   * eingeladenen Adressen offensteht, ist das ein Sicherheitsmangel und kein
   * Geschwindigkeitsgewinn: die Verwaltungsseite mit der vollständigen
   * Freischaltliste läge danach im Cache-Speicher, überlebte das Abmelden und
   * würde bei schlechter Verbindung an jede Person am Gerät ausgeliefert.
   *
   * Was hier keine Route trifft, beantwortet der Worker nicht. Solche
   * Anfragen laufen unverändert ins Netz — für jede Seite, jede RSC-Antwort
   * und jeden Aufruf unter `/api/` ist die App also genau so schnell und
   * genau so frisch wie ohne Service Worker.
   *
   * Zwei Tests halten das fest, weil keiner allein reicht:
   * `tests/sw-laufzeit-caching.test.ts` prüft `laufzeitCaching` selbst
   * (isoliert importiert, nicht über diese Datei) — nicht nur gegen
   * `istUnveraenderlicheDatei`, sondern gegen das ganze Feld. Das sagt aber
   * nichts darüber, ob *hier* noch etwas dazukommt. Deshalb prüft
   * `tests/sw-verdrahtung.test.ts` zusätzlich diese Datei als Quelltext: dass
   * `runtimeCaching` eine bloße Referenz auf `laufzeitCaching` bleibt und
   * dass hier kein Import aus `@serwist/next/worker` auftaucht. Wer diese
   * Zeile zu `[...laufzeitCaching, ...defaultCache]` ändert, lässt den einen
   * Test unverändert grün und den anderen rot werden.
   */
  runtimeCaching: laufzeitCaching,
}).addEventListeners();

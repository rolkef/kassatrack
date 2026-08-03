import { CacheFirst, Serwist, type PrecacheEntry } from "serwist";
import { istUnveraenderlicheDatei } from "./sw-regeln";

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
   * `_next/static` und der Inhalt von `public/`. Alles davon ist öffentlich
   * und unveränderlich. Seiten sind nicht dabei — sie können es gar nicht
   * sein, weil jede Antwort dieser App ein frisches CSP-Nonce trägt und
   * deshalb dynamisch erzeugt wird.
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
   * Bewusst nur eine Regel — und ausdrücklich nicht `defaultCache`.
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
   */
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) => istUnveraenderlicheDatei(url, sameOrigin),
      handler: new CacheFirst({ cacheName: "unveraenderliche-dateien" }),
    },
  ],
}).addEventListeners();

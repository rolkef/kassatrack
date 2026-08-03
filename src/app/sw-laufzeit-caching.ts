import { CacheFirst, type RuntimeCaching } from "serwist";
import { istUnveraenderlicheDatei } from "./sw-regeln";

/*
 * Die vollständige Laufzeit-Cache-Konfiguration des Service Workers — in
 * einer eigenen, nebenwirkungsfreien Datei, damit ein Test sie importieren
 * kann, ohne `src/app/sw.ts` mitzuladen. `sw.ts` registriert beim Import
 * echte Ereignis-Listener auf `self`; das setzt eine echte
 * ServiceWorkerGlobalScope voraus, die es in `bun test` nicht gibt. Diese
 * Datei konstruiert nur Werte, sie meldet nichts an.
 *
 * `tests/sw-laufzeit-caching.test.ts` prüft an genau diesem Wert (isoliert
 * importiert, nicht über `sw.ts`), dass er bei genau einer Regel bleibt und
 * dass keine ihrer Regeln je eine angemeldete Seite, eine RSC-Antwort oder
 * eine Schnittstelle trifft — siehe dort für die Begründung, warum das die
 * eine Stelle ist, an der ein Fehler kein Geschwindigkeitsproblem, sondern
 * ein Datenleck wäre. Dass `sw.ts` diesen Wert auch tatsächlich unverändert
 * verwendet — kein Spread, keine zweite Quelle daneben —, prüft ein zweiter,
 * eigener Test: `tests/sw-verdrahtung.test.ts`. Beide zusammen sind nötig:
 * dieser hier kann nicht sehen, was `sw.ts` mit dem Wert anstellt.
 */
export const laufzeitCaching: RuntimeCaching[] = [
  {
    matcher: ({ url, sameOrigin }) => istUnveraenderlicheDatei(url, sameOrigin),
    handler: new CacheFirst({ cacheName: "unveraenderliche-dateien" }),
  },
];

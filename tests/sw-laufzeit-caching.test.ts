import { describe, expect, it } from "bun:test";
import type { RouteMatchCallback, RouteMatchCallbackOptions, RuntimeCaching } from "serwist";
import { laufzeitCaching } from "@/app/sw-laufzeit-caching";

const HERKUNFT = "https://kassatrack.example.at";

/*
 * Dieser Test prüft nicht `istUnveraenderlicheDatei` (das tut bereits
 * `tests/sw-regeln.test.ts`), sondern `laufzeitCaching` selbst — das Feld,
 * das `sw.ts` tatsächlich an `new Serwist({ runtimeCaching: ... })`
 * übergibt. Ein Prädikat kann korrekt sein und trotzdem an der falschen
 * Stelle landen: `runtimeCaching: [...defaultCache, unsereRegel]` etwa ließe
 * jeden Test in `sw-regeln.test.ts` unverändert grün, brächte aber
 * `NetworkFirst` auf Seiten, RSC-Antworten und Schnittstellen zurück. Deshalb
 * testet dies gegen das ausgelieferte Feld, nicht gegen die Zutat.
 *
 * Ein Wächter-Test, der nie rot war, ist kein Wächter-Test. Zur Kontrolle
 * wurde `laufzeitCaching` versuchsweise auf `[...defaultCache,
 * ...laufzeitCaching]` verbreitert (die im Finding genannte Gestalt, `import
 * { defaultCache } from "@serwist/next/worker"`) und mit `NODE_ENV=production
 * bun test` gelaufen — nur unter „production" liefert `defaultCache` die
 * echte Liste, sonst nur einen Platzhalter. Beide Tests unten schlugen fehl:
 * die Längen-Prüfung (21 statt 1 Eintrag), und die Gefahren-Prüfung, weil
 * `defaultCache`s eigener Fang-Auffangregel für „alles auf derselben Herkunft
 * außer /api/" `/anmelden` und `/verwaltung/zugriff` traf und die
 * `/api/…`-Regeln die beiden Schnittstellen-Pfade. Nach dem Rückbau auf den
 * echten Stand (diese Datei importiert `defaultCache` gar nicht) waren beide
 * wieder grün, unter „production" wie im Testlauf.
 */
describe("Die Laufzeit-Cache-Konfiguration, die sw.ts tatsächlich verdrahtet", () => {
  it("besteht aus genau einer Regel", () => {
    expect(laufzeitCaching.length).toBe(1);
  });

  it("lässt keine Regel eine Seite, eine RSC-Antwort oder eine Schnittstelle treffen", () => {
    const gefaehrlich = [
      "/",
      "/anmelden",
      "/verwaltung/zugriff",
      "/einladung/geheimes-token",
      "/api/auth/session",
      "/api/health",
    ];

    for (const pfad of gefaehrlich) {
      for (const regel of laufzeitCaching) {
        expect(trifftZu(regel, pfad)).toBe(false);
      }
    }
  });

  /*
   * Gegenprobe: eine Regel, die auf nichts mehr zutrifft, wäre technisch
   * „sicher" und trotzdem nutzlos. Mindestens eine Regel muss die Icons noch
   * treffen, sonst prüft der Test oben nur eine leere Menge.
   */
  it("trifft weiterhin auf die Icons zu — die Regel ist nicht leer geworden", () => {
    expect(laufzeitCaching.some((regel) => trifftZu(regel, "/icon-192.png"))).toBe(true);
  });
});

/*
 * Serwists `Route` akzeptiert für `matcher` auch `RegExp` oder `string`
 * (siehe `RuntimeCaching["matcher"]`). Unsere eigene Regel ist immer eine
 * Funktion, aber die Kontrollprobe unten spielt versuchsweise
 * `defaultCache` ein, und dessen frühe Einträge sind `RegExp`. Damit die
 * Kontrollprobe nicht am eigenen Test-Helfer scheitert statt an der
 * eigentlichen Prüfung, deckt dieser Helfer beide Formen ab.
 */
function trifftZu(regel: RuntimeCaching, pfad: string): boolean {
  const url = new URL(pfad, HERKUNFT);

  if (regel.matcher instanceof RegExp) {
    return regel.matcher.test(url.href);
  }
  if (typeof regel.matcher === "string") {
    return regel.matcher === url.href;
  }

  const optionen: RouteMatchCallbackOptions = {
    url,
    sameOrigin: url.origin === HERKUNFT,
    request: new Request(url),
    // `ExtendableEvent` steckt in der "webworker"-Bibliothek, die dieses
    // Projekt bewusst nicht lädt (siehe `sw.ts`). Kein Matcher hier liest
    // `event`, daher genügt ein leerer Platzhalter über den Feldtyp selbst.
    event: {} as RouteMatchCallbackOptions["event"],
  };

  return Boolean((regel.matcher as RouteMatchCallback)(optionen));
}

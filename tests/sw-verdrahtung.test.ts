import { describe, expect, it } from "bun:test";

/*
 * `tests/sw-laufzeit-caching.test.ts` beweist, dass `laufzeitCaching` für
 * sich genommen sicher ist. Das beweist nichts darüber, ob `src/app/sw.ts`
 * diesen Wert auch unverändert an `new Serwist({ runtimeCaching: ... })`
 * übergibt. Ein zweiter Import an genau dieser Stelle —
 *
 *   import { defaultCache } from "@serwist/next/worker";
 *   // ...
 *   runtimeCaching: [...laufzeitCaching, ...defaultCache],
 *
 * — ließe jeden Test der anderen Datei unverändert grün und brächte
 * `NetworkFirst` auf Seiten, RSC-Antworten und `/api/`-Aufrufe zurück, weil
 * `sw-laufzeit-caching.ts` von dort aus gar nicht mehr eingesehen wird. Genau
 * das prüft dieser Test: nicht den Inhalt der Regel, sondern die Verkabelung
 * in `sw.ts` selbst.
 *
 * Bewusst über den Quelltext, nicht über den gebauten Worker
 * (`public/sw.js`): der existiert nur nach `bun run build` mit
 * `NODE_ENV=production`, und `bun test` soll für sich genommen aussagekräftig
 * bleiben. Die Kehrseite ist Sprödigkeit — eine legitime Umstrukturierung von
 * `sw.ts` kann diesen Test brechen, ohne die Regel selbst zu verletzen. Wer
 * das tut, muss dann bewusst wieder herstellen, dass `runtimeCaching` eine
 * bloße Referenz auf `laufzeitCaching` bleibt, statt es beiläufig zu
 * verlieren. Die ergänzende Prüfung gegen den gebauten Worker steht in
 * Task 11 (`docs/superpowers/plans/2026-08-02-phase1-fundament-auth.md`) und
 * testet, was tatsächlich ausgeliefert wird — dieser Test hier testet, was im
 * Quelltext steht, unabhängig von einem Bauschritt.
 */
const quelltext = await Bun.file("src/app/sw.ts").text();

describe("Die Verkabelung von runtimeCaching in sw.ts", () => {
  it("importiert nichts aus `@serwist/next/worker` — die Sicherheitslücke, die dieser Test verhindert, kommt ausschließlich über einen Import von dort herein", () => {
    // Der Modulname taucht auch in einem erklärenden Kommentar auf ("aus
    // `@serwist/next/worker`"); geprüft wird deshalb die Import-Syntax
    // (`from "@serwist/next/worker"`), nicht die bloße Zeichenkette.
    expect(quelltext).not.toMatch(/from\s+["']@serwist\/next\/worker["']/);
  });

  it("übergibt `runtimeCaching` als bloße Referenz auf `laufzeitCaching` — kein Spread, keine Verkettung, keine zweite Quelle", () => {
    expect(quelltext).toMatch(/runtimeCaching:\s*laufzeitCaching,/);
  });
});

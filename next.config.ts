import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

/*
 * `@serwist/next` ist ein webpack-Plugin. Next 16 baut standardmäßig mit
 * Turbopack und bricht ab, sobald eine webpack-Konfiguration ohne
 * Turbopack-Gegenstück vorliegt. Deshalb steht in `package.json`
 * `next build --webpack`.
 *
 * Wer das Flag entfernt, bekommt keinen Fehler, sondern einen Bau ohne
 * `public/sw.js` — die App wäre dann still keine PWA mehr. Der Test
 * `tests/manifest.test.ts` merkt das nicht; nur der Browser merkt es.
 *
 * Serwist bietet daneben einen „configurator mode" mit Turbopack-Unterstützung.
 * Der verlangt ein zusätzliches Paket (`@serwist/cli`), einen eigenen
 * Bauschritt nach `next build` und eine von Hand geschriebene Registrierung im
 * Client. Solange `--webpack` funktioniert, ist das der teurere Weg.
 */
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  /*
   * Nur im Produktionsbau. Ein Worker, der Bündel festhält, während man an
   * ihnen arbeitet, kostet mehr Zeit, als er je einspart. Wer den Worker
   * prüfen will, baut und startet: `bun run build && bun run start`.
   */
  disable: process.env.NODE_ENV !== "production",
});

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Aus Task 1: Next muss den TypeScript-CLI für den Typecheck verwenden,
    // weil der eingebaute Checker mit TypeScript 7 nicht zurechtkommt.
    useTypeScriptCli: true,
  },
};

export default withSerwist(nextConfig);

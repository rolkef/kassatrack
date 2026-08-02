# KassaTrack

KassaTrack verfolgt die Preise von Lebensmitteln beim österreichischen Einkauf, um herauszufinden, wo welches Produkt gerade am günstigsten ist.

## Erste Schritte

Dieses Projekt verwendet ausschließlich [Bun](https://bun.sh) – nicht npm, yarn oder pnpm.

```bash
bun install
bun run dev
```

Danach [http://localhost:3000](http://localhost:3000) im Browser öffnen.

## Tests

```bash
bun test
```

## Build

```bash
bun run build
```

## Linting

Aktuell deaktiviert: `typescript-eslint` unterstützt TypeScript 7 noch nicht ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)). TypeScript 7 ist eine bewusste Anforderung dieses Projekts, daher bleibt Linting vorübergehend aus, bis die Unterstützung nachgezogen ist.

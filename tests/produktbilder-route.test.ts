import { describe, expect, it, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { env } from "@/lib/env";
import { lesePfadZuBild } from "@/lib/produktbilder";

/*
 * Schreibt bewusst in das echte, unveränderte `env.PRODUKTBILDER_VERZEICHNIS`
 * — genau wie `tests/produktbilder.test.ts`s `ladeUndSpeichereBild`-Tests.
 *
 * Ein `mock.module("@/lib/env", …)` mit einem eigenen Mkdtemp-Verzeichnis war
 * hier zunächst der Plan, weil `env` eine beim ersten Import eingefrorene
 * Konstante ist (`src/lib/env.ts`) und ein bloßes `process.env`-Setzen nur
 * wirkt, wenn diese Datei als erste im Lauf `@/lib/env` lädt. Nachgestellt
 * zeigte sich aber: Selbst mit einem Reset in `afterAll` blutete die
 * Attrappe in `produktbilder.test.ts` durch — reproduzierbar in drei von drei
 * Läufen, auch wenn nur diese beiden Dateien liefen. `mock.module` gilt für
 * den gesamten Lauf, und `afterAll` einer Datei ohne umschließendes
 * `describe` feuert auf diesem Windows/Bun-1.3.14-Gespann nicht zuverlässig,
 * bevor die andere Datei über dieselbe (noch nicht zurückgesetzte) Attrappe
 * schreibt. Ein eigener, im gesamten Testlauf einmaliger Schlüssel macht die
 * Isolation unabhängig von jeglichem Mock-Timing.
 */
const SCHLUESSEL = "9005555555555.jpg";
const pfad = lesePfadZuBild(env.PRODUKTBILDER_VERZEICHNIS, SCHLUESSEL);

afterAll(async () => {
  await rm(pfad, { force: true });
});

const { GET } = await import("@/app/bilder/produkte/[schluessel]/route");

describe("GET /bilder/produkte/[schluessel]", () => {
  it("liefert die Bytes einer vorhandenen Datei mit langem Cache-Header", async () => {
    await mkdir(env.PRODUKTBILDER_VERZEICHNIS, { recursive: true });
    await writeFile(pfad, Buffer.from([1, 2, 3]));

    const antwort = await GET(new Request(`http://localhost/bilder/produkte/${SCHLUESSEL}`), {
      params: Promise.resolve({ schluessel: SCHLUESSEL }),
    });

    expect(antwort.status).toBe(200);
    expect(Buffer.from(await antwort.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
    expect(antwort.headers.get("cache-control")).toContain("immutable");
  });

  it("liefert 404 für einen gültig geformten, aber unbekannten Schlüssel", async () => {
    const antwort = await GET(new Request("http://localhost/bilder/produkte/9999999999999.jpg"), {
      params: Promise.resolve({ schluessel: "9999999999999.jpg" }),
    });
    expect(antwort.status).toBe(404);
  });

  it("weist einen Schlüssel mit Pfadtrennzeichen ab, statt aus dem Verzeichnis auszubrechen", async () => {
    const antwort = await GET(
      new Request("http://localhost/bilder/produkte/..%2F..%2Fpackage.json"),
      { params: Promise.resolve({ schluessel: "../../package.json" }) },
    );
    expect(antwort.status).toBe(400);
  });

  it("weist einen Schlüssel mit Backslash-Pfadtrennzeichen ab", async () => {
    const antwort = await GET(
      new Request("http://localhost/bilder/produkte/..%5C..%5Cpackage.json"),
      { params: Promise.resolve({ schluessel: "..\\..\\package.json" }) },
    );
    expect(antwort.status).toBe(400);
  });

  it("weist einen Schlüssel ohne .jpg-Endung ab", async () => {
    const antwort = await GET(new Request("http://localhost/bilder/produkte/9001234567892"), {
      params: Promise.resolve({ schluessel: "9001234567892" }),
    });
    expect(antwort.status).toBe(400);
  });

  it("weist einen Schlüssel mit eingebettetem .. vor der Prüfung ab, ohne die Datei zu lesen", async () => {
    const antwort = await GET(
      new Request("http://localhost/bilder/produkte/9001234567892.jpg%2F..%2F..%2Fpackage.json"),
      { params: Promise.resolve({ schluessel: "9001234567892.jpg/../../package.json" }) },
    );
    expect(antwort.status).toBe(400);
  });
});

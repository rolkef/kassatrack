import { describe, expect, it, afterAll, mock } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const verzeichnis = await mkdtemp(join(tmpdir(), "produktbilder-route-"));

/*
 * `env` ist eine beim ersten Import eingefrorene Konstante (`src/lib/env.ts`).
 * Ein bloßes `process.env.PRODUKTBILDER_VERZEICHNIS = …` wirkt deshalb nur,
 * wenn diese Datei im Lauf als **erste** `@/lib/env` lädt — eine Annahme über
 * die Reihenfolge der Testdateien, die bricht, sobald eine andere Testdatei
 * vorher `@/lib/produktbilder` (und damit transitiv `@/lib/env`) importiert.
 * Die Attrappe macht die Isolation unabhängig von dieser Reihenfolge; sie
 * spreizt das echte `env`, damit andere Felder unangetastet bleiben.
 */
const echtesEnv = await import("@/lib/env");
await mock.module("@/lib/env", () => ({
  ...echtesEnv,
  env: { ...echtesEnv.env, PRODUKTBILDER_VERZEICHNIS: verzeichnis },
}));

afterAll(async () => {
  await rm(verzeichnis, { recursive: true, force: true });
});

const { GET } = await import("@/app/bilder/produkte/[schluessel]/route");

describe("GET /bilder/produkte/[schluessel]", () => {
  it("liefert die Bytes einer vorhandenen Datei mit langem Cache-Header", async () => {
    await writeFile(join(verzeichnis, "9001234567892.jpg"), Buffer.from([1, 2, 3]));

    const antwort = await GET(new Request("http://localhost/bilder/produkte/9001234567892.jpg"), {
      params: Promise.resolve({ schluessel: "9001234567892.jpg" }),
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

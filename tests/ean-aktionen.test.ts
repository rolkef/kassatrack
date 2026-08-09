import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { legeProduktAn } from "@/lib/katalog";
import { findeProduktPerEan, verknuepfeEan } from "@/lib/produkt-ean";
import { faengtFehler } from "./helfer/fehler";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";

/*
 * Prüft die Server-Aktionen **direkt** gegen eine echte Datenbank — wie
 * `tests/erfassen-aktionen.test.ts`: Server-Aktionen sind eigene Endpunkte
 * und über ihre Kennung auch ohne die zugehörige Seite aufrufbar.
 *
 * Datenbank, Migration und Attrappen entstehen auf oberster Ebene, nicht in
 * `beforeAll`: `ean-aktionen.ts` bindet `@/db` beim Importieren, und dieser
 * Import läuft erst weiter unten per `await import`, nachdem die Attrappe
 * steht.
 */
const umgebung: TestDatenbank = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });

afterAll(() => umgebung.stop());

// `@/db` exportiert nur `db` — hier ist die Streuung entbehrlich.
await mock.module("@/db", () => ({ db: umgebung.db }));

/** Ob `requireUser` die angemeldete Person liefert oder wie ohne Sitzung wirft. */
let angemeldet = true;

/*
 * `mock.module` gilt in Bun für den **gesamten** Lauf. Der Anhang `?echt`
 * macht aus diesem Import einen eigenen Modul-Eintrag, den keine Attrappe
 * einer anderen Testdatei trifft — dieselbe Ausweichstelle wie in
 * `tests/sitzung.test.ts` und `tests/erfassen-aktionen.test.ts`. Die
 * Attrappe spreizt das echte Modul, statt Exporte wegzulassen: Sonst nähme
 * sie jeder anderen Testdatei, die `@/lib/sitzung` später im selben Bun-
 * Prozess importiert, einen Export weg, den diese Datei nicht kennt.
 */
const echterBezeichner = "@/lib/sitzung?echt";
const echteSitzung = (await import(echterBezeichner)) as typeof import("@/lib/sitzung");
await mock.module("@/lib/sitzung", () => ({
  ...echteSitzung,
  requireUser: async () => {
    if (!angemeldet) throw new Error("nicht angemeldet");
    return { id: "u1", email: "wer@example.at", name: "Wer" };
  },
}));

const { loeseEanAuf, bestaetigeZuordnung } = await import("@/app/erfassen/ean-aktionen");

beforeEach(async () => {
  // `cascade` wegen `product_ean`: Die Tabelle zeigt auf `product`.
  await umgebung.db.execute(sql`truncate table product cascade`);
  angemeldet = true;
});

/*
 * Zustand des globalen Prozesses, kein `mock.module` auf ein Projektmodul —
 * trotzdem unbedingt zurücksetzen, sonst blutet es in jede andere Testdatei,
 * die im selben Lauf `fetch` benutzt.
 */
const echterFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = echterFetch;
});

function fakeOffAntwort(antwort: unknown, status = 200) {
  return mock(async () => new Response(JSON.stringify(antwort), { status })) as unknown as typeof fetch;
}

async function anzahlProdukte(): Promise<number> {
  const ergebnis = await umgebung.db.execute(sql`select count(*)::int as n from product`);
  return (ergebnis.rows as { n: number }[])[0].n;
}

describe("loeseEanAuf", () => {
  it("liefert das Produkt direkt, wenn die EAN schon verknüpft ist", async () => {
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Butter",
      marke: "Berglandmilch",
      menge: 250,
      einheit: "G",
    });
    await verknuepfeEan(umgebung.db, produkt.id, "9001234567892");

    const ergebnis = await loeseEanAuf("9001234567892");

    expect(ergebnis).toEqual({ art: "bekannt", produkt });
  });

  it("verlangt eine Anmeldung", async () => {
    angemeldet = false;

    const fehler = await faengtFehler(() => loeseEanAuf("9001234567892"));

    expect(fehler).toBeDefined();
  });

  it("liefert einen Vorschlag mit Ähnlichkeits-Kandidaten bei unbekannter EAN", async () => {
    globalThis.fetch = fakeOffAntwort({
      status: 1,
      product: { product_name: "Butter", quantity: "250 g", brands: "Berglandmilch" },
    });

    await legeProduktAn(umgebung.db, { name: "Butter", marke: null, menge: 250, einheit: "G" });

    const ergebnis = await loeseEanAuf("9009999999999");

    expect(ergebnis.art).toBe("vorschlag");
    if (ergebnis.art === "vorschlag") {
      expect(ergebnis.kandidat.name).toBe("Butter");
      expect(ergebnis.ean).toBe("9009999999999");
      expect(ergebnis.aehnliche.length).toBeGreaterThan(0);
    }
  });

  it("liefert unbekannt, wenn weder product_ean noch Open Food Facts etwas kennt", async () => {
    globalThis.fetch = fakeOffAntwort({ status: 0 });

    const ergebnis = await loeseEanAuf("9000000000000");

    expect(ergebnis).toEqual({ art: "unbekannt" });
  });
});

describe("bestaetigeZuordnung", () => {
  it("verknüpft die EAN mit einem bestehenden Produkt über produktId", async () => {
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Milch",
      marke: null,
      menge: 1000,
      einheit: "ML",
    });

    const ergebnis = await bestaetigeZuordnung({ ean: "9001111111111", produktId: produkt.id });

    expect(ergebnis).toEqual(produkt);
    const gefunden = await findeProduktPerEan(umgebung.db, "9001111111111");
    expect(gefunden?.id).toBe(produkt.id);
  });

  it("legt ein neues Produkt an und verknüpft es mit der EAN", async () => {
    const ergebnis = await bestaetigeZuordnung({
      ean: "9002222222222",
      neu: { name: "Joghurt", marke: "Ja Natürlich", menge: 500, einheit: "G" },
    });

    expect(ergebnis.name).toBe("Joghurt");
    expect(await anzahlProdukte()).toBe(1);
    const gefunden = await findeProduktPerEan(umgebung.db, "9002222222222");
    expect(gefunden?.id).toBe(ergebnis.id);
  });

  it("legt bei einem zweiten Aufruf für dieselbe EAN kein zweites Produkt an", async () => {
    const erster = await bestaetigeZuordnung({
      ean: "9003333333333",
      neu: { name: "Käse", marke: null, menge: 200, einheit: "G" },
    });

    const zweiter = await bestaetigeZuordnung({
      ean: "9003333333333",
      neu: { name: "Käse (anderer Vorschlag)", marke: null, menge: 200, einheit: "G" },
    });

    expect(zweiter.id).toBe(erster.id);
    expect(await anzahlProdukte()).toBe(1);
  });

  it("verlangt eine Anmeldung", async () => {
    angemeldet = false;

    const fehler = await faengtFehler(() =>
      bestaetigeZuordnung({ ean: "9004444444444", neu: { name: "Brot", marke: null, menge: 500, einheit: "G" } }),
    );

    expect(fehler).toBeDefined();
    expect(await anzahlProdukte()).toBe(0);
  });
});

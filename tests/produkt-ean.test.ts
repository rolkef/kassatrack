import { afterAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { legeProduktAn } from "@/lib/katalog";
import { findeProduktPerEan, verknuepfeEan } from "@/lib/produkt-ean";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";

const umgebung: TestDatenbank = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });

afterAll(() => umgebung.stop());

describe("findeProduktPerEan", () => {
  it("liefert null für eine unbekannte EAN", async () => {
    expect(await findeProduktPerEan(umgebung.db, "9001234567892")).toBeNull();
  });

  it("liefert das verknüpfte Produkt für eine bekannte EAN", async () => {
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Butter",
      marke: "Berglandmilch",
      menge: 250,
      einheit: "G",
    });
    await verknuepfeEan(umgebung.db, produkt.id, "9001234567892");

    const gefunden = await findeProduktPerEan(umgebung.db, "9001234567892");
    expect(gefunden).toEqual(produkt);
  });
});

describe("verknuepfeEan", () => {
  it("ist erneut aufrufbar für dieselbe Zuordnung, ohne zu werfen", async () => {
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Milch",
      marke: null,
      menge: 1000,
      einheit: "ML",
    });
    await verknuepfeEan(umgebung.db, produkt.id, "9007654321098");
    await verknuepfeEan(umgebung.db, produkt.id, "9007654321098");

    expect(await findeProduktPerEan(umgebung.db, "9007654321098")).toEqual(produkt);
  });

  it("überschreibt eine bestehende Zuordnung zu einem anderen Produkt nicht", async () => {
    const erstesProdukt = await legeProduktAn(umgebung.db, {
      name: "Joghurt A",
      marke: null,
      menge: 500,
      einheit: "G",
    });
    const zweitesProdukt = await legeProduktAn(umgebung.db, {
      name: "Joghurt B",
      marke: null,
      menge: 500,
      einheit: "G",
    });
    const ean = randomUUID().replace(/\D/g, "").padEnd(13, "1").slice(0, 13);

    await verknuepfeEan(umgebung.db, erstesProdukt.id, ean);
    await verknuepfeEan(umgebung.db, zweitesProdukt.id, ean);

    expect(await findeProduktPerEan(umgebung.db, ean)).toEqual(erstesProdukt);
  });
});

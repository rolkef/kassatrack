// tests/synchronisiere-ketten.test.ts
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { holeKetten, legeKettenAn, legeProduktAn } from "@/lib/katalog";
import { bestaetigeZuordnung, holeUngeklaerte } from "@/lib/ketten-abgleich";
import { fuehreSyncAus } from "../scripts/synchronisiere-ketten";
import { starteTestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

const umgebung = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });
await legeKettenAn(umgebung.db);
afterAll(() => umgebung.stop());

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate chain_sync_ungeklaert, store_product, product cascade`);
});

function fakeFeed(eintraege: unknown[]) {
  return mock(async () => new Response(JSON.stringify(eintraege), { status: 200 })) as unknown as typeof fetch;
}

const JETZT = new Date("2026-08-13T12:00:00.000Z");

function frischerEintrag(overrides: Record<string, unknown> = {}) {
  return {
    store: "billa",
    id: "00-1",
    name: "Testartikel",
    price: 2.49,
    quantity: 250,
    unit: "g",
    unavailable: false,
    priceHistory: [{ date: "2026-08-12", price: 2.49 }],
    ...overrides,
  };
}

describe("fuehreSyncAus", () => {
  it("meldet einen unbekannten Artikel in der Prüfliste", async () => {
    const bericht = await fuehreSyncAus(umgebung.db, fakeFeed([frischerEintrag()]), JETZT);

    expect(bericht.neueUngeklaerte).toBe(1);
    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(1);
  });

  it("überspringt eine Kette ohne frische Daten (z. B. lidl/penny)", async () => {
    const bericht = await fuehreSyncAus(
      umgebung.db,
      fakeFeed([
        { ...frischerEintrag({ store: "lidl", id: "l-1" }), priceHistory: [{ date: "2020-01-01", price: 1 }] },
      ]),
      JETZT,
    );

    expect(bericht.uebersprungeneKetten).toContain("lidl");
    expect(bericht.neueUngeklaerte).toBe(0);
  });

  it("verwirft einen Artikel mit unbekannter Einheit, ohne ihn in die Prüfliste zu legen", async () => {
    const bericht = await fuehreSyncAus(
      umgebung.db,
      fakeFeed([frischerEintrag({ unit: "Verpackungseinheit" })]),
      JETZT,
    );

    expect(bericht.verworfeneEinheiten).toBe(1);
    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(0);
  });

  it("verwirft einen ausgelisteten Artikel", async () => {
    const bericht = await fuehreSyncAus(umgebung.db, fakeFeed([frischerEintrag({ unavailable: true })]), JETZT);

    expect(bericht.uebersprungenUnavailable).toBe(1);
    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(0);
  });

  it("ignoriert eine dem Katalog unbekannte Kette (z. B. dm)", async () => {
    const bericht = await fuehreSyncAus(umgebung.db, fakeFeed([frischerEintrag({ store: "dm" })]), JETZT);

    expect(bericht.neueUngeklaerte).toBe(0);
    expect(bericht.uebersprungeneKetten).not.toContain("dm");
    expect(bericht.ignorierteKetten).toContain("dm");
  });

  it("wirft, wenn der Feed nicht erreichbar ist, und schreibt nichts", async () => {
    const abrufen = mock(async () => new Response("", { status: 500 })) as unknown as typeof fetch;

    // Kein .rejects hier -- fuehreSyncAus fragt vor dem Feed-Abruf bereits
    // echtes Postgres an (legeKettenAn/holeKetten), ist also ein
    // DB-anfragendes Promise im Sinne der Testkonvention.
    const fehler = await faengtFehler(() => fuehreSyncAus(umgebung.db, abrufen, JETZT));
    expect(fehler).toBeDefined();
    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(0);
  });

  it("schreibt eine Beobachtung, sobald der Artikel per Feed-Code zugeordnet ist", async () => {
    // Erster Lauf: legt den Prüflisten-Eintrag an.
    await fuehreSyncAus(umgebung.db, fakeFeed([frischerEintrag()]), JETZT);
    const [eintrag] = await holeUngeklaerte(umgebung.db);
    const produkt = await legeProduktAn(umgebung.db, { name: "Testartikel", menge: 250, einheit: "G" });
    await bestaetigeZuordnung(umgebung.db, {
      ungeklaertId: eintrag.id,
      chainId: eintrag.chainId,
      feedId: eintrag.feedId,
      rohname: eintrag.rohname,
      productId: produkt.id,
    });

    // Zweiter Lauf: muss jetzt über den Feed-Code treffen und eine Beobachtung schreiben.
    const bericht = await fuehreSyncAus(umgebung.db, fakeFeed([frischerEintrag()]), JETZT);

    expect(bericht.geschriebeneBeobachtungen).toBeGreaterThan(0);
    expect(bericht.neueUngeklaerte).toBe(0);
  });
});

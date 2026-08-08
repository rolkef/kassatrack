import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { KETTEN, holeKetten, legeKettenAn } from "@/lib/katalog";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";
import { chain } from "@/db/schema/katalog";

let umgebung: TestDatenbank;

beforeAll(async () => {
  umgebung = await starteTestDatenbank();
  await umgebung.db.execute(sql`
    create table chain (
      id text primary key,
      name text not null,
      kuerzel text not null unique,
      sortierung integer not null,
      constraint chain_kuerzel_klein check (kuerzel = lower(kuerzel))
    )
  `);
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

describe("Ketten", () => {
  it("kennt die fünf österreichischen Ketten", () => {
    expect(KETTEN.map((k) => k.kuerzel).sort()).toEqual([
      "billa",
      "hofer",
      "lidl",
      "penny",
      "spar",
    ]);
  });

  it("legt sie an", async () => {
    await legeKettenAn(umgebung.db);
    expect((await holeKetten(umgebung.db)).length).toBe(5);
  });

  it("ist bei doppeltem Aufruf unkritisch", async () => {
    await legeKettenAn(umgebung.db);
    await legeKettenAn(umgebung.db);
    expect((await holeKetten(umgebung.db)).length).toBe(5);
  });

  it("liefert sie in fester Reihenfolge, nicht in Einfügereihenfolge", async () => {
    await legeKettenAn(umgebung.db);
    const kuerzel = (await holeKetten(umgebung.db)).map((k) => k.kuerzel);
    expect(kuerzel).toEqual(["billa", "spar", "hofer", "lidl", "penny"]);
  });

  it("verweigert ein großgeschriebenes Kürzel", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(chain).values({ id: "x", name: "X", kuerzel: "BILLA", sortierung: 9 }),
    );
    expect(fehler).toBeDefined();
  });
});

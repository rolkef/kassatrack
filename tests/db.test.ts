import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";

let umgebung: TestDatenbank;

beforeAll(async () => {
  umgebung = await starteTestDatenbank();
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

describe("Testdatenbank", () => {
  it("ist erreichbar", async () => {
    const zeilen = await umgebung.db.execute(sql`select 1 as eins`);
    expect(zeilen.rows[0]).toEqual({ eins: 1 });
  });

  it("hat die Erweiterung pg_trgm aktiviert", async () => {
    const zeilen = await umgebung.db.execute(
      sql`select extname from pg_extension where extname = 'pg_trgm'`,
    );
    expect(zeilen.rows).toHaveLength(1);
  });
});

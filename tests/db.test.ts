import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
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

  /*
   * Die Migration muss die Erweiterung mitbringen, nicht der Testhelfer.
   *
   * Vorher legte `starteTestDatenbank` sie selbst an. Die Zusage lautete
   * damit „der Testhelfer funktioniert" und nicht „die echte Datenbank kann
   * suchen" — und genau das ging auseinander: Alle Suchtests waren grün,
   * während `/produkte` im Browser mit `function similarity(text, unknown)
   * does not exist` abbrach. Deshalb wird hier ausdrücklich erst migriert und
   * dann nachgesehen.
   */
  it("bekommt die Erweiterung pg_trgm aus der Migration", async () => {
    const vorher = await umgebung.db.execute(
      sql`select extname from pg_extension where extname = 'pg_trgm'`,
    );
    expect(vorher.rows).toHaveLength(0);

    await migrate(umgebung.db, { migrationsFolder: "./drizzle" });

    const nachher = await umgebung.db.execute(
      sql`select extname from pg_extension where extname = 'pg_trgm'`,
    );
    expect(nachher.rows).toHaveLength(1);
  });
});

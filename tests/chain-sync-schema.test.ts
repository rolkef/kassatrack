import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "bun:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { chainSyncUngeklaert } from "@/db/schema/chain-sync";
import { legeKettenAn, holeKetten } from "@/lib/katalog";
import { starteTestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

const umgebung = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });
await legeKettenAn(umgebung.db);
afterAll(() => umgebung.stop());

describe("chain_sync_ungeklaert", () => {
  it("legt eine Zeile mit gültigen Werten an", async () => {
    const [kette] = await holeKetten(umgebung.db);
    const [zeile] = await umgebung.db
      .insert(chainSyncUngeklaert)
      .values({
        id: randomUUID(),
        chainId: kette.id,
        feedId: "00-123456",
        rohname: "Testprodukt",
        menge: 250,
        einheit: "G",
        letzterPreis: "2.49",
      })
      .returning();

    expect(zeile.rohname).toBe("Testprodukt");
  });

  it("weist eine negative Menge ab", async () => {
    const [kette] = await holeKetten(umgebung.db);
    const fehler = await faengtFehler(
      () => umgebung.db.insert(chainSyncUngeklaert).values({
        id: randomUUID(),
        chainId: kette.id,
        feedId: "00-999999",
        rohname: "Ungültig",
        menge: -1,
        einheit: "G",
        letzterPreis: "1.00",
      }),
    );
    expect(fehler).toBeDefined();
  });

  it("weist eine unbekannte Einheit ab", async () => {
    const [kette] = await holeKetten(umgebung.db);
    const fehler = await faengtFehler(
      () => umgebung.db.insert(chainSyncUngeklaert).values({
        id: randomUUID(),
        chainId: kette.id,
        feedId: "00-999998",
        rohname: "Ungültig",
        menge: 250,
        einheit: "KG",
        letzterPreis: "1.00",
      }),
    );
    expect(fehler).toBeDefined();
  });

  it("weist eine zweite Zeile mit derselben Kette+feedId ab", async () => {
    const [kette] = await holeKetten(umgebung.db);
    await umgebung.db.insert(chainSyncUngeklaert).values({
      id: randomUUID(),
      chainId: kette.id,
      feedId: "00-777777",
      rohname: "Erstes",
      menge: 100,
      einheit: "ML",
      letzterPreis: "1.99",
    });

    const fehler = await faengtFehler(
      () => umgebung.db.insert(chainSyncUngeklaert).values({
        id: randomUUID(),
        chainId: kette.id,
        feedId: "00-777777",
        rohname: "Zweites, gleiche feedId",
        menge: 100,
        einheit: "ML",
        letzterPreis: "2.99",
      }),
    );
    expect(fehler).toBeDefined();
  });

  it("löscht kaskadierend, wenn die Kette gelöscht wird", async () => {
    // Eigene Wegwerf-Kette, um chain nicht für andere Tests zu verändern.
    const kettenId = randomUUID();
    await umgebung.db.execute(
      sql`insert into chain (id, name, kuerzel, sortierung) values (${kettenId}, 'Wegwerf', 'wegwerf', 999)`,
    );
    await umgebung.db.insert(chainSyncUngeklaert).values({
      id: randomUUID(),
      chainId: kettenId,
      feedId: "00-555555",
      rohname: "Wird mitgelöscht",
      menge: 1,
      einheit: "STK",
      letzterPreis: "0.99",
    });

    await umgebung.db.execute(sql`delete from chain where id = ${kettenId}`);

    const rest = await umgebung.db
      .select()
      .from(chainSyncUngeklaert)
      .where(sql`${chainSyncUngeklaert.chainId} = ${kettenId}`);
    expect(rest).toHaveLength(0);
  });
});

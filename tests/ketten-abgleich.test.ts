import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { chainSyncUngeklaert } from "@/db/schema/chain-sync";
import { holeKetten, legeKettenAn, legeProduktAn, sichereKettenProdukt } from "@/lib/katalog";
import {
  bestaetigeZuordnung,
  feedSchluessel,
  findeStoreProductPerFeedCode,
  findeStoreProductPerName,
  holeUngeklaerte,
  meldeUngeklaert,
  verwerfeUngeklaert,
} from "@/lib/ketten-abgleich";
import { storeProduct } from "@/db/schema/katalog";
import { eq } from "drizzle-orm";
import { starteTestDatenbank } from "./helfer/db";

const umgebung = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });
await legeKettenAn(umgebung.db);
afterAll(() => umgebung.stop());

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate chain_sync_ungeklaert, store_product, product cascade`);
});

describe("meldeUngeklaert / holeUngeklaerte / verwerfeUngeklaert", () => {
  /*
   * Ohne feste Reihenfolge darf Postgres die Zeilen bei jedem Aufruf anders
   * herausgeben. Auf `/produkte/abgleich` löst jede Aktion ein
   * `revalidatePath` aus — die Liste würde sich also unter den Händen der
   * Person neu sortieren, die sie gerade abarbeitet. Ältestes zuerst, weil
   * das die Warteschlange ist, als die dieser Vorrat gelesen wird.
   */
  it("liefert die Prüfliste stabil, ältester Eintrag zuerst", async () => {
    const [kette] = await holeKetten(umgebung.db);

    for (const feedId of ["c-jung", "a-alt", "b-mittel"]) {
      await meldeUngeklaert(umgebung.db, {
        chainId: kette.id,
        feedId,
        rohname: feedId,
        menge: 1,
        einheit: "STK",
        preis: 1,
      });
    }

    /*
     * `defaultNow()` liegt für alle drei im selben Sekundenbruchteil, die
     * Zeitpunkte werden deshalb ausdrücklich gesetzt — und zwar **absteigend**.
     * Ein `update` schreibt in Postgres eine neue Zeilenversion ans Ende des
     * Heaps; ohne `order by` liefert der Sequential Scan danach genau diese
     * Reihenfolge, also die umgekehrte der erwarteten. Ohne die Sortierung in
     * `holeUngeklaerte` schlägt dieser Test damit fehl, statt zufällig
     * durchzugehen.
     */
    const zeiten: [string, string][] = [
      ["c-jung", "2026-08-03T08:00:00Z"],
      ["b-mittel", "2026-08-02T08:00:00Z"],
      ["a-alt", "2026-08-01T08:00:00Z"],
    ];
    for (const [feedId, zeit] of zeiten) {
      await umgebung.db
        .update(chainSyncUngeklaert)
        .set({ zuerstGesehenAm: new Date(zeit) })
        .where(eq(chainSyncUngeklaert.feedId, feedId));
    }

    const erwartet = ["a-alt", "b-mittel", "c-jung"];
    expect((await holeUngeklaerte(umgebung.db)).map((e) => e.feedId)).toEqual(erwartet);
    // Zweiter Aufruf: dieselbe Reihenfolge, nicht bloß irgendeine.
    expect((await holeUngeklaerte(umgebung.db)).map((e) => e.feedId)).toEqual(erwartet);
  });

  it("legt einen neuen Prüflisten-Eintrag an und findet ihn wieder", async () => {
    const [kette] = await holeKetten(umgebung.db);
    await meldeUngeklaert(umgebung.db, {
      chainId: kette.id,
      feedId: "00-1",
      rohname: "Unbekanntes Ding",
      menge: 250,
      einheit: "G",
      preis: 2.49,
    });

    const liste = await holeUngeklaerte(umgebung.db);
    expect(liste).toHaveLength(1);
    expect(liste[0].rohname).toBe("Unbekanntes Ding");
  });

  it("aktualisiert Preis und Zeitpunkt statt eine zweite Zeile anzulegen", async () => {
    const [kette] = await holeKetten(umgebung.db);
    await meldeUngeklaert(umgebung.db, {
      chainId: kette.id, feedId: "00-1", rohname: "Ding", menge: 250, einheit: "G", preis: 2.49,
    });
    await meldeUngeklaert(umgebung.db, {
      chainId: kette.id, feedId: "00-1", rohname: "Ding, neuer Name", menge: 250, einheit: "G", preis: 2.99,
    });

    const liste = await holeUngeklaerte(umgebung.db);
    expect(liste).toHaveLength(1);
    expect(liste[0].rohname).toBe("Ding, neuer Name");
    expect(liste[0].letzterPreis).toBe(2.99);
  });

  it("löscht einen Eintrag beim Verwerfen", async () => {
    const [kette] = await holeKetten(umgebung.db);
    await meldeUngeklaert(umgebung.db, {
      chainId: kette.id, feedId: "00-1", rohname: "Ding", menge: 250, einheit: "G", preis: 2.49,
    });
    const [eintrag] = await holeUngeklaerte(umgebung.db);

    await verwerfeUngeklaert(umgebung.db, eintrag.id);

    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(0);
  });
});

describe("findeStoreProductPerFeedCode / findeStoreProductPerName", () => {
  it("findet nichts, solange keine Zuordnung besteht", async () => {
    const [kette] = await holeKetten(umgebung.db);
    expect(await findeStoreProductPerFeedCode(umgebung.db, kette.id, "00-1")).toBeNull();
    expect(
      await findeStoreProductPerName(umgebung.db, kette.id, { rohname: "Butter", menge: 250, einheit: "G" }),
    ).toBeNull();
  });

  it("findet über den Feed-Code, nachdem er bestätigt wurde", async () => {
    const [kette] = await holeKetten(umgebung.db);
    const produkt = await legeProduktAn(umgebung.db, { name: "Butter", menge: 250, einheit: "G" });
    await meldeUngeklaert(umgebung.db, {
      chainId: kette.id, feedId: "00-1", rohname: "BUTT.EXTRA 250", menge: 250, einheit: "G", preis: 2.49,
    });
    const [eintrag] = await holeUngeklaerte(umgebung.db);

    await bestaetigeZuordnung(umgebung.db, {
      ungeklaertId: eintrag.id,
      chainId: kette.id,
      feedId: "00-1",
      rohname: "BUTT.EXTRA 250",
      productId: produkt.id,
    });

    const gefunden = await findeStoreProductPerFeedCode(umgebung.db, kette.id, "00-1");
    expect(gefunden).not.toBeNull();

    const zuordnung = await umgebung.db
      .select({ productId: storeProduct.productId })
      .from(storeProduct)
      .where(eq(storeProduct.id, gefunden!));
    expect(zuordnung[0].productId).toBe(produkt.id);
  });

  it("löscht den Prüflisten-Eintrag beim Bestätigen", async () => {
    const [kette] = await holeKetten(umgebung.db);
    const produkt = await legeProduktAn(umgebung.db, { name: "Milch", menge: 1000, einheit: "ML" });
    await meldeUngeklaert(umgebung.db, {
      chainId: kette.id, feedId: "00-2", rohname: "Milch 1l", menge: 1000, einheit: "ML", preis: 1.19,
    });
    const [eintrag] = await holeUngeklaerte(umgebung.db);

    await bestaetigeZuordnung(umgebung.db, {
      ungeklaertId: eintrag.id, chainId: kette.id, feedId: "00-2", rohname: "Milch 1l", productId: produkt.id,
    });

    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(0);
  });

  it("findet über Name+Menge+Einheit, auch ohne bestätigten Feed-Code", async () => {
    const [kette] = await holeKetten(umgebung.db);
    const produkt = await legeProduktAn(umgebung.db, { name: "Zahnpasta", menge: 75, einheit: "ML" });
    const storeProductId = await sichereKettenProdukt(umgebung.db, { chainId: kette.id, productId: produkt.id });
    await umgebung.db.update(storeProduct).set({ rohNamen: ["Zahnpasta Frisch"] }).where(eq(storeProduct.id, storeProductId));

    const gefunden = await findeStoreProductPerName(umgebung.db, kette.id, {
      rohname: "  zahnpasta frisch  ",
      menge: 75,
      einheit: "ML",
    });
    expect(gefunden).toBe(storeProductId);
  });

  it("findet nicht über den Namen, wenn Menge oder Einheit abweichen", async () => {
    const [kette] = await holeKetten(umgebung.db);
    const produkt = await legeProduktAn(umgebung.db, { name: "Zahnpasta", menge: 75, einheit: "ML" });
    const storeProductId = await sichereKettenProdukt(umgebung.db, { chainId: kette.id, productId: produkt.id });
    await umgebung.db.update(storeProduct).set({ rohNamen: ["Zahnpasta Frisch"] }).where(eq(storeProduct.id, storeProductId));

    expect(
      await findeStoreProductPerName(umgebung.db, kette.id, { rohname: "zahnpasta frisch", menge: 100, einheit: "ML" }),
    ).toBeNull();
  });
});

describe("feedSchluessel", () => {
  it("erzeugt einen von echten Anzeigenamen unterscheidbaren Schlüssel", () => {
    expect(feedSchluessel("00-1")).toBe("feed:00-1");
  });
});

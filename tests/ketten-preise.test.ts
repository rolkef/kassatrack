import { afterAll, describe, expect, it } from "bun:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { and, eq } from "drizzle-orm";
import { priceObservation } from "@/db/schema/preise";
import { holeKetten, legeKettenAn, legeProduktAn, sichereKettenProdukt } from "@/lib/katalog";
import { synchronisiereBeobachtungen } from "@/lib/ketten-preise";
import { starteTestDatenbank } from "./helfer/db";

const umgebung = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });
await legeKettenAn(umgebung.db);
afterAll(() => umgebung.stop());

async function holeBeobachtungen(storeProductId: string) {
  return umgebung.db
    .select({ beobachtetAm: priceObservation.beobachtetAm, grundpreis: priceObservation.grundpreis })
    .from(priceObservation)
    .where(and(eq(priceObservation.storeProductId, storeProductId), eq(priceObservation.quelle, "CHAIN_API")))
    .orderBy(priceObservation.beobachtetAm);
}

describe("synchronisiereBeobachtungen", () => {
  it("schreibt beim Erstimport nur die Tage mit echter Preisänderung", async () => {
    const produkt = await legeProduktAn(umgebung.db, { name: "Butter Sync", menge: 250, einheit: "G" });
    const [kette] = await holeKetten(umgebung.db);
    const storeProductId = await sichereKettenProdukt(umgebung.db, { chainId: kette.id, productId: produkt.id });

    const geschrieben = await synchronisiereBeobachtungen(umgebung.db, {
      storeProductId,
      chainId: kette.id,
      productId: produkt.id,
      menge: { wert: 250, einheit: "G" },
      verlauf: [
        { date: "2024-03-01", price: 2.49 },
        { date: "2024-02-15", price: 2.49 }, // gleicher Preis -- kein zweiter Eintrag
        { date: "2024-01-01", price: 2.29 },
      ],
    });

    expect(geschrieben).toBe(2);
    const beobachtungen = await holeBeobachtungen(storeProductId);
    expect(beobachtungen).toHaveLength(2);
    expect(beobachtungen[0].beobachtetAm.toISOString().slice(0, 10)).toBe("2024-01-01");
    expect(beobachtungen[1].beobachtetAm.toISOString().slice(0, 10)).toBe("2024-02-15");
  });

  it("schreibt bei einem Folgelauf nur, wenn sich der Preis geändert hat", async () => {
    const produkt = await legeProduktAn(umgebung.db, { name: "Milch Sync", menge: 1000, einheit: "ML" });
    const [kette] = await holeKetten(umgebung.db);
    const storeProductId = await sichereKettenProdukt(umgebung.db, { chainId: kette.id, productId: produkt.id });

    await synchronisiereBeobachtungen(umgebung.db, {
      storeProductId, chainId: kette.id, productId: produkt.id,
      menge: { wert: 1000, einheit: "ML" },
      verlauf: [{ date: "2024-03-01", price: 1.19 }],
    });

    const nochmalGleich = await synchronisiereBeobachtungen(umgebung.db, {
      storeProductId, chainId: kette.id, productId: produkt.id,
      menge: { wert: 1000, einheit: "ML" },
      verlauf: [{ date: "2024-03-02", price: 1.19 }],
    });
    expect(nochmalGleich).toBe(0);

    const mitAenderung = await synchronisiereBeobachtungen(umgebung.db, {
      storeProductId, chainId: kette.id, productId: produkt.id,
      menge: { wert: 1000, einheit: "ML" },
      verlauf: [{ date: "2024-03-03", price: 1.29 }],
    });
    expect(mitAenderung).toBe(1);

    expect(await holeBeobachtungen(storeProductId)).toHaveLength(2);
  });

  it("rechnet den Regalpreis in den Grundpreis um — bei jeder Gebindegröße", async () => {
    // 250 g für 2,49 € sind 9,96 €/kg; 500 g für 3,99 € sind 7,98 €/kg.
    // Zwei Gebindegrößen sind Absicht: Bei 1000 g ist der Umrechnungsfaktor
    // genau 1, ein roher Regalpreis in `grundpreis` (Plan 4s Fehlerklasse)
    // bliebe dort unbemerkt.
    for (const [wert, preis, erwartet] of [
      [250, 2.49, 9.96],
      [500, 3.99, 7.98],
    ] as const) {
      const produkt = await legeProduktAn(umgebung.db, { name: `Grundpreis ${wert}`, menge: wert, einheit: "G" });
      const [kette] = await holeKetten(umgebung.db);
      const storeProductId = await sichereKettenProdukt(umgebung.db, { chainId: kette.id, productId: produkt.id });

      await synchronisiereBeobachtungen(umgebung.db, {
        storeProductId, chainId: kette.id, productId: produkt.id,
        menge: { wert, einheit: "G" },
        verlauf: [{ date: "2024-04-01", price: preis }],
      });

      const [beobachtung] = await holeBeobachtungen(storeProductId);
      expect(Number(beobachtung.grundpreis)).toBeCloseTo(erwartet, 4);
    }
  });

  it("ist idempotent bei doppeltem Lauf mit identischem Verlauf", async () => {
    const produkt = await legeProduktAn(umgebung.db, { name: "Mehl Sync", menge: 1000, einheit: "G" });
    const [kette] = await holeKetten(umgebung.db);
    const storeProductId = await sichereKettenProdukt(umgebung.db, { chainId: kette.id, productId: produkt.id });

    const eingabe = {
      storeProductId, chainId: kette.id, productId: produkt.id,
      menge: { wert: 1000, einheit: "G" as const },
      verlauf: [{ date: "2024-03-01", price: 0.89 }],
    };

    await synchronisiereBeobachtungen(umgebung.db, eingabe);
    const zweitesMal = await synchronisiereBeobachtungen(umgebung.db, eingabe);

    expect(zweitesMal).toBe(0);
    expect(await holeBeobachtungen(storeProductId)).toHaveLength(1);
  });
});

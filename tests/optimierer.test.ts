import { afterAll, describe, expect, it } from "bun:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { grundpreis } from "@/lib/einheiten";
import {
  legeKettenAn,
  legeProduktAn,
  holeKetten,
  sichereKettenProdukt,
  type Produkt,
} from "@/lib/katalog";
import { erzeugeListe, fuegeFreitextArtikelHinzu, fuegeKatalogArtikelHinzu } from "@/lib/einkaufszettel";
import { berechneOptimierung } from "@/lib/optimierer";
import { schreibeBeobachtung } from "@/lib/preise";
import { starteTestDatenbank } from "./helfer/db";

const umgebung = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });
await legeKettenAn(umgebung.db);
afterAll(() => umgebung.stop());

/**
 * `preis` ist der **Regalpreis** der Packung, so wie er an der Kassa steht —
 * und der Grundpreis wird daraus gerechnet, genau wie es `erfasse` in
 * `src/app/erfassen/aktionen.ts` tut.
 *
 * Der Umweg über das ganze Produkt statt bloß seiner Kennung ist der Kern
 * dieses Helfers: Ohne `menge`/`einheit` ließe sich der Grundpreis nicht
 * bilden, und die frühere Fassung setzte deshalb `grundpreis: preis`. Damit
 * waren in jeder Fixture Regal- und Grundpreis dieselbe Zahl — der Unterschied
 * zwischen beiden konnte in keinem Test messbar werden.
 */
async function beobachte(produkt: Produkt, kettenKuerzel: string, preis: number) {
  const ketten = await holeKetten(umgebung.db);
  const kette = ketten.find((k) => k.kuerzel === kettenKuerzel)!;
  const storeProductId = await sichereKettenProdukt(umgebung.db, { chainId: kette.id, productId: produkt.id });
  await schreibeBeobachtung(umgebung.db, {
    storeProductId,
    chainId: kette.id,
    productId: produkt.id,
    quelle: "MANUAL",
    preisart: "NORMAL",
    einzelpreis: preis,
    menge: 1,
    zeilensumme: preis,
    grundpreis: grundpreis(preis, { wert: produkt.menge, einheit: produkt.einheit })!,
    aktionGueltigBis: null,
  });
}

describe("berechneOptimierung", () => {
  it("findet die optimale Aufteilung über zwei Ketten", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const butter = await legeProduktAn(umgebung.db, { name: "Butter", marke: null, menge: 250, einheit: "G" });
    const milch = await legeProduktAn(umgebung.db, { name: "Milch", marke: null, menge: 1000, einheit: "ML" });

    await beobachte(butter, "spar", 2.49);
    await beobachte(butter, "hofer", 2.99);
    await beobachte(milch, "spar", 1.5);
    await beobachte(milch, "hofer", 1.19);

    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, butter.id);
    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, milch.id);

    const optimierung = await berechneOptimierung(umgebung.db, liste.id);

    expect(optimierung.aufteilungSumme).toBeCloseTo(2.49 + 1.19, 2);
    const sparZeile = optimierung.aufteilung.find((z) => z.kette.kuerzel === "spar");
    const hoferZeile = optimierung.aufteilung.find((z) => z.kette.kuerzel === "hofer");
    expect(sparZeile?.artikel).toHaveLength(1);
    expect(hoferZeile?.artikel).toHaveLength(1);
  });

  it("markiert eine Kette mit fehlendem Preis als unvollständig", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const butter = await legeProduktAn(umgebung.db, { name: "Butter Zwei", marke: null, menge: 250, einheit: "G" });
    const milch = await legeProduktAn(umgebung.db, { name: "Milch Zwei", marke: null, menge: 1000, einheit: "ML" });

    await beobachte(butter, "spar", 2.49);
    await beobachte(milch, "spar", 1.5);
    // Hofer kennt nur Butter, nicht die Milch.
    await beobachte(butter, "hofer", 2.99);

    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, butter.id);
    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, milch.id);

    const optimierung = await berechneOptimierung(umgebung.db, liste.id);

    const spar = optimierung.einzelmaerkte.find((k) => k.kette.kuerzel === "spar");
    const hofer = optimierung.einzelmaerkte.find((k) => k.kette.kuerzel === "hofer");
    expect(spar?.vollstaendig).toBe(true);
    expect(hofer?.vollstaendig).toBe(false);
    expect(optimierung.guenstigsterEinzelmarkt?.kette.kuerzel).toBe("spar");
  });

  it("berechnet die Ersparnis als Differenz zwischen bestem Einzelmarkt und Aufteilung", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const butter = await legeProduktAn(umgebung.db, { name: "Butter Drei", marke: null, menge: 250, einheit: "G" });
    const milch = await legeProduktAn(umgebung.db, { name: "Milch Drei", marke: null, menge: 1000, einheit: "ML" });

    await beobachte(butter, "spar", 2.49);
    await beobachte(milch, "spar", 1.5);
    await beobachte(butter, "hofer", 2.99);
    await beobachte(milch, "hofer", 1.19);

    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, butter.id);
    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, milch.id);

    const optimierung = await berechneOptimierung(umgebung.db, liste.id);

    // Bester Einzelmarkt: Spar (2.49+1.50=3.99) vs. Hofer (2.99+1.19=4.18) -> Spar günstiger.
    // Aufteilung: 2.49 (Spar) + 1.19 (Hofer) = 3.68.
    expect(optimierung.guenstigsterEinzelmarkt?.summe).toBeCloseTo(3.99, 2);
    expect(optimierung.aufteilungSumme).toBeCloseTo(3.68, 2);
    expect(optimierung.ersparnis).toBeCloseTo(3.99 - 3.68, 2);
  });

  it("bezieht Stückzahl in die Summe ein", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const butter = await legeProduktAn(umgebung.db, { name: "Butter Vier", marke: null, menge: 250, einheit: "G" });
    await beobachte(butter, "spar", 2.0);
    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, butter.id, 3);

    const optimierung = await berechneOptimierung(umgebung.db, liste.id);

    expect(optimierung.aufteilungSumme).toBeCloseTo(6.0, 2);
    expect(optimierung.guenstigsterEinzelmarkt?.summe).toBeCloseTo(6.0, 2);
  });

  it("lässt Freitext-Artikel aus beiden Rechnungen heraus", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const butter = await legeProduktAn(umgebung.db, { name: "Butter Fünf", marke: null, menge: 250, einheit: "G" });
    await beobachte(butter, "spar", 2.0);
    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, butter.id);
    await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Salz");

    const optimierung = await berechneOptimierung(umgebung.db, liste.id);

    expect(optimierung.aufteilungSumme).toBeCloseTo(2.0, 2);
    const alleArtikelInAufteilung = optimierung.aufteilung.flatMap((z) => z.artikel);
    expect(alleArtikelInAufteilung).toHaveLength(1);
  });

  /*
   * Die eigentliche Regressionsbremse: zwei Artikel mit sehr verschiedenen
   * Gebindegrößen. Wer hier Grundpreise statt Packungspreise addiert, bekommt
   * eine mit `BEZUG/menge` gewichtete Summe — und deren Minimum ist ein
   * anderes.
   *
   * Butter 250 g: Spar 2,00 € (= 8,00 €/kg), Hofer 2,40 € (= 9,60 €/kg).
   * Reis 5 kg:    Spar 10,00 € (= 2,00 €/kg), Hofer 8,00 € (= 1,60 €/kg).
   *
   * An der Kassa: Spar 12,00 €, Hofer 10,40 € — Hofer gewinnt.
   * Über Grundpreise: Spar 10,00, Hofer 11,20 — Spar gewönne, um 1,60 € zu
   * teuer. Genau diese Umkehrung ist der Fehler, den dieser Test festnagelt.
   */
  it("kürt den Einzelmarkt nach Kassabon, nicht nach der Summe der Grundpreise", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const butter = await legeProduktAn(umgebung.db, { name: "Butter Sieben", marke: null, menge: 250, einheit: "G" });
    const reis = await legeProduktAn(umgebung.db, { name: "Reis Sieben", marke: null, menge: 5000, einheit: "G" });

    await beobachte(butter, "spar", 2.0);
    await beobachte(butter, "hofer", 2.4);
    await beobachte(reis, "spar", 10.0);
    await beobachte(reis, "hofer", 8.0);

    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, butter.id);
    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, reis.id);

    const optimierung = await berechneOptimierung(umgebung.db, liste.id);

    expect(optimierung.guenstigsterEinzelmarkt?.kette.kuerzel).toBe("hofer");
    expect(optimierung.guenstigsterEinzelmarkt?.summe).toBeCloseTo(10.4, 2);

    const spar = optimierung.einzelmaerkte.find((k) => k.kette.kuerzel === "spar");
    expect(spar?.summe).toBeCloseTo(12.0, 2);

    // Aufteilung: Butter bei Spar (2,00 €), Reis bei Hofer (8,00 €).
    expect(optimierung.aufteilungSumme).toBeCloseTo(10.0, 2);
    expect(optimierung.ersparnis).toBeCloseTo(0.4, 2);
  });

  it("liefert keine Ersparnis, wenn keine Kette vollständig ist", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const butter = await legeProduktAn(umgebung.db, { name: "Butter Sechs", marke: null, menge: 250, einheit: "G" });
    const milch = await legeProduktAn(umgebung.db, { name: "Milch Sechs", marke: null, menge: 1000, einheit: "ML" });
    await beobachte(butter, "spar", 2.0);
    await beobachte(milch, "hofer", 1.0);
    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, butter.id);
    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, milch.id);

    const optimierung = await berechneOptimierung(umgebung.db, liste.id);

    expect(optimierung.guenstigsterEinzelmarkt).toBeNull();
    expect(optimierung.ersparnis).toBeNull();
  });
});

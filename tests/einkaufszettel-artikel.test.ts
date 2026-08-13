import { afterAll, describe, expect, it } from "bun:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { legeProduktAn } from "@/lib/katalog";
import {
  aendereStueckzahl,
  entferneArtikel,
  erzeugeListe,
  fuegeFreitextArtikelHinzu,
  fuegeKatalogArtikelHinzu,
  hakeItemAb,
  holeArtikel,
} from "@/lib/einkaufszettel";
import { faengtFehler } from "./helfer/fehler";
import { starteTestDatenbank } from "./helfer/db";

const umgebung = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });

afterAll(() => umgebung.stop());

describe("fuegeKatalogArtikelHinzu", () => {
  it("verknüpft ein Katalogprodukt, Stückzahl 1 als Vorgabe", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Butter",
      marke: "Berglandmilch",
      menge: 250,
      einheit: "G",
    });

    const artikel = await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, produkt.id);

    expect(artikel.produkt).toEqual(produkt);
    expect(artikel.freitext).toBeNull();
    expect(artikel.stueckzahl).toBe(1);
    expect(artikel.abgehaktAm).toBeNull();
  });

  it("übernimmt eine übergebene Stückzahl", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Milch",
      marke: null,
      menge: 1000,
      einheit: "ML",
    });

    const artikel = await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, produkt.id, 3);
    expect(artikel.stueckzahl).toBe(3);
  });
});

describe("fuegeFreitextArtikelHinzu", () => {
  it("legt einen Eintrag ohne Produktbezug an", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const artikel = await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Salz");

    expect(artikel.produkt).toBeNull();
    expect(artikel.freitext).toBe("Salz");
  });
});

describe("holeArtikel", () => {
  it("liefert alle Artikel einer Liste, nicht die einer anderen", async () => {
    const listeA = await erzeugeListe(umgebung.db, "A");
    const listeB = await erzeugeListe(umgebung.db, "B");
    await fuegeFreitextArtikelHinzu(umgebung.db, listeA.id, "Nur in A");
    await fuegeFreitextArtikelHinzu(umgebung.db, listeB.id, "Nur in B");

    const artikelA = await holeArtikel(umgebung.db, listeA.id);
    expect(artikelA).toHaveLength(1);
    expect(artikelA[0]?.freitext).toBe("Nur in A");
  });
});

describe("aendereStueckzahl / entferneArtikel / hakeItemAb", () => {
  it("ändert die Stückzahl", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const artikel = await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Zwiebeln");

    await aendereStueckzahl(umgebung.db, artikel.id, 5);

    const [aktualisiert] = await holeArtikel(umgebung.db, liste.id);
    expect(aktualisiert?.stueckzahl).toBe(5);
  });

  it("weist eine Stückzahl von null oder darunter ab", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const artikel = await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Zwiebeln");

    await faengtFehler(() => aendereStueckzahl(umgebung.db, artikel.id, 0));
  });

  it("entfernt einen Artikel", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const artikel = await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Zwiebeln");

    await entferneArtikel(umgebung.db, artikel.id);

    expect(await holeArtikel(umgebung.db, liste.id)).toHaveLength(0);
  });

  it("hakt einen Artikel ab", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const artikel = await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Zwiebeln");

    await hakeItemAb(umgebung.db, artikel.id);

    const [aktualisiert] = await holeArtikel(umgebung.db, liste.id);
    expect(aktualisiert?.abgehaktAm).not.toBeNull();
  });
});

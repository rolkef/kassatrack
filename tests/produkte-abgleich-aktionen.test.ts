import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { holeKetten, legeKettenAn, legeProduktAn } from "@/lib/katalog";
import { holeUngeklaerte, meldeUngeklaert } from "@/lib/ketten-abgleich";
import type { ZugriffsDb } from "@/lib/zugriff";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";

/*
 * Die drei Aktionen der Prüfliste, **direkt** gegen eine echte Datenbank.
 * Gleiche Begründung wie bei den übrigen Aktionstests dieser App:
 * Server-Aktionen sind eigene Endpunkte und über ihre Kennung auch ohne die
 * zugehörige Seite aufrufbar. Ein Test, der nur die Oberfläche betrachtet,
 * sagt nichts darüber, was beim Aufruf an ihr vorbei passiert.
 *
 * `migrate` muss laufen: `pg_trgm` kommt aus `drizzle/0005_wandering_trgm.sql`
 * und nicht aus dem Test-Helfer, sonst findet `sucheKatalog` keine
 * `similarity`-Funktion.
 */

/*
 * Datenbank und Schema entstehen auf oberster Ebene, nicht in `beforeAll`:
 * `aktionen.ts` wird weiter unten per `await import` geladen und bindet `db`
 * beim Importieren, und dieser Import läuft **vor** jedem `beforeAll`.
 */
const umgebung: TestDatenbank = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });

afterAll(async () => {
  await umgebung.stop();
});

const echtesCache = await import("next/cache");
await mock.module("next/cache", () => ({
  ...echtesCache,
  revalidatePath: () => {},
}));

await mock.module("@/db", () => ({ db: umgebung.db as ZugriffsDb }));

/*
 * Der Anhang `?echt` steht in einer Variablen und nicht als Literal im
 * `import`: Andere Testdateien ersetzen `@/lib/sitzung` ebenfalls für den
 * ganzen Lauf, und ein statisch auflösbarer Bezeichner bekäme je nach
 * Dateireihenfolge deren Attrappe und streute sie hier wieder hinein.
 * Ausführliche Begründung in `tests/erfassen-aktionen.test.ts`.
 */
const echterBezeichner = "@/lib/sitzung?echt";
const echteSitzung = (await import(echterBezeichner)) as typeof import("@/lib/sitzung");
await mock.module("@/lib/sitzung", () => ({
  ...echteSitzung,
  requireUser: async () => ({ id: "u1", email: "wer@example.at", name: "Wer" }),
}));

const { legeAlsNeuesProduktAn, ordneBestehendemProduktZu, sucheKatalog, verwerfe } = await import(
  "@/app/produkte/abgleich/aktionen"
);

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table chain_sync_ungeklaert, product cascade`);
  await legeKettenAn(umgebung.db);
});

/** Legt einen Prüflisten-Eintrag an und liefert ihn zurück. */
async function ungeklaert(eingabe: {
  feedId: string;
  rohname: string;
  menge?: number;
  einheit?: "G" | "ML" | "STK";
  preis?: number;
}) {
  const [kette] = await holeKetten(umgebung.db);
  await meldeUngeklaert(umgebung.db, {
    chainId: kette.id,
    feedId: eingabe.feedId,
    rohname: eingabe.rohname,
    menge: eingabe.menge ?? 250,
    einheit: eingabe.einheit ?? "G",
    preis: eingabe.preis ?? 2.49,
  });

  const liste = await holeUngeklaerte(umgebung.db);
  const eintrag = liste.find((e) => e.feedId === eingabe.feedId);
  if (!eintrag) throw new Error("Prüflisten-Eintrag wurde nicht angelegt.");
  return eintrag;
}

describe("ordneBestehendemProduktZu", () => {
  it("verknüpft den Prüflisten-Eintrag mit einem bestehenden Produkt", async () => {
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Butter Abgleich",
      menge: 250,
      einheit: "G",
    });
    const eintrag = await ungeklaert({ feedId: "abg-1", rohname: "BUTT.EXTRA" });

    const ergebnis = await ordneBestehendemProduktZu(eintrag.id, produkt.id);

    expect(ergebnis.erfolg).toBe(true);
    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(0);
  });

  /*
   * Der Feed-Produktcode muss mitgeschrieben werden, sonst landet derselbe
   * Artikel beim nächsten Lauf wieder auf der Prüfliste — die Arbeit an
   * diesem Bildschirm wäre dann jeden Tag aufs Neue zu tun.
   */
  it("merkt sich den Feed-Produktcode, damit der Artikel nicht wiederkommt", async () => {
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Butter Abgleich",
      menge: 250,
      einheit: "G",
    });
    const eintrag = await ungeklaert({ feedId: "abg-wieder", rohname: "BUTT.EXTRA" });

    await ordneBestehendemProduktZu(eintrag.id, produkt.id);

    const { findeStoreProductPerFeedCode } = await import("@/lib/ketten-abgleich");
    expect(
      await findeStoreProductPerFeedCode(umgebung.db, eintrag.chainId, "abg-wieder"),
    ).not.toBeNull();
  });

  it("meldet einen Fehler bei unbekannter ungeklaertId", async () => {
    const produkt = await legeProduktAn(umgebung.db, { name: "Egal", menge: 1, einheit: "STK" });

    const ergebnis = await ordneBestehendemProduktZu("existiert-nicht", produkt.id);

    expect(ergebnis.erfolg).toBe(false);
  });
});

describe("legeAlsNeuesProduktAn", () => {
  it("legt ein neues Produkt an und verknüpft es", async () => {
    const eintrag = await ungeklaert({
      feedId: "abg-2",
      rohname: "Neuer Artikel",
      menge: 500,
      einheit: "ML",
      preis: 1.99,
    });

    const ergebnis = await legeAlsNeuesProduktAn(eintrag.id, {
      name: "Neuer Artikel",
      marke: null,
    });

    expect(ergebnis.erfolg).toBe(true);
    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(0);
  });

  /*
   * Menge und Einheit stammen aus dem Feed und nicht aus dem Formular: Sie
   * sind die Tatsache, an der `findeProdukt` später „Butter 250 g" von
   * „Butter 500 g" unterscheidet. Käme hier etwas anderes an als im Feed
   * stand, verglichen sich zwei verschiedene Gebinde in einer Reihe.
   */
  it("übernimmt Menge und Einheit unverändert aus dem Prüflisten-Eintrag", async () => {
    const eintrag = await ungeklaert({
      feedId: "abg-menge",
      rohname: "Saft",
      menge: 1000,
      einheit: "ML",
    });

    await legeAlsNeuesProduktAn(eintrag.id, { name: "Orangensaft", marke: "Rauch" });

    const { sucheProdukte } = await import("@/lib/katalog");
    const [produkt] = await sucheProdukte(umgebung.db, "Orangensaft");
    expect(produkt.menge).toBe(1000);
    expect(produkt.einheit).toBe("ML");
    expect(produkt.marke).toBe("Rauch");
  });

  /*
   * Derselbe Schutz wie auf dem Erfassungspfad (`src/app/erfassen/aktionen.ts`):
   * erst `findeProdukt`, nur bei Fehlanzeige anlegen. Ohne ihn entsteht beim
   * Tippen eines Namens, den es mit gleicher Marke, Menge und Einheit schon
   * gibt, ein zweites Produkt — und die Preisgeschichte der Ware zerfiele
   * still in zwei Hälften, mit je einer halb gefüllten Preismatrix. Genau der
   * Schaden, den `findeProdukt` laut seinem eigenen Doc-Kommentar verhindert.
   */
  it("greift ein bestehendes Produkt auf, statt ein zweites anzulegen", async () => {
    const vorhanden = await legeProduktAn(umgebung.db, {
      name: "Butter",
      marke: "Berglandmilch",
      menge: 250,
      einheit: "G",
    });
    const eintrag = await ungeklaert({ feedId: "abg-dedup", rohname: "BUTT.EXTRA" });

    // Groß-/Kleinschreibung und Randleerzeichen zählen nicht — `findeProdukt`
    // vergleicht normalisiert, und genau so tippt ein Mensch.
    const ergebnis = await legeAlsNeuesProduktAn(eintrag.id, {
      name: "  butter  ",
      marke: "berglandmilch",
    });

    expect(ergebnis.erfolg).toBe(true);

    const { sucheProdukte } = await import("@/lib/katalog");
    const treffer = await sucheProdukte(umgebung.db, "Butter");
    expect(treffer).toHaveLength(1);
    expect(treffer[0].id).toBe(vorhanden.id);
  });

  /*
   * Die Kehrseite: Gleicher Name, aber anderes Gebinde ist eine andere Ware.
   * „Butter 250 g" und „Butter 500 g" dürfen nicht zusammenfallen, sonst
   * mischen sich ihre Grundpreise in einer Reihe.
   */
  it("legt bei gleichem Namen, aber anderer Menge ein eigenes Produkt an", async () => {
    await legeProduktAn(umgebung.db, { name: "Butter", marke: null, menge: 250, einheit: "G" });
    const eintrag = await ungeklaert({ feedId: "abg-gebinde", rohname: "BUTT", menge: 500 });

    await legeAlsNeuesProduktAn(eintrag.id, { name: "Butter", marke: null });

    const { sucheProdukte } = await import("@/lib/katalog");
    const treffer = await sucheProdukte(umgebung.db, "Butter");
    expect(treffer).toHaveLength(2);
    expect(treffer.map((p) => p.menge).sort((a, b) => a - b)).toEqual([250, 500]);
  });

  it("meldet einen Fehler bei unbekannter ungeklaertId, ohne ein Produkt anzulegen", async () => {
    const ergebnis = await legeAlsNeuesProduktAn("existiert-nicht", {
      name: "Geisterware",
      marke: null,
    });

    expect(ergebnis.erfolg).toBe(false);

    const { sucheProdukte } = await import("@/lib/katalog");
    expect(await sucheProdukte(umgebung.db, "Geisterware")).toHaveLength(0);
  });
});

describe("verwerfe", () => {
  it("löscht den Eintrag ohne Zuordnung", async () => {
    const eintrag = await ungeklaert({
      feedId: "abg-3",
      rohname: "Wird verworfen",
      menge: 1,
      einheit: "STK",
      preis: 0.5,
    });

    await verwerfe(eintrag.id);

    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(0);
  });

  /*
   * Verwerfen darf **keine** Ketten-Zuordnung hinterlassen. Täte es das,
   * schriebe der nächste Lauf Preise unter irgendein Produkt fort, das
   * niemand je bestätigt hat.
   */
  it("legt dabei keine Ketten-Zuordnung an", async () => {
    const eintrag = await ungeklaert({ feedId: "abg-4", rohname: "Weg damit" });

    await verwerfe(eintrag.id);

    const { findeStoreProductPerFeedCode } = await import("@/lib/ketten-abgleich");
    expect(await findeStoreProductPerFeedCode(umgebung.db, eintrag.chainId, "abg-4")).toBeNull();
  });
});

describe("sucheKatalog", () => {
  it("findet ein Produkt über den Katalog", async () => {
    await legeProduktAn(umgebung.db, { name: "Butter", menge: 250, einheit: "G" });

    const treffer = await sucheKatalog("Butter");

    expect(treffer.map((p) => p.name)).toContain("Butter");
  });

  it("liefert für einen leeren Begriff nichts", async () => {
    await legeProduktAn(umgebung.db, { name: "Butter", menge: 250, einheit: "G" });

    expect(await sucheKatalog("   ")).toHaveLength(0);
  });
});

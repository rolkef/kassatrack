import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { erzeugeListe, holeArtikel } from "@/lib/einkaufszettel";
import { legeKettenAn, legeProduktAn } from "@/lib/katalog";
import { holePreisMatrix } from "@/lib/preise";
import type { ZugriffsDb } from "@/lib/zugriff";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

/*
 * Die vier Aktionen des Listendetails, **direkt** gegen eine echte Datenbank —
 * gleiche Begründung wie in `tests/einkaufszettel-aktionen.test.ts`:
 * Server-Aktionen sind eigene Endpunkte und über ihre Kennung auch ohne die
 * zugehörige Seite aufrufbar. Ein Test, der nur die Oberfläche betrachtet,
 * sagt nichts darüber, was beim Aufruf an ihr vorbei passiert.
 *
 * Jede Abweisung zählt zusätzlich nach, dass nichts geschrieben wurde. Ein
 * abgewiesener Aufruf, der trotzdem eine leere Zeile auf dem Zettel
 * hinterlässt, wäre genau der Fehler, den man erst im Geschäft bemerkt.
 *
 * `pg_trgm` kommt aus der Migration, nicht aus dem Test-Helfer — deshalb muss
 * `migrate` hier laufen, sonst findet `sucheProdukteAktion` keine
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

/** Ob `requireUser` die angemeldete Person liefert oder wie ohne Sitzung wirft. */
let angemeldet = true;

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
  requireUser: async () => {
    // Ohne Sitzung ruft das echte `requireUser` `redirect("/anmelden")` auf,
    // und `redirect` wirft. Die Attrappe bildet genau das nach.
    if (!angemeldet) throw new Error("NEXT_REDIRECT;/anmelden");
    return { id: "u1", email: "wer@example.at", name: "Wer" };
  },
}));

const {
  artikelHinzufuegenAktion,
  entferneArtikelAktion,
  erfassePreisAktion,
  stueckzahlAktion,
  sucheProdukteAktion,
} = await import("@/app/einkaufszettel/[id]/aktionen");

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table shopping_list, product cascade`);
  // Die Ketten stehen außerhalb des `truncate` — `erfassePreisAktion` braucht
  // sie, weil `erfasse` das Kürzel aus dem Formular gegen sie auflöst.
  await legeKettenAn(umgebung.db);
  angemeldet = true;
});

async function liste(name = "Wocheneinkauf") {
  return erzeugeListe(umgebung.db, name);
}

describe("artikelHinzufuegenAktion", () => {
  it("fügt ein Katalogprodukt hinzu", async () => {
    const zettel = await liste();
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Butter",
      marke: null,
      menge: 250,
      einheit: "G",
    });

    await artikelHinzufuegenAktion({ listId: zettel.id, produktId: produkt.id });

    const artikel = await holeArtikel(umgebung.db, zettel.id);
    expect(artikel).toHaveLength(1);
    expect(artikel[0]?.produkt?.id).toBe(produkt.id);
    expect(artikel[0]?.stueckzahl).toBe(1);
  });

  it("fügt einen Freitext-Artikel hinzu und schneidet Leerraum ab", async () => {
    const zettel = await liste();

    await artikelHinzufuegenAktion({ listId: zettel.id, freitext: "  Salz  " });

    const artikel = await holeArtikel(umgebung.db, zettel.id);
    expect(artikel[0]?.freitext).toBe("Salz");
    expect(artikel[0]?.produkt).toBeNull();
  });

  it("übernimmt eine mitgegebene Stückzahl", async () => {
    const zettel = await liste();

    await artikelHinzufuegenAktion({ listId: zettel.id, freitext: "Salz", stueckzahl: 3 });

    expect((await holeArtikel(umgebung.db, zettel.id))[0]?.stueckzahl).toBe(3);
  });

  /*
   * `fuegeFreitextArtikelHinzu` trimmt zwar, prüft aber nicht — ein Freitext
   * aus lauter Leerzeichen käme als leere Zeichenkette durch. Die
   * Datenbankbedingung `genau_eine_quelle` fängt das **nicht** ab: Sie prüft
   * auf `not null`, und "" ist nicht null. Auf dem Zettel stünde danach eine
   * Zeile ohne jeden Text.
   */
  it("weist einen leeren Freitext ab, ohne etwas anzulegen", async () => {
    const zettel = await liste();

    const fehler = await faengtFehler(() =>
      artikelHinzufuegenAktion({ listId: zettel.id, freitext: "   " }),
    );

    expect(fehler).toBeDefined();
    expect(await holeArtikel(umgebung.db, zettel.id)).toHaveLength(0);
  });

  it("weist einen Aufruf ohne Produkt und ohne Freitext ab", async () => {
    const zettel = await liste();

    const fehler = await faengtFehler(() => artikelHinzufuegenAktion({ listId: zettel.id }));

    expect(fehler).toBeDefined();
    expect(await holeArtikel(umgebung.db, zettel.id)).toHaveLength(0);
  });

  /*
   * Beides zugleich ist kein Fall, den die Oberfläche erzeugt — aber ein
   * Aufruf an ihr vorbei kann es. Stillschweigend eines von beidem zu wählen
   * hieße, eine Verwechslung des Aufrufers als Absicht zu deuten.
   */
  it("weist Produkt und Freitext zugleich ab", async () => {
    const zettel = await liste();
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Butter",
      marke: null,
      menge: 250,
      einheit: "G",
    });

    const fehler = await faengtFehler(() =>
      artikelHinzufuegenAktion({ listId: zettel.id, produktId: produkt.id, freitext: "Salz" }),
    );

    expect(fehler).toBeDefined();
    expect(await holeArtikel(umgebung.db, zettel.id)).toHaveLength(0);
  });

  it("weist eine gebrochene Stückzahl ab, ohne etwas anzulegen", async () => {
    const zettel = await liste();

    const fehler = await faengtFehler(() =>
      artikelHinzufuegenAktion({ listId: zettel.id, freitext: "Salz", stueckzahl: 2.5 }),
    );

    expect(fehler).toBeDefined();
    expect(await holeArtikel(umgebung.db, zettel.id)).toHaveLength(0);
  });

  it("verlangt eine Anmeldung, ohne etwas anzulegen", async () => {
    const zettel = await liste();
    angemeldet = false;

    const fehler = await faengtFehler(() =>
      artikelHinzufuegenAktion({ listId: zettel.id, freitext: "Heimlich" }),
    );

    expect(fehler).toBeDefined();
    angemeldet = true;
    expect(await holeArtikel(umgebung.db, zettel.id)).toHaveLength(0);
  });
});

describe("stueckzahlAktion", () => {
  it("ändert die Stückzahl", async () => {
    const zettel = await liste();
    await artikelHinzufuegenAktion({ listId: zettel.id, freitext: "Salz" });
    const [artikel] = await holeArtikel(umgebung.db, zettel.id);

    await stueckzahlAktion(artikel!.id, 4, zettel.id);

    expect((await holeArtikel(umgebung.db, zettel.id))[0]?.stueckzahl).toBe(4);
  });

  /*
   * Ohne `order by` in `ladeArtikel` liefert Postgres die Heap-Reihenfolge,
   * und ein `update` schreibt die geänderte Zeile ans Ende: Aus
   * `Butter, Salz, Milch` wurde nach einer Stückzahländerung an Butter
   * `Salz, Milch, Butter`. Der Artikel, den man gerade angefasst hat, sprang
   * also unter den Augen nach unten — bei der häufigsten Geste dieses
   * Bildschirms.
   *
   * Geprüft wird **Stabilität**, nicht die Einfügereihenfolge: Die wäre die
   * eigentlich richtige Ordnung, braucht aber eine eigene Zeitspalte und
   * damit eine Migration. Bis dahin genügt, dass sich die Reihenfolge durch
   * ein Ändern nicht verschiebt.
   */
  it("lässt die Reihenfolge der Artikel unberührt", async () => {
    const zettel = await liste();
    for (const name of ["Butter", "Salz", "Milch"]) {
      await artikelHinzufuegenAktion({ listId: zettel.id, freitext: name });
    }
    const vorher = (await holeArtikel(umgebung.db, zettel.id)).map((a) => a.freitext);
    const butter = (await holeArtikel(umgebung.db, zettel.id)).find(
      (a) => a.freitext === "Butter",
    );

    await stueckzahlAktion(butter!.id, 5, zettel.id);

    const nachher = (await holeArtikel(umgebung.db, zettel.id)).map((a) => a.freitext);
    expect(nachher).toEqual(vorher);
  });

  /*
   * Null wäre nicht „entfernt", sondern eine Zeile, die nichts verlangt — und
   * die Datenbankbedingung `stueckzahl_positiv` wiese sie ohnehin ab, dort
   * aber als technischer Fehler. Entfernen ist eine eigene Handlung.
   */
  it("weist eine Stückzahl unter 1 ab und lässt die alte stehen", async () => {
    const zettel = await liste();
    await artikelHinzufuegenAktion({ listId: zettel.id, freitext: "Salz", stueckzahl: 2 });
    const [artikel] = await holeArtikel(umgebung.db, zettel.id);

    const fehler = await faengtFehler(() => stueckzahlAktion(artikel!.id, 0, zettel.id));

    expect(fehler).toBeDefined();
    expect((await holeArtikel(umgebung.db, zettel.id))[0]?.stueckzahl).toBe(2);
  });

  it("weist eine gebrochene Stückzahl ab und lässt die alte stehen", async () => {
    const zettel = await liste();
    await artikelHinzufuegenAktion({ listId: zettel.id, freitext: "Salz", stueckzahl: 2 });
    const [artikel] = await holeArtikel(umgebung.db, zettel.id);

    const fehler = await faengtFehler(() => stueckzahlAktion(artikel!.id, 3.5, zettel.id));

    expect(fehler).toBeDefined();
    expect((await holeArtikel(umgebung.db, zettel.id))[0]?.stueckzahl).toBe(2);
  });

  it("verlangt eine Anmeldung und lässt die Stückzahl stehen", async () => {
    const zettel = await liste();
    await artikelHinzufuegenAktion({ listId: zettel.id, freitext: "Salz", stueckzahl: 2 });
    const [artikel] = await holeArtikel(umgebung.db, zettel.id);

    angemeldet = false;
    const fehler = await faengtFehler(() => stueckzahlAktion(artikel!.id, 9, zettel.id));

    expect(fehler).toBeDefined();
    angemeldet = true;
    expect((await holeArtikel(umgebung.db, zettel.id))[0]?.stueckzahl).toBe(2);
  });
});

describe("entferneArtikelAktion", () => {
  it("entfernt einen Artikel", async () => {
    const zettel = await liste();
    await artikelHinzufuegenAktion({ listId: zettel.id, freitext: "Salz" });
    const [artikel] = await holeArtikel(umgebung.db, zettel.id);

    await entferneArtikelAktion(artikel!.id, zettel.id);

    expect(await holeArtikel(umgebung.db, zettel.id)).toHaveLength(0);
  });

  it("verlangt eine Anmeldung und lässt den Artikel stehen", async () => {
    const zettel = await liste();
    await artikelHinzufuegenAktion({ listId: zettel.id, freitext: "Salz" });
    const [artikel] = await holeArtikel(umgebung.db, zettel.id);

    angemeldet = false;
    const fehler = await faengtFehler(() => entferneArtikelAktion(artikel!.id, zettel.id));

    expect(fehler).toBeDefined();
    angemeldet = true;
    expect(await holeArtikel(umgebung.db, zettel.id)).toHaveLength(1);
  });
});

describe("sucheProdukteAktion", () => {
  it("findet ein Produkt über Ähnlichkeit", async () => {
    await legeProduktAn(umgebung.db, {
      name: "Buttermilch",
      marke: null,
      menge: 500,
      einheit: "ML",
    });

    const treffer = await sucheProdukteAktion("Buttermilch");

    expect(treffer).toHaveLength(1);
    expect(treffer[0]?.name).toBe("Buttermilch");
  });

  /*
   * Der Punkt der Trigrammsuche: Vor dem Regal wird einhändig getippt. Fände
   * „Buter" die Butter nicht, legte man sie ein zweites Mal an.
   */
  it("verzeiht einen Tippfehler", async () => {
    await legeProduktAn(umgebung.db, { name: "Butter", marke: null, menge: 250, einheit: "G" });

    expect(await sucheProdukteAktion("Buter")).toHaveLength(1);
  });

  it("liefert zu einem leeren Begriff nichts", async () => {
    await legeProduktAn(umgebung.db, { name: "Butter", marke: null, menge: 250, einheit: "G" });

    expect(await sucheProdukteAktion("   ")).toHaveLength(0);
  });

  it("verlangt eine Anmeldung", async () => {
    angemeldet = false;

    const fehler = await faengtFehler(() => sucheProdukteAktion("Butter"));

    expect(fehler).toBeDefined();
  });
});

/*
 * Der Abhak-Fluss von der Serverseite.
 *
 * Geprüft wird hier nicht `erfasse` noch einmal — das tut
 * `tests/erfassen-aktionen.test.ts` in aller Ausführlichkeit, inklusive des
 * Rückbaus mitten in der Transaktion. Geprüft wird, dass die Hülle des
 * Listendetails *genau* das durchreicht: dass ein Abhaken über sie wirklich
 * Preis **und** Haken hinterlässt, und dass eine abgewiesene Eingabe weder das
 * eine noch das andere zurücklässt.
 */
describe("erfassePreisAktion", () => {
  async function zettelMitButter() {
    const zettel = await liste();
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Butter",
      marke: "Berglandmilch",
      menge: 250,
      einheit: "G",
    });
    await artikelHinzufuegenAktion({ listId: zettel.id, produktId: produkt.id });
    const [artikel] = await holeArtikel(umgebung.db, zettel.id);
    return { zettel, artikel: artikel! };
  }

  function formular(zettelId: string, artikelId: string, preis: string): FormData {
    const daten = new FormData();
    daten.set("zettelItemId", artikelId);
    daten.set("listId", zettelId);
    daten.set("kette", "spar");
    daten.set("name", "Butter");
    daten.set("marke", "Berglandmilch");
    daten.set("menge", "250 g");
    daten.set("preisart", "NORMAL");
    daten.set("preis", preis);
    return daten;
  }

  it("erfasst den Preis und hakt den Artikel ab", async () => {
    const { zettel, artikel } = await zettelMitButter();

    const ergebnis = await erfassePreisAktion(
      undefined,
      formular(zettel.id, artikel.id, "2,49"),
    );

    expect(ergebnis.art).toBe("erfolg");

    const [danach] = await holeArtikel(umgebung.db, zettel.id);
    expect(danach?.abgehaktAm).toBeInstanceOf(Date);

    // Und der Preis liegt tatsächlich bei Spar, nicht bloß irgendwo.
    const matrix = await holePreisMatrix(umgebung.db, artikel.produkt!.id);
    const spar = matrix.find((zeile) => zeile.kette.kuerzel === "spar");
    expect(spar?.bestpreis).toBeGreaterThan(0);
  });

  /*
   * Die Zusage aus dem Entwurf: Abhaken und Preis speichern sind ein Vorgang.
   * Bricht die Prüfung ab, bleibt der Artikel unabgehakt — sonst stünde ein
   * Häkchen über einem Preis, den es nie gegeben hat.
   */
  it("lässt den Artikel unabgehakt, wenn die Eingabe abgewiesen wird", async () => {
    const { zettel, artikel } = await zettelMitButter();

    const ergebnis = await erfassePreisAktion(undefined, formular(zettel.id, artikel.id, "-1"));

    expect(ergebnis.art).toBe("fehler");

    const [danach] = await holeArtikel(umgebung.db, zettel.id);
    expect(danach?.abgehaktAm).toBeNull();
    expect(await holePreisMatrix(umgebung.db, artikel.produkt!.id)).toHaveLength(5);
    expect(
      (await holePreisMatrix(umgebung.db, artikel.produkt!.id)).every(
        (zeile) => zeile.bestpreis === null,
      ),
    ).toBe(true);
  });

  it("verlangt eine Anmeldung", async () => {
    const { zettel, artikel } = await zettelMitButter();
    angemeldet = false;

    const fehler = await faengtFehler(() =>
      erfassePreisAktion(undefined, formular(zettel.id, artikel.id, "2,49")),
    );

    expect(fehler).toBeDefined();
    angemeldet = true;
    const [danach] = await holeArtikel(umgebung.db, zettel.id);
    expect(danach?.abgehaktAm).toBeNull();
  });
});

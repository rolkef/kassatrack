import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { legeProduktAn, sucheProdukte } from "@/lib/katalog";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";

let umgebung: TestDatenbank;

/*
 * Der Katalog steht einmal und bleibt stehen: Die Suche liest nur, und ein
 * `truncate` vor jedem Fall würde jeden Test dazu zwingen, seine eigenen
 * Produkte anzulegen — ohne dass die Fälle dadurch unabhängiger würden.
 */
beforeAll(async () => {
  umgebung = await starteTestDatenbank();
  await migrate(umgebung.db, { migrationsFolder: "./drizzle" });

  /*
   * „Buttermilch" steht bewusst **vor** „Butter": Ohne `order by` liefert der
   * sequenzielle Scan die Zeilen in Einfügereihenfolge, und der
   * Reihenfolge-Test unten wäre grün, ohne je etwas geprüft zu haben.
   */
  await legeProduktAn(umgebung.db, { name: "Buttermilch", menge: 500, einheit: "ML" });
  await legeProduktAn(umgebung.db, {
    name: "Butter",
    marke: "Kärntnermilch",
    menge: 250,
    einheit: "G",
  });
  await legeProduktAn(umgebung.db, { name: "Vollmilch", marke: "Schärdinger", menge: 1000, einheit: "ML" });
  await legeProduktAn(umgebung.db, { name: "Toastbrot", menge: 500, einheit: "G" });
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

describe("sucheProdukte", () => {
  it("findet den exakten Treffer", async () => {
    const treffer = await sucheProdukte(umgebung.db, "Butter");
    expect(treffer.map((p) => p.name)).toContain("Butter");
  });

  /*
   * Der eigentliche Grund für die Trigramm-Suche. Vor dem Regal tippt man
   * einhändig und daneben; ein `like`-Vergleich fände hier nichts und die
   * Person legte das Produkt ein zweites Mal an — und damit eine zweite,
   * halb gefüllte Preismatrix.
   */
  it("findet trotz Tippfehler", async () => {
    const treffer = await sucheProdukte(umgebung.db, "Buter");
    expect(treffer.map((p) => p.name)).toContain("Butter");
  });

  it("findet über die Marke", async () => {
    const treffer = await sucheProdukte(umgebung.db, "Schärdinger");
    expect(treffer.map((p) => p.name)).toContain("Vollmilch");
  });

  /*
   * Ein leerer Begriff darf nicht den ganzen Katalog ausschütten: Die Suchseite
   * ruft ohne Eingabe genauso auf wie mit, und „alles" wäre dort keine Antwort,
   * sondern eine Liste, die mit dem Katalog mitwächst.
   */
  it.each([
    ["leer", ""],
    ["nur Leerzeichen", "   "],
  ])("liefert für einen %s Begriff nichts", async (_name, begriff) => {
    expect(await sucheProdukte(umgebung.db, begriff)).toEqual([]);
  });

  it("liefert eine leere Liste, wenn nichts passt", async () => {
    expect(await sucheProdukte(umgebung.db, "Zahnbürste")).toEqual([]);
  });

  /*
   * Die Reihenfolge ist die halbe Suche: Wer „Butter" tippt, will „Butter"
   * zuoberst, nicht „Buttermilch". Ohne `order by` liefert Postgres die
   * Zeilen in beliebiger Reihenfolge, und der Fall fiele erst im Regal auf.
   */
  it("sortiert den ähnlicheren Treffer nach vorn", async () => {
    const treffer = await sucheProdukte(umgebung.db, "Butter");
    expect(treffer[0]?.name).toBe("Butter");
    expect(treffer.map((p) => p.name)).toContain("Buttermilch");
  });

  it("liefert Menge und Einheit mit, weil sie zwei Waren unterscheiden", async () => {
    const [treffer] = await sucheProdukte(umgebung.db, "Toastbrot");
    expect(treffer?.menge).toBe(500);
    expect(treffer?.einheit).toBe("G");
  });
});

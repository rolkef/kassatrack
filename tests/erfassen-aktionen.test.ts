import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { legeKettenAn } from "@/lib/katalog";
import type { ZugriffsDb } from "@/lib/zugriff";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

/*
 * Prüft die Server-Aktion **direkt** gegen eine echte Datenbank.
 *
 * Der Grund ist derselbe wie in `tests/verwaltung-aktionen.test.ts`:
 * Server-Aktionen sind eigene Endpunkte und ohne die zugehörige Seite
 * aufrufbar. Ein Test, der nur das Formular betrachtet, sagt nichts darüber,
 * was beim Aufruf an der Oberfläche vorbei passiert.
 *
 * Jeder Abweisungsfall zählt zusätzlich die Zeilen nach. Eine Fehlermeldung
 * allein beweist nicht, dass nichts angelegt wurde — und genau das ist hier die
 * Zusage: Wer eine unverständliche Menge eintippt, hinterlässt keine halbe
 * Preisbeobachtung und kein Geisterprodukt im Katalog.
 */

/*
 * Datenbank, Schema und Ketten entstehen auf oberster Ebene, nicht in
 * `beforeAll`: Die Aktion wird weiter unten per `await import` geladen, und
 * dieser Import läuft **vor** jedem `beforeAll`. `aktionen.ts` bindet `db`
 * beim Importieren.
 */
const umgebung: TestDatenbank = await starteTestDatenbank();

{
  // Die echte Migration statt von Hand nachgebautem DDL: Nur so gelten hier
  // dieselben Prüfbedingungen wie in der Produktionsdatenbank — etwa
  // `preis_aktion_hat_ende`, an der sich der PROMO-Fall unten entscheidet.
  await migrate(umgebung.db, { migrationsFolder: "./drizzle" });
  await legeKettenAn(umgebung.db);
}

afterAll(async () => {
  await umgebung.stop();
});

/** Ob `requireUser` die angemeldete Person liefert oder wie ohne Sitzung wirft. */
let angemeldet = true;

/*
 * Beide Attrappen streuen das echte Modul hinein und überschreiben nur, was
 * gestellt sein muss. `mock.module` gilt in Bun für den **gesamten** Lauf;
 * eine Attrappe, die Exporte weglässt, nähme sie jeder anderen Testdatei weg,
 * und der Fehler erschiene in einer Datei, die mit dieser nichts zu tun hat.
 * Ausführliche Begründung in `tests/verwaltung-aktionen.test.ts`.
 */
const echtesCache = await import("next/cache");
await mock.module("next/cache", () => ({ ...echtesCache, revalidatePath: () => {} }));

// `@/db` exportiert nur `db` — hier ist die Streuung entbehrlich.
await mock.module("@/db", () => ({ db: umgebung.db as ZugriffsDb }));

const echteSitzung = await import("@/lib/sitzung");
await mock.module("@/lib/sitzung", () => ({
  ...echteSitzung,
  requireUser: async () => {
    // Ohne Sitzung ruft das echte `requireUser` `redirect("/anmelden")` auf,
    // und `redirect` wirft. Die Attrappe bildet genau das nach.
    if (!angemeldet) throw new Error("NEXT_REDIRECT;/anmelden");
    return { id: "u1", email: "wer@example.at", name: "Wer" };
  },
}));

const { erfasse } = await import("@/app/erfassen/aktionen");

/** Baut ein FormData wie es das Formular schickt. */
function formular(felder: Record<string, string>): FormData {
  const daten = new FormData();
  for (const [schluessel, wert] of Object.entries(felder)) daten.set(schluessel, wert);
  return daten;
}

const gueltig = {
  kette: "billa",
  name: "Butter",
  menge: "250 g",
  preis: "2,49",
  preisart: "NORMAL",
};

async function anzahl(tabelle: "price_observation" | "product" | "store_product"): Promise<number> {
  const ergebnis = await umgebung.db.execute(
    sql`select count(*)::int as n from ${sql.identifier(tabelle)}`,
  );
  return (ergebnis.rows as { n: number }[])[0].n;
}

/** Nach jeder Abweisung muss **alles** unberührt sein, nicht nur die Beobachtung. */
async function nichtsAngelegt(): Promise<{ beobachtungen: number; produkte: number; zuordnungen: number }> {
  return {
    beobachtungen: await anzahl("price_observation"),
    produkte: await anzahl("product"),
    zuordnungen: await anzahl("store_product"),
  };
}

const UNBERUEHRT = { beobachtungen: 0, produkte: 0, zuordnungen: 0 };

beforeEach(async () => {
  // `cascade` wegen `product_ean`: Die Tabelle zeigt auf `product` und wird
  // hier nie gefüllt, verhindert aber jedes Leeren ohne sie.
  await umgebung.db.execute(sql`truncate table product cascade`);
  angemeldet = true;
});

describe("erfasse", () => {
  it("legt Produkt und Beobachtung an und liefert den Grundpreis", async () => {
    const ergebnis = await erfasse(undefined, formular(gueltig));

    expect(ergebnis.art).toBe("erfolg");
    if (ergebnis.art !== "erfolg") return;
    expect(ergebnis.grundpreis).toBe("9,96 €/kg");
    expect(await anzahl("price_observation")).toBe(1);
    expect(await anzahl("product")).toBe(1);
  });

  it("schreibt die Beobachtung der gewählten Kette zu", async () => {
    await erfasse(undefined, formular({ ...gueltig, kette: "hofer" }));

    const zeilen = await umgebung.db.execute(sql`
      select c.kuerzel, o.quelle, o.preisart, o.einzelpreis, o.grundpreis
      from price_observation o join chain c on c.id = o.chain_id
    `);
    const zeile = (zeilen.rows as Record<string, string>[])[0];
    expect(zeile.kuerzel).toBe("hofer");
    expect(zeile.quelle).toBe("MANUAL");
    expect(zeile.preisart).toBe("NORMAL");
    expect(Number(zeile.einzelpreis)).toBeCloseTo(2.49, 4);
    expect(Number(zeile.grundpreis)).toBeCloseTo(9.96, 4);
  });

  /*
   * Der Kern der ganzen App: Derselbe Artikel bei zwei Ketten muss **ein**
   * Produkt treffen. Entstünden zwei, stünde je ein Preis daneben und keine
   * Zeile verglichen jemals irgendetwas — die Preismatrix aus Task 6 wäre
   * dauerhaft leer, ohne dass ein Test das bemerkt.
   */
  it("erfasst denselben Artikel bei zwei Ketten als ein Produkt", async () => {
    await erfasse(undefined, formular({ ...gueltig, kette: "billa" }));
    await erfasse(undefined, formular({ ...gueltig, kette: "spar", preis: "2,29" }));

    expect(await anzahl("product")).toBe(1);
    expect(await anzahl("store_product")).toBe(2);
    expect(await anzahl("price_observation")).toBe(2);
  });

  it("erkennt denselben Artikel auch bei abweichender Schreibweise", async () => {
    await erfasse(undefined, formular(gueltig));
    await erfasse(undefined, formular({ ...gueltig, name: "  butter  ", kette: "spar" }));

    expect(await anzahl("product")).toBe(1);
  });

  it("hält eine andere Menge desselben Namens auseinander", async () => {
    await erfasse(undefined, formular(gueltig));
    await erfasse(undefined, formular({ ...gueltig, menge: "500 g" }));

    expect(await anzahl("product")).toBe(2);
  });

  it("hält zwei Marken desselben Namens auseinander", async () => {
    await erfasse(undefined, formular({ ...gueltig, marke: "Kärntnermilch" }));
    await erfasse(undefined, formular({ ...gueltig, marke: "Schärdinger" }));

    expect(await anzahl("product")).toBe(2);
  });

  it("legt die Ketten-Zuordnung beim zweiten Preis derselben Kette nicht doppelt an", async () => {
    await erfasse(undefined, formular(gueltig));
    await erfasse(undefined, formular({ ...gueltig, preis: "2,59" }));

    expect(await anzahl("store_product")).toBe(1);
    expect(await anzahl("price_observation")).toBe(2);
  });

  it("weist eine unverständliche Mengenangabe ab, ohne etwas anzulegen", async () => {
    const ergebnis = await erfasse(undefined, formular({ ...gueltig, menge: "ein bisschen" }));

    expect(ergebnis.art).toBe("fehler");
    // Die Meldung allein beweist nichts — die Datenbank muss unberührt sein.
    expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
  });

  it("weist einen Preis von null ab, ohne etwas anzulegen", async () => {
    const ergebnis = await erfasse(undefined, formular({ ...gueltig, preis: "0" }));

    expect(ergebnis.art).toBe("fehler");
    expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
  });

  it("weist einen negativen Preis ab, ohne etwas anzulegen", async () => {
    const ergebnis = await erfasse(undefined, formular({ ...gueltig, preis: "-2,49" }));

    expect(ergebnis.art).toBe("fehler");
    expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
  });

  it("weist einen leeren Produktnamen ab, ohne etwas anzulegen", async () => {
    const ergebnis = await erfasse(undefined, formular({ ...gueltig, name: "   " }));

    expect(ergebnis.art).toBe("fehler");
    expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
  });

  /*
   * Eine unbekannte Kette kommt nicht aus dem Formular — dort stehen fünf
   * feste Auswahlmöglichkeiten. Sie kommt von einem Aufruf an der Oberfläche
   * vorbei, und ohne diese Prüfung liefe sie in einen Fremdschlüsselfehler
   * statt in eine Erklärung.
   */
  it("weist eine unbekannte Kette ab, ohne etwas anzulegen", async () => {
    const ergebnis = await erfasse(undefined, formular({ ...gueltig, kette: "merkur" }));

    expect(ergebnis.art).toBe("fehler");
    expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
  });

  it("weist eine unbekannte Preisart ab, ohne etwas anzulegen", async () => {
    const ergebnis = await erfasse(undefined, formular({ ...gueltig, preisart: "GESCHENKT" }));

    expect(ergebnis.art).toBe("fehler");
    expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
  });

  it("verlangt eine Aktions-Gültigkeit, wenn Aktion gewählt ist", async () => {
    const ergebnis = await erfasse(undefined, formular({ ...gueltig, preisart: "PROMO" }));

    expect(ergebnis.art).toBe("fehler");
    expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
  });

  it("nimmt eine Aktion mit Gültig-bis an", async () => {
    const ergebnis = await erfasse(
      undefined,
      formular({ ...gueltig, preisart: "PROMO", gueltigBis: "2099-12-31" }),
    );

    expect(ergebnis.art).toBe("erfolg");
    expect(await anzahl("price_observation")).toBe(1);
  });

  it("merkt sich das Ende der Aktion", async () => {
    await erfasse(
      undefined,
      formular({ ...gueltig, preisart: "PROMO", gueltigBis: "2099-12-31" }),
    );

    const zeilen = await umgebung.db.execute(sql`
      select aktion_gueltig_bis from price_observation
    `);
    const ende = (zeilen.rows as { aktion_gueltig_bis: Date }[])[0].aktion_gueltig_bis;
    expect(new Date(ende).getFullYear()).toBe(2099);
  });

  it("weist ein unlesbares Aktionsende ab, ohne etwas anzulegen", async () => {
    const ergebnis = await erfasse(
      undefined,
      formular({ ...gueltig, preisart: "PROMO", gueltigBis: "irgendwann" }),
    );

    expect(ergebnis.art).toBe("fehler");
    expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
  });

  it("verlangt eine Anmeldung", async () => {
    angemeldet = false;

    const fehler = await faengtFehler(() => erfasse(undefined, formular(gueltig)));

    expect(fehler).toBeDefined();
    expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
  });
});

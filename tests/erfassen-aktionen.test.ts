import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { erzeugeListe, fuegeFreitextArtikelHinzu, holeArtikel } from "@/lib/einkaufszettel";
import { legeKettenAn } from "@/lib/katalog";
import { bestesAngebot, holePreisMatrix } from "@/lib/preise";
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
/**
 * Ob `revalidatePath` wie üblich nichts tut oder wirft.
 *
 * Eine Attrappe, die nur ein `() => {}` ist, macht die Reihenfolge in der
 * Aktion unsichtbar: Ob das Verwerfen des Zwischenspeichers im Schreib-`try`
 * liegt oder dahinter, merkt kein Test, solange es nie scheitert.
 */
let cacheWirft = false;

const echtesCache = await import("next/cache");
await mock.module("next/cache", () => ({
  ...echtesCache,
  revalidatePath: () => {
    if (cacheWirft) throw new Error("Zwischenspeicher nicht erreichbar");
  },
}));

// `@/db` exportiert nur `db` — hier ist die Streuung entbehrlich.
await mock.module("@/db", () => ({ db: umgebung.db as ZugriffsDb }));

/*
 * Der Anhang `?echt` ist kein Zierrat, sondern die einzige Fassung, die
 * unabhängig von der Dateireihenfolge stimmt.
 *
 * `tests/verwaltung-aktionen.test.ts` ersetzt `@/lib/sitzung` ebenfalls für den
 * ganzen Lauf. Ein gewöhnliches `await import("@/lib/sitzung")` bekäme hier
 * also je nach Reihenfolge die Attrappe der anderen Datei und würde sie in die
 * eigene hineinstreuen — beide Dateien wären dann gegenseitig davon abhängig,
 * wer zuerst läuft. Der Anhang macht daraus einen eigenen Modul-Eintrag, den
 * keine Attrappe trifft; dieselbe Ausweichstelle nutzt `tests/sitzung.test.ts`.
 *
 * Der Bezeichner steht in einer Variablen, weil TypeScript ihn sonst auflösen
 * wollte und den Anhang nicht kennt.
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

async function anzahl(
  tabelle: "price_observation" | "product" | "store_product" | "offer",
): Promise<number> {
  const ergebnis = await umgebung.db.execute(
    sql`select count(*)::int as n from ${sql.identifier(tabelle)}`,
  );
  return (ergebnis.rows as { n: number }[])[0].n;
}

/** Nach jeder Abweisung muss **alles** unberührt sein, nicht nur die Beobachtung. */
async function nichtsAngelegt(): Promise<{
  beobachtungen: number;
  produkte: number;
  zuordnungen: number;
  angebote: number;
}> {
  return {
    beobachtungen: await anzahl("price_observation"),
    produkte: await anzahl("product"),
    zuordnungen: await anzahl("store_product"),
    angebote: await anzahl("offer"),
  };
}

const UNBERUEHRT = { beobachtungen: 0, produkte: 0, zuordnungen: 0, angebote: 0 };

beforeEach(async () => {
  // `cascade` wegen `product_ean`: Die Tabelle zeigt auf `product` und wird
  // hier nie gefüllt, verhindert aber jedes Leeren ohne sie.
  await umgebung.db.execute(sql`truncate table product cascade`);
  angemeldet = true;
  cacheWirft = false;
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

  /*
   * Eine Aktion, die gestern endete, hilft beim Vergleich nicht — und die
   * Angebotszeile liefe von jetzt bis gestern gegen die Bedingung
   * `offer_zeitraum`. Ohne diese Prüfung bekäme der Nutzer statt eines Satzes
   * einen technischen Fehler.
   */
  it("weist ein Aktionsende in der Vergangenheit ab, ohne etwas anzulegen", async () => {
    const ergebnis = await erfasse(
      undefined,
      formular({ ...gueltig, preisart: "PROMO", gueltigBis: "2020-01-01" }),
    );

    expect(ergebnis.art).toBe("fehler");
    expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
  });

  /*
   * Nicht „irgendein Fehler", sondern **dieser Satz**.
   *
   * Der Test darüber bliebe auch ohne die Prüfung in der Aktion grün: Dann
   * bräche `schreibeAngebot` an seinem eigenen Zeitraum-Wächter ab, die
   * Transaktion rollte zurück, `art` wäre weiterhin „fehler" und alle vier
   * Tabellen blieben leer. Nur die Meldung wäre eine andere — „Versuch es noch
   * einmal", zu etwas, das jedes Mal identisch scheitert. Genau das ist der
   * Unterschied, den die Prüfung ausmacht, also gehört er hierher.
   */
  it("nennt beim vergangenen Aktionsende den Grund statt eines technischen Fehlers", async () => {
    const ergebnis = await erfasse(
      undefined,
      formular({ ...gueltig, preisart: "PROMO", gueltigBis: "2020-01-01" }),
    );

    expect(ergebnis.art).toBe("fehler");
    if (ergebnis.art !== "fehler") return;
    expect(ergebnis.meldung).toContain("Vergangenheit");
  });

  it("weist einen Preis jenseits der Datenbankgrenze ab, ohne etwas anzulegen", async () => {
    /*
     * `einzelpreis` ist `numeric(10,4)` und muss betragsmäßig unter 10^6
     * bleiben. Ohne die Grenze in `zerlegePreis` käme diese Eingabe bis in die
     * Schreibphase durch: Produkt und Ketten-Zuordnung wären angelegt, und erst
     * dann liefe der Einfügevorgang in einen `numeric field overflow`. Die
     * Oberfläche riete dann „Versuch es noch einmal" — zu etwas, das jedes Mal
     * identisch scheitert.
     */
    const ergebnis = await erfasse(undefined, formular({ ...gueltig, preis: "1234567" }));

    expect(ergebnis.art).toBe("fehler");
    expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
  });

  it("nimmt einen Preis knapp unter der Grenze an", async () => {
    const ergebnis = await erfasse(undefined, formular({ ...gueltig, preis: "99999,99" }));

    expect(ergebnis.art).toBe("erfolg");
  });

  it("weist einen Grundpreis jenseits der Datenbankgrenze ab, ohne etwas anzulegen", async () => {
    // Beide Werte für sich sind zulässig — erst ihr Verhältnis sprengt
    // `grundpreis numeric(12,4)`: 99.999,99 € auf ein Gramm sind knapp
    // 100 Millionen je Kilo.
    const ergebnis = await erfasse(
      undefined,
      formular({ ...gueltig, preis: "99999,99", menge: "1 g" }),
    );

    expect(ergebnis.art).toBe("fehler");
    expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
  });

  /*
   * Dasselbe am unteren Ende, und auch hier zählt die Meldung mit: Ohne die
   * Untergrenze käme die Eingabe bis in die Schreibphase, der auf 0,0000
   * gerundete Grundpreis liefe in `preis_positiv`, und der Nutzer bekäme
   * „Versuch es noch einmal" für etwas, das jedes Mal identisch scheitert. Die
   * Transaktion räumte zwar auf — `UNBERUEHRT` gälte also weiterhin —, aber
   * ratlos wäre er trotzdem.
   */
  it("weist einen Grundpreis unterhalb der Datenbankgrenze ab, ohne etwas anzulegen", async () => {
    const ergebnis = await erfasse(
      undefined,
      formular({ ...gueltig, preis: "0,01", menge: "1000 kg" }),
    );

    expect(ergebnis.art).toBe("fehler");
    if (ergebnis.art !== "fehler") return;
    expect(ergebnis.meldung).toContain("Grundpreis von null");
    expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
  });

  /*
   * Eine Menge jenseits von `product.menge integer` wird schon beim Zerlegen
   * abgewiesen und bekommt damit den Satz des Mengenfeldes. Ohne die Grenze
   * liefe sie in `integer out of range`.
   */
  it("weist eine Menge jenseits der Spaltengrenze ab, ohne etwas anzulegen", async () => {
    const ergebnis = await erfasse(
      undefined,
      formular({ ...gueltig, preis: "1000", menge: "3000000 kg" }),
    );

    expect(ergebnis.art).toBe("fehler");
    if (ergebnis.art !== "fehler") return;
    expect(ergebnis.meldung).toContain("Mengenangabe");
    expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
  });

  it("verlangt eine Anmeldung", async () => {
    angemeldet = false;

    const fehler = await faengtFehler(() => erfasse(undefined, formular(gueltig)));

    expect(fehler).toBeDefined();
    expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
  });

  /*
   * Der Preis steht bereits in der Datenbank, wenn `revalidatePath` an die
   * Reihe kommt. Läge der Aufruf im Schreib-`try`, machte ein Fehler beim
   * Verwerfen des Zwischenspeichers daraus die Meldung „nicht gespeichert" —
   * der Nutzer schickte noch einmal, und die zweite Beobachtung verschöbe den
   * Median dieser Kette. Genau deshalb hat der Aufruf sein eigenes `catch`,
   * und genau das nagelt dieser Test fest.
   */
  it("meldet Erfolg, auch wenn das Verwerfen des Zwischenspeichers scheitert", async () => {
    cacheWirft = true;
    try {
      const ergebnis = await erfasse(undefined, formular(gueltig));

      expect(ergebnis.art).toBe("erfolg");
      expect(await anzahl("price_observation")).toBe(1);
    } finally {
      // `mock.module` gilt für den ganzen Lauf; die Fahne darf diesen Test
      // nicht überleben, auch wenn eine Behauptung darin wirft.
      cacheWirft = false;
    }
  });
});

/*
 * Der Grund, warum jemand „Aktion" ankreuzt: Er will sehen, dass diese Kette
 * heute gewinnt.
 *
 * Bis zur Fixrunde 1 schrieb die Erfassung dafür nur eine Beobachtung mit
 * `preisart = 'PROMO'` — und die liest in Plan 2 niemand. `holePreisMatrix`
 * schließt `PROMO` beim Referenzpreis ausdrücklich aus und nimmt den laufenden
 * Aktionspreis allein aus `offer`. Die Aktion war damit schreibgeschützt ins
 * Leere gelaufen, ohne dass die Bestätigung sich von einer wirksamen
 * unterschieden hätte.
 */
describe("erfasste Aktion", () => {
  const aktion = { ...gueltig, preisart: "PROMO", gueltigBis: "2099-12-31" };

  it("schreibt neben der Beobachtung ein Angebot", async () => {
    const ergebnis = await erfasse(undefined, formular(aktion));

    expect(ergebnis.art).toBe("erfolg");
    expect(await anzahl("offer")).toBe(1);
    expect(await anzahl("price_observation")).toBe(1);
  });

  /*
   * Der Betrag im Angebot ist der **Grundpreis**, nicht der Regalpreis.
   * `holePreisMatrix` vergleicht ihn direkt mit dem Referenzpreis, und der ist
   * der Median über `price_observation.grundpreis` — also €/kg. Stünde hier
   * 2,49 statt 9,96, sähe jede Aktion gegen jeden Normalpreis wie ein
   * Jahrhundertangebot aus.
   */
  it("legt den Grundpreis ins Angebot, nicht den Regalpreis", async () => {
    await erfasse(undefined, formular(aktion));

    const zeilen = await umgebung.db.execute(sql`
      select preis, quelle, gueltig_von, gueltig_bis from offer
    `);
    const zeile = (zeilen.rows as Record<string, string>[])[0];
    expect(Number(zeile.preis)).toBeCloseTo(9.96, 4);
    expect(zeile.quelle).toBe("MANUAL");
    expect(new Date(zeile.gueltig_von).getTime()).toBeLessThanOrEqual(Date.now());
    expect(new Date(zeile.gueltig_bis).getFullYear()).toBe(2099);
  });

  it("schreibt ohne Aktion kein Angebot", async () => {
    await erfasse(undefined, formular(gueltig));

    expect(await anzahl("offer")).toBe(0);
  });

  it("schreibt für Treuekarte und Mengenrabatt kein Angebot", async () => {
    // Beide sind an eine Bedingung geknüpft, die nicht für jeden gilt. Sie als
    // laufenden Bestpreis auszugeben, wäre eine Aussage über einen Preis, den
    // man an der Kassa womöglich nicht bekommt.
    await erfasse(undefined, formular({ ...gueltig, preisart: "LOYALTY" }));
    await erfasse(undefined, formular({ ...gueltig, preisart: "MULTIBUY" }));

    expect(await anzahl("price_observation")).toBe(2);
    expect(await anzahl("offer")).toBe(0);
  });

  /*
   * Der eigentliche Zweck, von außen geprüft: nicht „steht eine Zeile in
   * `offer`", sondern „gewinnt Hofer heute den Vergleich". Ohne die
   * Angebotszeile bliebe Hofer ohne jeden Bestpreis, und Spar gewönne mit
   * seinem Normalpreis.
   */
  it("lässt die Kette mit der Aktion den heutigen Bestpreis gewinnen", async () => {
    await erfasse(undefined, formular({ ...gueltig, kette: "spar", preis: "2,49" }));
    const erfasstesProdukt = await erfasse(
      undefined,
      formular({ ...aktion, kette: "hofer", preis: "1,49" }),
    );
    expect(erfasstesProdukt.art).toBe("erfolg");
    if (erfasstesProdukt.art !== "erfolg") return;

    const zeilen = await holePreisMatrix(umgebung.db, erfasstesProdukt.produktId);
    const hofer = zeilen.find((z) => z.kette.kuerzel === "hofer");
    const spar = zeilen.find((z) => z.kette.kuerzel === "spar");

    // Der Aktionspreis ist der Grundpreis: 1,49 € je 250 g sind 5,96 €/kg.
    expect(hofer?.aktion?.preis).toBeCloseTo(5.96, 4);
    expect(hofer?.bestpreis).toBeCloseTo(5.96, 4);
    // Die Aktion verschiebt den Referenzpreis nicht — Hofer hat gar keinen.
    expect(hofer?.referenzpreis).toBeNull();
    expect(spar?.bestpreis).toBeCloseTo(9.96, 4);

    expect(bestesAngebot(zeilen).heuteSieger?.kette.kuerzel).toBe("hofer");
    // Langfristig gewinnt weiterhin Spar: Hofer hat keinen Normalpreis.
    expect(bestesAngebot(zeilen).referenzSieger?.kette.kuerzel).toBe("spar");
  });

  /*
   * Beobachtung und Angebot müssen gemeinsam gelingen oder gemeinsam
   * ausbleiben. Scheiterte das Angebot, nachdem die Beobachtung steht, meldete
   * die Oberfläche „nicht gespeichert", während der Preis liegt — der Nutzer
   * schickte noch einmal und verschöbe den Median dieser Kette.
   *
   * Der Fehler wird bewusst eingebaut: eine Bedingung, an der genau dieser
   * Angebotspreis scheitert. Anders ließe sich ein Abbruch zwischen zwei
   * Schreibvorgängen nicht herbeiführen.
   */
  it("nimmt bei einem gescheiterten Angebot auch die Beobachtung zurück", async () => {
    await umgebung.db.execute(sql`
      alter table offer add constraint offer_pruefsperre check (preis <> 9.9600)
    `);

    try {
      const ergebnis = await erfasse(undefined, formular(aktion));

      expect(ergebnis.art).toBe("fehler");
      expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
    } finally {
      await umgebung.db.execute(sql`alter table offer drop constraint offer_pruefsperre`);
    }
  });

  it("schreibt nach dem Zurücknehmen beim nächsten Versuch wieder normal", async () => {
    // Belegt, dass die Transaktion sauber zurückgerollt und nicht bloß
    // abgebrochen wurde — die Verbindung muss danach weiter benutzbar sein.
    const ergebnis = await erfasse(undefined, formular(aktion));

    expect(ergebnis.art).toBe("erfolg");
    expect(await anzahl("offer")).toBe(1);
  });
});

/*
 * Plan 4: `erfasse` hakt auf Wunsch einen Zettel-Eintrag in derselben
 * Transaktion ab, die auch die Preisbeobachtung schreibt — Erfolg und
 * Abhaken stehen und fallen gemeinsam.
 */
describe("erfasse — Zettel-Bezug", () => {
  it("hakt den Zettel-Eintrag ab, wenn zettelItemId übergeben wird", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const artikel = await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Butter");

    const ergebnis = await erfasse(undefined, formular({ ...gueltig, zettelItemId: artikel.id }));

    expect(ergebnis.art).toBe("erfolg");
    const [aktualisiert] = await holeArtikel(umgebung.db, liste.id);
    expect(aktualisiert?.abgehaktAm).not.toBeNull();
  });

  it("lässt den Zettel-Eintrag unabgehakt, wenn die Erfassung abgewiesen wird", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const artikel = await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Butter");

    const ergebnis = await erfasse(
      undefined,
      formular({ ...gueltig, zettelItemId: artikel.id, preis: "-1" }),
    );

    expect(ergebnis.art).toBe("fehler");
    const [unveraendert] = await holeArtikel(umgebung.db, liste.id);
    expect(unveraendert?.abgehaktAm).toBeNull();
    expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
  });

  /*
   * Der Test oben scheitert schon an der Preisprüfung, **vor** der
   * Transaktion — er belegt nicht, dass ein Abbruch *innerhalb* der
   * Transaktion den Zettel-Eintrag ebenso unabgehakt lässt. Dieser Test
   * erzwingt den Abbruch stattdessen mit einer Datenbank-Bedingung, nach
   * demselben Muster wie "nimmt bei einem gescheiterten Angebot auch die
   * Beobachtung zurück" oben: `hakeItemAb` steht in der Transaktion nach dem
   * Angebot, wird bei diesem Abbruch also nie erreicht — genau das prüft
   * die Neuabfrage über `holeArtikel`.
   */
  it("lässt den Zettel-Eintrag unabgehakt, wenn die Transaktion an einer Datenbank-Bedingung scheitert", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const artikel = await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Butter");

    await umgebung.db.execute(sql`
      alter table offer add constraint offer_zettel_pruefsperre check (preis <> 9.9600)
    `);

    try {
      const ergebnis = await erfasse(
        undefined,
        formular({
          ...gueltig,
          preisart: "PROMO",
          gueltigBis: "2099-12-31",
          zettelItemId: artikel.id,
        }),
      );

      expect(ergebnis.art).toBe("fehler");
      expect(await nichtsAngelegt()).toEqual(UNBERUEHRT);
      const [unveraendert] = await holeArtikel(umgebung.db, liste.id);
      expect(unveraendert?.abgehaktAm).toBeNull();
    } finally {
      await umgebung.db.execute(sql`alter table offer drop constraint offer_zettel_pruefsperre`);
    }
  });

  it("funktioniert unverändert ohne zettelItemId", async () => {
    const ergebnis = await erfasse(undefined, formular(gueltig));
    expect(ergebnis.art).toBe("erfolg");
  });
});

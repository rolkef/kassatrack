import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { bestesAngebot, holePreisMatrix, schreibeBeobachtung } from "@/lib/preise";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

let umgebung: TestDatenbank;

/** Legt Ketten, ein Produkt und die Ketten-Produkte an. */
async function grundgeruest() {
  // Die Migration legt chain, category, product, product_ean, store_product,
  // price_observation und offer identisch zur Produktionsdatenbank an — von
  // Hand nachgebautes DDL könnte hier unbemerkt abweichen.
  await migrate(umgebung.db, { migrationsFolder: "./drizzle" });

  const ketten = ["billa", "spar", "hofer", "lidl", "penny"];
  for (const kuerzel of ketten) {
    await umgebung.db.execute(sql`
      insert into chain (id, name, kuerzel, sortierung)
      values (${"c-" + kuerzel}, ${kuerzel}, ${kuerzel}, 0)
    `);
  }

  await umgebung.db.execute(sql`
    insert into product (id, name, menge, einheit)
    values ('p1', 'Butter', 250, 'G')
  `);

  for (const kuerzel of ketten) {
    await umgebung.db.execute(sql`
      insert into store_product (id, chain_id, product_id)
      values (${"sp-" + kuerzel}, ${"c-" + kuerzel}, 'p1')
    `);
  }
}

beforeAll(async () => {
  umgebung = await starteTestDatenbank();
  await grundgeruest();
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table price_observation, offer`);
});

describe("Referenzpreis", () => {
  it("ist null, solange nichts beobachtet wurde", async () => {
    const zeilen = await holePreisMatrix(umgebung.db, "p1");
    expect(zeilen.every((z) => z.referenzpreis === null)).toBe(true);
  });

  it("ist der Median der Normalpreis-Beobachtungen", async () => {
    for (const preis of [9.6, 9.96, 10.4]) {
      await schreibeBeobachtung(umgebung.db, {
        storeProductId: "sp-spar",
        chainId: "c-spar",
        productId: "p1",
        quelle: "MANUAL",
        preisart: "NORMAL",
        einzelpreis: 2.49,
        zeilensumme: 2.49,
        grundpreis: preis,
      });
    }

    const spar = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "spar");
    expect(spar?.referenzpreis).toBeCloseTo(9.96, 4);
    expect(spar?.anzahl).toBe(3);
  });

  it("ignoriert Aktionspreise", async () => {
    await schreibeBeobachtung(umgebung.db, {
      storeProductId: "sp-spar", chainId: "c-spar", productId: "p1",
      quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 2.49, zeilensumme: 2.49, grundpreis: 9.96,
    });
    await schreibeBeobachtung(umgebung.db, {
      storeProductId: "sp-spar", chainId: "c-spar", productId: "p1",
      quelle: "MANUAL", preisart: "PROMO", einzelpreis: 1.49, zeilensumme: 1.49, grundpreis: 5.96,
      aktionGueltigBis: new Date(Date.now() + 86_400_000),
    });

    const spar = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "spar");
    expect(spar?.referenzpreis).toBeCloseTo(9.96, 4);
  });

  /*
   * Abnahmepunkt 3 aus Plan 2, an der vollen Strecke geprüft.
   *
   * `tests/median.test.ts` zeigt bereits, dass `median` gegen einen Ausreißer
   * unempfindlich ist — aber auf der reinen Funktion, ohne dass je ein
   * Tippfehler in der Datenbank stand. Damit blieb offen, was der Plan
   * eigentlich verlangt: dass ein verschriebener Preis den **Referenzpreis**
   * nicht verschiebt. Wer `median` in `holePreisMatrix` durch einen Mittelwert
   * ersetzte, hätte den Unterschied an keinem Test gemerkt.
   *
   * 299 statt 2,99 sind bei 250 g Butter 1196 €/kg. Ein Mittelwert läge damit
   * bei über 247, der Median bleibt bei 9,96.
   */
  it("verschiebt sich nicht, wenn ein Preis vertippt erfasst wurde", async () => {
    const vertippt = 299 / 0.25;

    for (const preis of [9.6, 9.8, 9.96, 10.4, vertippt]) {
      await schreibeBeobachtung(umgebung.db, {
        storeProductId: "sp-spar",
        chainId: "c-spar",
        productId: "p1",
        quelle: "MANUAL",
        preisart: "NORMAL",
        einzelpreis: preis === vertippt ? 299 : 2.49,
        zeilensumme: preis === vertippt ? 299 : 2.49,
        grundpreis: preis,
      });
    }

    const spar = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "spar");
    expect(spar?.referenzpreis).toBeCloseTo(9.96, 4);
    // Die eigentliche Aussage: Der Ausreißer zieht den Wert nicht nach oben.
    expect(spar?.referenzpreis).toBeLessThan(11);
    // Er wird mitgezählt — unterdrückt wird er nicht, nur überstimmt.
    expect(spar?.anzahl).toBe(5);
  });

  it("ignoriert Beobachtungen, die älter als das Fenster sind", async () => {
    await umgebung.db.execute(sql`
      insert into price_observation
        (id, store_product_id, chain_id, product_id, beobachtet_am, quelle, preisart,
         einzelpreis, zeilensumme, grundpreis)
      values ('alt', 'sp-spar', 'c-spar', 'p1', now() - interval '200 days', 'MANUAL', 'NORMAL',
              1, 1, 4.00)
    `);

    const spar = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "spar");
    expect(spar?.referenzpreis).toBeNull();
    expect(spar?.anzahl).toBe(0);
  });

  it("nimmt nur die jüngsten fünf Beobachtungen", async () => {
    // Sechs alte teure, danach fünf junge günstige. Ohne die Begrenzung läge
    // der Median bei den teuren; mit ihr bei den günstigen.
    for (let i = 0; i < 6; i++) {
      await umgebung.db.execute(sql`
        insert into price_observation
          (id, store_product_id, chain_id, product_id, beobachtet_am, quelle, preisart,
           einzelpreis, zeilensumme, grundpreis)
        values (${"teuer" + i}, 'sp-spar', 'c-spar', 'p1', now() - interval '100 days',
                'MANUAL', 'NORMAL', 1, 1, 20.00)
      `);
    }
    for (let i = 0; i < 5; i++) {
      await schreibeBeobachtung(umgebung.db, {
        storeProductId: "sp-spar", chainId: "c-spar", productId: "p1",
        quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 1, zeilensumme: 1, grundpreis: 10,
      });
    }

    const spar = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "spar");
    expect(spar?.referenzpreis).toBeCloseTo(10, 4);
  });
});

/*
 * Abnahmepunkt 5 aus Plan 2: „von der Datenbank verweigert, nicht nur vom
 * Formular".
 *
 * `tests/preise-schema.test.ts` prüft dieselbe Bedingung bereits — aber an
 * einer Tabelle, die dort von Hand per DDL angelegt wird. Das belegt, dass eine
 * Tabelle *mit* dieser Bedingung ablehnt, nicht dass die ausgelieferte Tabelle
 * sie trägt. Genau diese Lücke schließt der Test hier: Diese Datei legt das
 * Schema über `migrate()` an, also über dieselben Dateien wie die
 * Produktionsdatenbank. Fiele die Bedingung aus der Migration heraus, bliebe
 * der andere Test grün und dieser würde rot.
 *
 * Geschrieben wird unmittelbar über Drizzle, am Formular und an der
 * Server-Aktion vorbei — der Weg, den ein Skript oder eine spätere
 * Schnittstelle nehmen würde.
 */
describe("Aktion ohne Gültig-bis, gegen das migrierte Schema", () => {
  it("wird von der Datenbank abgelehnt", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.execute(sql`
        insert into price_observation
          (id, store_product_id, chain_id, product_id, quelle, preisart,
           einzelpreis, zeilensumme, grundpreis)
        values ('ohne-ende', 'sp-hofer', 'c-hofer', 'p1', 'MANUAL', 'PROMO', 1.49, 1.49, 5.96)
      `),
    );

    expect(fehler).toBeDefined();
    /*
     * Auf den Namen der Bedingung geprüft und nicht bloß darauf, dass
     * irgendetwas geworfen wurde: Ein Tippfehler in der Kennung oder eine
     * verletzte Fremdschlüsselbeziehung würde ebenfalls werfen und diesen Test
     * grün halten, ohne dass die Bedingung noch existiert. Drizzle verpackt den
     * Fehler von `pg`, der Name steht deshalb erst in der Ursache.
     */
    const ursache = (fehler as { cause?: { constraint?: string } }).cause;
    expect(ursache?.constraint).toBe("preis_aktion_hat_ende");
  });

  it("geht mit Gültig-bis durch — die Bedingung sperrt nicht pauschal", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.execute(sql`
        insert into price_observation
          (id, store_product_id, chain_id, product_id, quelle, preisart,
           einzelpreis, zeilensumme, grundpreis, aktion_gueltig_bis)
        values ('mit-ende', 'sp-hofer', 'c-hofer', 'p1', 'MANUAL', 'PROMO', 1.49, 1.49, 5.96,
                now() + interval '3 days')
      `),
    );

    expect(fehler).toBeUndefined();
  });
});

describe("Aktueller Bestpreis", () => {
  it("entspricht dem Referenzpreis, wenn keine Aktion läuft", async () => {
    await schreibeBeobachtung(umgebung.db, {
      storeProductId: "sp-spar", chainId: "c-spar", productId: "p1",
      quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 2.49, zeilensumme: 2.49, grundpreis: 9.96,
    });

    const spar = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "spar");
    expect(spar?.bestpreis).toBeCloseTo(9.96, 4);
    expect(spar?.aktion).toBeNull();
  });

  it("nimmt die laufende Aktion, wenn sie günstiger ist", async () => {
    await schreibeBeobachtung(umgebung.db, {
      storeProductId: "sp-hofer", chainId: "c-hofer", productId: "p1",
      quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 2.79, zeilensumme: 2.79, grundpreis: 11.16,
    });
    await umgebung.db.execute(sql`
      insert into offer (id, store_product_id, preis, gueltig_von, gueltig_bis, quelle)
      values ('a1', 'sp-hofer', 8.76, now() - interval '1 day', now() + interval '5 days', 'FLYER')
    `);

    const hofer = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "hofer");
    expect(hofer?.bestpreis).toBeCloseTo(8.76, 4);
    expect(hofer?.aktion?.preis).toBeCloseTo(8.76, 4);
  });

  it("ignoriert eine abgelaufene Aktion", async () => {
    await schreibeBeobachtung(umgebung.db, {
      storeProductId: "sp-hofer", chainId: "c-hofer", productId: "p1",
      quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 2.79, zeilensumme: 2.79, grundpreis: 11.16,
    });
    await umgebung.db.execute(sql`
      insert into offer (id, store_product_id, preis, gueltig_von, gueltig_bis, quelle)
      values ('a2', 'sp-hofer', 1.00, now() - interval '10 days', now() - interval '1 day', 'FLYER')
    `);

    const hofer = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "hofer");
    expect(hofer?.bestpreis).toBeCloseTo(11.16, 4);
    expect(hofer?.aktion).toBeNull();
  });

  it("ignoriert eine Aktion, die erst in der Zukunft beginnt", async () => {
    // gueltig_von in der Zukunft — ohne die Prüfung darauf würde eine
    // angekündigte, noch nicht gestartete Aktion schon heute als Bestpreis
    // erscheinen.
    await schreibeBeobachtung(umgebung.db, {
      storeProductId: "sp-hofer", chainId: "c-hofer", productId: "p1",
      quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 2.79, zeilensumme: 2.79, grundpreis: 11.16,
    });
    await umgebung.db.execute(sql`
      insert into offer (id, store_product_id, preis, gueltig_von, gueltig_bis, quelle)
      values ('a-zukunft', 'sp-hofer', 1.00, now() + interval '3 days', now() + interval '10 days', 'FLYER')
    `);

    const hofer = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "hofer");
    expect(hofer?.bestpreis).toBeCloseTo(11.16, 4);
    expect(hofer?.aktion).toBeNull();
  });

  it("lässt eine Aktion einer anderen Kette nicht auf diese Kette wirken", async () => {
    // Der Join hängt am `store_product` der jeweiligen Kette. Würde er nur
    // über die Produkt-Kennung filtern, sähe Spar hier Hofers Aktionspreis.
    await schreibeBeobachtung(umgebung.db, {
      storeProductId: "sp-spar", chainId: "c-spar", productId: "p1",
      quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 2.49, zeilensumme: 2.49, grundpreis: 9.96,
    });
    await umgebung.db.execute(sql`
      insert into offer (id, store_product_id, preis, gueltig_von, gueltig_bis, quelle)
      values ('a-hofer-only', 'sp-hofer', 0.01, now() - interval '1 day', now() + interval '5 days', 'FLYER')
    `);

    const spar = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "spar");
    expect(spar?.aktion).toBeNull();
    expect(spar?.bestpreis).toBeCloseTo(9.96, 4);
  });
});

describe("schreibeBeobachtung — Zuordnung schützen", () => {
  // Die Beobachtungshälfte schlüsselt über chainId (Spalte auf
  // price_observation), die Angebotshälfte über store_product. Ohne diese
  // Prüfung könnte ein Aufrufer eine storeProductId der einen Kette mit der
  // chainId einer anderen kombinieren — die Zeile würde klaglos eingefügt
  // und beim Lesen der falschen Kette zugerechnet.
  it("verweigert eine chainId, die nicht zur storeProductId passt", async () => {
    const fehler = await faengtFehler(() =>
      schreibeBeobachtung(umgebung.db, {
        // sp-hofer gehört zu c-hofer, nicht zu c-spar.
        storeProductId: "sp-hofer", chainId: "c-spar", productId: "p1",
        quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 1, zeilensumme: 1, grundpreis: 10,
      }),
    );
    expect(fehler).toBeDefined();

    // Der eigentliche Beweis: nicht nur ein Fehler, sondern auch keine
    // Beobachtung, die unter der falschen Kette auftaucht.
    const spar = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "spar");
    expect(spar?.anzahl).toBe(0);
    expect(spar?.referenzpreis).toBeNull();
  });

  it("verweigert eine productId, die nicht zur storeProductId passt", async () => {
    const fehler = await faengtFehler(() =>
      schreibeBeobachtung(umgebung.db, {
        storeProductId: "sp-spar", chainId: "c-spar", productId: "gibtesnicht",
        quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 1, zeilensumme: 1, grundpreis: 10,
      }),
    );
    expect(fehler).toBeDefined();
  });

  it("verweigert eine unbekannte storeProductId", async () => {
    const fehler = await faengtFehler(() =>
      schreibeBeobachtung(umgebung.db, {
        storeProductId: "gibtesnicht", chainId: "c-spar", productId: "p1",
        quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 1, zeilensumme: 1, grundpreis: 10,
      }),
    );
    expect(fehler).toBeDefined();
  });
});

describe("bestesAngebot — das Butter-Szenario", () => {
  it("trennt Referenz-Sieger und Heute-Sieger", async () => {
    // Spar ist normal günstiger. Hofer hat diese Woche Aktion und gewinnt heute.
    await schreibeBeobachtung(umgebung.db, {
      storeProductId: "sp-spar", chainId: "c-spar", productId: "p1",
      quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 2.29, zeilensumme: 2.29, grundpreis: 9.16,
    });
    await schreibeBeobachtung(umgebung.db, {
      storeProductId: "sp-hofer", chainId: "c-hofer", productId: "p1",
      quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 2.79, zeilensumme: 2.79, grundpreis: 11.16,
    });
    await umgebung.db.execute(sql`
      insert into offer (id, store_product_id, preis, gueltig_von, gueltig_bis, quelle)
      values ('a3', 'sp-hofer', 8.76, now() - interval '1 day', now() + interval '5 days', 'FLYER')
    `);

    const { referenzSieger, heuteSieger } = bestesAngebot(await holePreisMatrix(umgebung.db, "p1"));

    expect(referenzSieger?.kette.kuerzel).toBe("spar");
    expect(heuteSieger?.kette.kuerzel).toBe("hofer");
  });

  it("liefert null, wenn es nirgends Daten gibt", async () => {
    const { referenzSieger, heuteSieger } = bestesAngebot(await holePreisMatrix(umgebung.db, "p1"));
    expect(referenzSieger).toBeNull();
    expect(heuteSieger).toBeNull();
  });
});

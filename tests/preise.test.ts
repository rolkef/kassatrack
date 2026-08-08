import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { bestesAngebot, holePreisMatrix, schreibeBeobachtung } from "@/lib/preise";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";

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

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { holeProdukt, legeProduktAn } from "@/lib/katalog";
import { product } from "@/db/schema/katalog";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

let umgebung: TestDatenbank;

beforeAll(async () => {
  umgebung = await starteTestDatenbank();
  await umgebung.db.execute(sql`
    create table product (
      id text primary key,
      name text not null,
      marke text,
      kategorie_id text,
      menge integer not null,
      einheit text not null,
      bild_schluessel text,
      erstellt_am timestamptz not null default now(),
      constraint product_menge_positiv check (menge > 0),
      constraint product_einheit_bekannt check (einheit in ('G','ML','STK')),
      constraint product_name_nicht_leer check (btrim(name) <> '')
    )
  `);
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table product`);
});

describe("legeProduktAn", () => {
  it("legt ein Produkt an und liest es zurück", async () => {
    const angelegt = await legeProduktAn(umgebung.db, {
      name: "Butter",
      marke: "Vorarlberg Milch",
      menge: 250,
      einheit: "G",
    });

    const gelesen = await holeProdukt(umgebung.db, angelegt.id);
    expect(gelesen?.name).toBe("Butter");
    expect(gelesen?.menge).toBe(250);
    expect(gelesen?.einheit).toBe("G");
  });

  it("erlaubt ein Produkt ohne Marke", async () => {
    const angelegt = await legeProduktAn(umgebung.db, { name: "Vollmilch", menge: 1000, einheit: "ML" });
    expect((await holeProdukt(umgebung.db, angelegt.id))?.marke).toBeNull();
  });

  it("entfernt Leerzeichen am Rand des Namens", async () => {
    const angelegt = await legeProduktAn(umgebung.db, { name: "  Butter  ", menge: 250, einheit: "G" });
    expect((await holeProdukt(umgebung.db, angelegt.id))?.name).toBe("Butter");
  });
});

describe("holeProdukt", () => {
  it("liefert null für eine unbekannte Kennung", async () => {
    expect(await holeProdukt(umgebung.db, "gibtesnicht")).toBeNull();
  });
});

describe("Datenbank-Bedingungen", () => {
  it("verweigert eine Menge von null", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(product).values({ id: "1", name: "X", menge: 0, einheit: "G" }),
    );
    expect(fehler).toBeDefined();
  });

  it("verweigert eine unbekannte Einheit", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(product).values({ id: "1", name: "X", menge: 1, einheit: "PFUND" as never }),
    );
    expect(fehler).toBeDefined();
  });

  it("verweigert einen leeren Namen", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(product).values({ id: "1", name: "   ", menge: 1, einheit: "G" }),
    );
    expect(fehler).toBeDefined();
  });
});

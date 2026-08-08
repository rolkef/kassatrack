import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { offer, priceObservation } from "@/db/schema/preise";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

let umgebung: TestDatenbank;

beforeAll(async () => {
  umgebung = await starteTestDatenbank();
  await umgebung.db.execute(sql`
    create table price_observation (
      id text primary key,
      store_product_id text not null,
      chain_id text not null,
      product_id text not null,
      beobachtet_am timestamptz not null default now(),
      quelle text not null,
      preisart text not null,
      einzelpreis numeric(10,4) not null,
      menge numeric(10,3) not null default 1,
      zeilensumme numeric(10,4) not null,
      grundpreis numeric(12,4) not null,
      aktions_hinweis text,
      aktion_gueltig_bis timestamptz,
      pfand_betrag numeric(10,4) not null default 0,
      konfidenz numeric(4,3) not null default 1,
      pruefen_noetig boolean not null default false,
      constraint preis_quelle_bekannt check (quelle in ('RECEIPT','BARCODE','MANUAL','CHAIN_API','FLYER')),
      constraint preis_art_bekannt check (preisart in ('NORMAL','PROMO','LOYALTY','MULTIBUY')),
      constraint preis_positiv check (einzelpreis > 0 and zeilensumme > 0 and grundpreis > 0),
      constraint preis_aktion_hat_ende check (preisart <> 'PROMO' or aktion_gueltig_bis is not null),
      constraint preis_konfidenz_bereich check (konfidenz >= 0 and konfidenz <= 1)
    )
  `);
  await umgebung.db.execute(sql`
    create table offer (
      id text primary key,
      store_product_id text not null,
      preis numeric(10,4) not null,
      gueltig_von timestamptz not null,
      gueltig_bis timestamptz not null,
      bedingung text,
      quelle text not null,
      constraint offer_zeitraum check (gueltig_bis > gueltig_von),
      constraint offer_preis_positiv check (preis > 0)
    )
  `);
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

const basis = {
  storeProductId: "sp1",
  chainId: "c1",
  productId: "p1",
  quelle: "MANUAL" as const,
  einzelpreis: "2.49",
  zeilensumme: "2.49",
  grundpreis: "9.96",
};

describe("Datenbank-Bedingungen der Preisbeobachtung", () => {
  it("nimmt eine gültige Normalpreis-Beobachtung an", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(priceObservation).values({ id: "1", ...basis, preisart: "NORMAL" }),
    );
    expect(fehler).toBeUndefined();
  });

  it("verweigert eine unbekannte Quelle", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db
        .insert(priceObservation)
        .values({ id: "2", ...basis, preisart: "NORMAL", quelle: "ERFUNDEN" as never }),
    );
    expect(fehler).toBeDefined();
  });

  it("verweigert eine unbekannte Preisart", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db
        .insert(priceObservation)
        .values({ id: "3", ...basis, preisart: "RABATT" as never }),
    );
    expect(fehler).toBeDefined();
  });

  it("verweigert einen Preis von null", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db
        .insert(priceObservation)
        .values({ id: "4", ...basis, preisart: "NORMAL", einzelpreis: "0" }),
    );
    expect(fehler).toBeDefined();
  });

  // Eine Aktion ohne Ende wäre keine Aktion, sondern der neue Normalpreis —
  // und würde den Bestpreis für immer verfälschen.
  it("verweigert eine Aktion ohne Gültig-bis", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(priceObservation).values({ id: "5", ...basis, preisart: "PROMO" }),
    );
    expect(fehler).toBeDefined();
  });

  it("nimmt eine Aktion mit Gültig-bis an", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(priceObservation).values({
        id: "6",
        ...basis,
        preisart: "PROMO",
        aktionGueltigBis: new Date(Date.now() + 86_400_000),
      }),
    );
    expect(fehler).toBeUndefined();
  });

  // konfidenz ist semantisch eine Wahrscheinlichkeit. Ohne diese Bedingung
  // ließe sich hier jede Zahl eintragen, obwohl nur 0 bis 1 einen Sinn ergeben.
  it("verweigert eine Konfidenz außerhalb des gültigen Bereichs", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db
        .insert(priceObservation)
        .values({ id: "7", ...basis, preisart: "NORMAL", konfidenz: "1.5" }),
    );
    expect(fehler).toBeDefined();
  });
});

const basisAngebot = {
  storeProductId: "sp1",
  preis: "1.99",
  gueltigVon: new Date("2026-01-01T00:00:00Z"),
  gueltigBis: new Date("2026-01-08T00:00:00Z"),
  quelle: "FLYER" as const,
};

describe("Datenbank-Bedingungen der Aktion (offer)", () => {
  it("nimmt ein gültiges Angebot an", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(offer).values({ id: "o1", ...basisAngebot }),
    );
    expect(fehler).toBeUndefined();
  });

  // Ein Gültigkeitszeitraum, der vor seinem Beginn endet, würde Task 6s
  // Bestpreis-Berechnung eine Aktion liefern, die nie oder immer gilt.
  it("verweigert einen Gültigkeitszeitraum, der nicht nach seinem Beginn endet", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(offer).values({
        id: "o2",
        ...basisAngebot,
        gueltigVon: new Date("2026-01-08T00:00:00Z"),
        gueltigBis: new Date("2026-01-01T00:00:00Z"),
      }),
    );
    expect(fehler).toBeDefined();
  });

  it("verweigert einen Angebotspreis von null", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(offer).values({ id: "o3", ...basisAngebot, preis: "0" }),
    );
    expect(fehler).toBeDefined();
  });
});

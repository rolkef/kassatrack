import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import {
  EinladungUngueltig,
  entzieheZugang,
  erzeugeEinladung,
  holeZugaenge,
  loeseEinladungEin,
} from "@/lib/einladung";
import { session, user } from "@/db/schema/auth";
import { istEmailZugelassen } from "@/lib/zugriff";
import { invite } from "@/db/schema/zugriff";
import { eq } from "drizzle-orm";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

let umgebung: TestDatenbank;

beforeAll(async () => {
  umgebung = await starteTestDatenbank();
  await umgebung.db.execute(sql`
    create table allowed_email (
      id text primary key,
      email text not null unique,
      hinzugefuegt_von text,
      erstellt_am timestamptz not null default now(),
      ist_betreiber boolean not null default false,
      constraint allowed_email_nicht_leer check (email <> ''),
      constraint allowed_email_klein check (email = lower(email))
    );
    create table invite (
      id text primary key,
      token text not null unique,
      email text not null,
      erstellt_von text not null,
      erstellt_am timestamptz not null default now(),
      gueltig_bis timestamptz not null,
      eingeloest_am timestamptz
    );
    create table "user" (
      id text primary key,
      name text not null,
      email text not null unique,
      email_verified boolean not null default false,
      image text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table session (
      id text primary key,
      expires_at timestamptz not null,
      token text not null unique,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      ip_address text,
      user_agent text,
      user_id text not null references "user"(id) on delete cascade
    );
  `);
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table allowed_email, invite`);
  await umgebung.db.execute(sql`truncate table "user" cascade`);
});

describe("erzeugeEinladung", () => {
  it("liefert einen Token mit mindestens 32 Zeichen", async () => {
    const { token } = await erzeugeEinladung(umgebung.db, {
      email: "neu@example.at",
      erstelltVon: "chris",
    });
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("schaltet die Adresse sofort frei", async () => {
    await erzeugeEinladung(umgebung.db, { email: "Neu@Example.AT", erstelltVon: "chris" });
    expect(await istEmailZugelassen(umgebung.db, "neu@example.at")).toBe(true);
  });

  it("ist bei doppeltem Aufruf für dieselbe Adresse unkritisch", async () => {
    await erzeugeEinladung(umgebung.db, { email: "neu@example.at", erstelltVon: "chris" });
    expect(
      await erzeugeEinladung(umgebung.db, { email: "neu@example.at", erstelltVon: "chris" }),
    ).toBeDefined();
  });
});

describe("loeseEinladungEin", () => {
  it("liefert die Adresse zurück", async () => {
    const { token } = await erzeugeEinladung(umgebung.db, {
      email: "neu@example.at",
      erstelltVon: "chris",
    });
    expect((await loeseEinladungEin(umgebung.db, token)).email).toBe("neu@example.at");
  });

  it("lässt sich kein zweites Mal einlösen", async () => {
    const { token } = await erzeugeEinladung(umgebung.db, {
      email: "neu@example.at",
      erstelltVon: "chris",
    });
    await loeseEinladungEin(umgebung.db, token);
    expect(await faengtFehler(() => loeseEinladungEin(umgebung.db, token))).toBeInstanceOf(
      EinladungUngueltig,
    );
  });

  it("weist einen unbekannten Token ab", async () => {
    expect(await faengtFehler(() => loeseEinladungEin(umgebung.db, "gibtesnicht"))).toBeInstanceOf(
      EinladungUngueltig,
    );
  });

  it("weist einen abgelaufenen Token ab", async () => {
    const { token } = await erzeugeEinladung(umgebung.db, {
      email: "neu@example.at",
      erstelltVon: "chris",
    });
    await umgebung.db
      .update(invite)
      .set({ gueltigBis: new Date(Date.now() - 1000) })
      .where(eq(invite.token, token));

    expect(await faengtFehler(() => loeseEinladungEin(umgebung.db, token))).toBeInstanceOf(
      EinladungUngueltig,
    );
  });
});

describe("entzieheZugang", () => {
  it("entfernt die Adresse aus der Allowlist", async () => {
    await erzeugeEinladung(umgebung.db, { email: "neu@example.at", erstelltVon: "chris" });
    await entzieheZugang(umgebung.db, "neu@example.at");
    expect(await istEmailZugelassen(umgebung.db, "neu@example.at")).toBe(false);
  });

  // Ausgesperrt, nicht gelöscht: Das Konto bleibt bestehen (an ihm hängen
  // später Belege und Preiseinträge), nur hereinkommen kann es nicht mehr.
  it("lässt das Konto selbst bestehen", async () => {
    await erzeugeEinladung(umgebung.db, { email: "neu@example.at", erstelltVon: "chris" });
    await umgebung.db
      .insert(user)
      .values({ id: "u1", name: "Neu", email: "neu@example.at", updatedAt: new Date() });

    await entzieheZugang(umgebung.db, "neu@example.at");

    expect((await umgebung.db.select().from(user)).length).toBe(1);
  });

  /*
   * Die Freischaltung zu streichen sperrt erst beim **nächsten** Anmelden aus.
   * Ohne diesen Schritt bliebe die Person bis zum Ablauf ihrer Sitzung
   * angemeldet — bei sieben Tagen Sitzungsdauer eine Woche lang.
   */
  it("beendet die laufenden Sitzungen der Person", async () => {
    await erzeugeEinladung(umgebung.db, { email: "neu@example.at", erstelltVon: "chris" });
    await umgebung.db
      .insert(user)
      .values({ id: "u1", name: "Neu", email: "neu@example.at", updatedAt: new Date() });
    await umgebung.db.insert(session).values({
      id: "s1",
      token: "t1",
      userId: "u1",
      expiresAt: new Date(Date.now() + 86_400_000),
      updatedAt: new Date(),
    });

    await entzieheZugang(umgebung.db, "neu@example.at");

    expect(await umgebung.db.select().from(session)).toEqual([]);
  });

  // `user.email` trägt die Schreibweise des Anbieters. Ohne `lower()` bliebe
  // diese Sitzung stehen und die Person wäre weiter angemeldet.
  it("beendet Sitzungen auch bei abweichender Schreibweise im Konto", async () => {
    await erzeugeEinladung(umgebung.db, { email: "neu@example.at", erstelltVon: "chris" });
    await umgebung.db
      .insert(user)
      .values({ id: "u1", name: "Neu", email: "Neu@Example.AT", updatedAt: new Date() });
    await umgebung.db.insert(session).values({
      id: "s1",
      token: "t1",
      userId: "u1",
      expiresAt: new Date(Date.now() + 86_400_000),
      updatedAt: new Date(),
    });

    await entzieheZugang(umgebung.db, "neu@example.at");

    expect(await umgebung.db.select().from(session)).toEqual([]);
  });

  /*
   * Der gewöhnliche Fall „falsche Adresse erwischt": eingeladen, dann entzogen,
   * bevor der Link geöffnet wurde. Bliebe der Token offen, versicherte die
   * Einladungsseite der Person „ist freigeschaltet" — und der nächste
   * Bildschirm wiese sie ab.
   */
  it("entwertet eine noch offene Einladung", async () => {
    const { token } = await erzeugeEinladung(umgebung.db, {
      email: "neu@example.at",
      erstelltVon: "chris",
    });

    await entzieheZugang(umgebung.db, "neu@example.at");

    expect(await faengtFehler(() => loeseEinladungEin(umgebung.db, token))).toBeInstanceOf(
      EinladungUngueltig,
    );
  });

  it("entwertet die Einladung auch bei abweichender Schreibweise im Entzug", async () => {
    const { token } = await erzeugeEinladung(umgebung.db, {
      email: "neu@example.at",
      erstelltVon: "chris",
    });

    await entzieheZugang(umgebung.db, " Neu@Example.AT ");

    expect(await faengtFehler(() => loeseEinladungEin(umgebung.db, token))).toBeInstanceOf(
      EinladungUngueltig,
    );
  });

  it("lässt die Einladungen anderer Adressen offen", async () => {
    await erzeugeEinladung(umgebung.db, { email: "neu@example.at", erstelltVon: "chris" });
    const { token } = await erzeugeEinladung(umgebung.db, {
      email: "andere@example.at",
      erstelltVon: "chris",
    });

    await entzieheZugang(umgebung.db, "neu@example.at");

    expect((await loeseEinladungEin(umgebung.db, token)).email).toBe("andere@example.at");
  });

  it("lässt die Sitzungen anderer Personen unangetastet", async () => {
    await erzeugeEinladung(umgebung.db, { email: "neu@example.at", erstelltVon: "chris" });
    await umgebung.db.insert(user).values([
      { id: "u1", name: "Neu", email: "neu@example.at", updatedAt: new Date() },
      { id: "u2", name: "Andere", email: "andere@example.at", updatedAt: new Date() },
    ]);
    await umgebung.db.insert(session).values([
      {
        id: "s1",
        token: "t1",
        userId: "u1",
        expiresAt: new Date(Date.now() + 86_400_000),
        updatedAt: new Date(),
      },
      {
        id: "s2",
        token: "t2",
        userId: "u2",
        expiresAt: new Date(Date.now() + 86_400_000),
        updatedAt: new Date(),
      },
    ]);

    await entzieheZugang(umgebung.db, "neu@example.at");

    const rest = await umgebung.db.select().from(session);
    expect(rest.map((s) => s.userId)).toEqual(["u2"]);
  });
});

describe("holeZugaenge", () => {
  it("liefert die freigeschalteten Adressen in der Reihenfolge ihrer Aufnahme", async () => {
    await erzeugeEinladung(umgebung.db, { email: "erste@example.at", erstelltVon: "chris" });
    await erzeugeEinladung(umgebung.db, { email: "zweite@example.at", erstelltVon: "chris" });

    expect((await holeZugaenge(umgebung.db)).map((z) => z.email)).toEqual([
      "erste@example.at",
      "zweite@example.at",
    ]);
  });

  it("meldet eine Adresse ohne Konto als kontolos", async () => {
    await erzeugeEinladung(umgebung.db, { email: "neu@example.at", erstelltVon: "chris" });
    expect((await holeZugaenge(umgebung.db))[0]?.hatKonto).toBe(false);
  });

  it("erkennt ein bestehendes Konto", async () => {
    await erzeugeEinladung(umgebung.db, { email: "neu@example.at", erstelltVon: "chris" });
    await umgebung.db
      .insert(user)
      .values({ id: "u1", name: "Neu", email: "neu@example.at", updatedAt: new Date() });

    expect((await holeZugaenge(umgebung.db))[0]?.hatKonto).toBe(true);
  });

  /*
   * `allowed_email.email` ist per Constraint kleingeschrieben, `user.email`
   * trägt die Schreibweise des Anbieters. Ein Vergleich ohne `lower()` fand
   * dieses Konto nicht und meldete „Noch nicht angemeldet" für jemanden, der
   * längst ein Konto hat.
   */
  it("erkennt ein Konto auch bei abweichender Schreibweise", async () => {
    await erzeugeEinladung(umgebung.db, { email: "neu@example.at", erstelltVon: "chris" });
    await umgebung.db
      .insert(user)
      .values({ id: "u1", name: "Neu", email: "Neu@Example.AT", updatedAt: new Date() });

    expect((await holeZugaenge(umgebung.db))[0]?.hatKonto).toBe(true);
  });

  it("liefert eine leere Liste, wenn niemand freigeschaltet ist", async () => {
    expect(await holeZugaenge(umgebung.db)).toEqual([]);
  });
});

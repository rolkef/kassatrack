import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { sql } from "drizzle-orm";
import { allowedEmail } from "@/db/schema/zugriff";
import { pruefeBetreiber, type ZugriffsDb } from "@/lib/zugriff";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";

/*
 * Prüft die Server-Aktionen **direkt**, nicht über die Seite.
 *
 * Das ist der Punkt: Server-Aktionen sind eigene Endpunkte. Wer ihre Kennung
 * kennt, ruft sie ohne die Seite auf, auf der sie stehen — eine Prüfung nur in
 * `page.tsx` schützt sie also nicht. Ein Test, der bloß die Seite betrachtet,
 * könnte das nicht zeigen.
 *
 * Nachgebildet wird ausschließlich das **Nachschlagen der Sitzung**
 * (`requireBetreiber` braucht `next/headers` und eine echte Anmeldung). Die
 * Berechtigungsprüfung selbst läuft echt: `pruefeBetreiber` fragt die
 * Testdatenbank. Streicht jemand den `requireBetreiber()`-Aufruf aus einer
 * Aktion, schlagen diese Tests fehl.
 */

/*
 * Datenbank und Tabellen entstehen auf oberster Ebene, nicht in `beforeAll`:
 * Die Aktionen werden weiter unten per `await import` geladen, und dieser
 * Import läuft **vor** jedem `beforeAll`. `aktionen.ts` bindet `db` beim
 * Importieren; wäre die Testdatenbank da noch nicht da, bekäme die Aktion
 * `undefined` und liefe in einen Typfehler statt in die Prüfung.
 */
const umgebung: TestDatenbank = await starteTestDatenbank();
let angemeldeteEmail = "chef@example.at";

{
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
}

afterAll(async () => {
  await umgebung.stop();
});

/*
 * Jede Attrappe ist **vollständig**: Das echte Modul wird vorher eingelesen,
 * hineingestreut und nur dort überschrieben, wo etwas gestellt sein muss.
 *
 * Der Grund ist, dass `mock.module` in Bun für den **gesamten** Lauf gilt und
 * nicht nur für diese Datei — nachgemessen, und die Sache hat an anderer Stelle
 * schon einmal gekostet (siehe `zugangs-zeile.tsx:22-26`). Eine Attrappe, die
 * Exporte weglässt, nimmt sie damit jeder anderen Testdatei weg. Solange
 * niemand sie importiert, fällt das nicht auf; die erste Datei, die es tut,
 * bekommt „undefined is not a function" an einer Stelle, die mit dieser hier
 * nichts zu tun hat — und ob überhaupt, hängt an Buns Dateireihenfolge. Das ist
 * die teuerste Form, die ein Testfehler annehmen kann.
 *
 * Zwei Fallstricke, beide nachgemessen und beide teuer:
 *
 * - Das echte Modul muss **vor** `mock.module` eingelesen werden. Ein
 *   `mock.module("x", async () => ({ ...(await import("x")) }))` importiert sich
 *   selbst, während es sich gerade ersetzt: Der Lauf bleibt hängen, ohne
 *   Fehlermeldung.
 * - Und `mock.module` selbst gehört `await`et, sobald die Fabrik asynchron ist
 *   — sonst ist der Namensraum beim nächsten Import noch leer und das Modul hat
 *   überhaupt keine Exporte mehr.
 *
 * Reihenfolge: erst `@/db` ersetzen, dann `@/lib/sitzung` einlesen. Nur so
 * hängt das echte `@/lib/sitzung` an der Testdatenbank statt an der aus
 * `tests/setup.ts`.
 */
const echtesCache = await import("next/cache");
await mock.module("next/cache", () => ({ ...echtesCache, revalidatePath: () => {} }));

/*
 * `@/db` bleibt ohne Streuung: Das Modul exportiert nur `db`, und genau das
 * wird ersetzt. Wächst es je um einen zweiten Export, gehört hier dieselbe
 * Streuung hin wie bei den anderen beiden.
 */
await mock.module("@/db", () => ({ db: umgebung.db as ZugriffsDb }));

const echteSitzung = await import("@/lib/sitzung");
await mock.module("@/lib/sitzung", () => ({
  ...echteSitzung,
  // Nur das Nachschlagen der Sitzung ist gestellt — die Rollenprüfung darunter
  // ist die echte.
  requireBetreiber: async () => {
    await pruefeBetreiber(umgebung.db, angemeldeteEmail);
    return { id: "u1", email: angemeldeteEmail, name: "Wer" };
  },
}));

const { entziehe, ladeEin } = await import("@/app/verwaltung/zugriff/aktionen");

function formular(eintraege: Record<string, string>) {
  const daten = new FormData();
  for (const [schluessel, wert] of Object.entries(eintraege)) daten.set(schluessel, wert);
  return daten;
}

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table allowed_email, invite`);
  await umgebung.db.execute(sql`truncate table "user" cascade`);
  angemeldeteEmail = "chef@example.at";
});

async function legeBetreiberAn() {
  await umgebung.db
    .insert(allowedEmail)
    .values({ id: "chef", email: "chef@example.at", istBetreiber: true });
}

async function legeGastAn() {
  await umgebung.db.insert(allowedEmail).values({ id: "gast", email: "gast@example.at" });
}

describe("ladeEin", () => {
  it("legt die Einladung an, wenn die betreibende Person sie auslöst", async () => {
    await legeBetreiberAn();

    const ergebnis = await ladeEin({ art: "leer" }, formular({ email: "neu@example.at" }));

    expect(ergebnis.art).toBe("fertig");
  });

  /*
   * Der Kern dieser Datei: angemeldet, freigeschaltet — und trotzdem abgelehnt.
   */
  it("weist eine angemeldete Person ohne Betreiber-Rolle ab", async () => {
    await legeBetreiberAn();
    await legeGastAn();
    angemeldeteEmail = "gast@example.at";

    const ergebnis = await ladeEin({ art: "leer" }, formular({ email: "neu@example.at" }));

    expect(ergebnis.art).toBe("fehler");
    expect(ergebnis.art === "fehler" && ergebnis.text).toContain("betreibende Person");
  });

  // Und die Ablehnung ist wirksam, nicht bloß kosmetisch.
  it("schaltet dabei nichts frei", async () => {
    await legeBetreiberAn();
    await legeGastAn();
    angemeldeteEmail = "gast@example.at";

    await ladeEin({ art: "leer" }, formular({ email: "neu@example.at" }));

    const eintraege = await umgebung.db.select().from(allowedEmail);
    expect(eintraege.map((e) => e.email).sort()).toEqual(["chef@example.at", "gast@example.at"]);
  });

  it("weist auch ab, wenn es gar keine betreibende Person gibt", async () => {
    await legeGastAn();
    angemeldeteEmail = "gast@example.at";

    const ergebnis = await ladeEin({ art: "leer" }, formular({ email: "neu@example.at" }));

    expect(ergebnis.art).toBe("fehler");
  });
});

describe("entziehe", () => {
  it("entzieht, wenn die betreibende Person es auslöst", async () => {
    await legeBetreiberAn();
    await legeGastAn();

    const ergebnis = await entziehe({ fehler: null }, formular({ email: "gast@example.at" }));

    expect(ergebnis.fehler).toBeNull();
    const rest = await umgebung.db.select().from(allowedEmail);
    expect(rest.map((e) => e.email)).toEqual(["chef@example.at"]);
  });

  it("weist eine angemeldete Person ohne Betreiber-Rolle ab", async () => {
    await legeBetreiberAn();
    await legeGastAn();
    angemeldeteEmail = "gast@example.at";

    const ergebnis = await entziehe({ fehler: null }, formular({ email: "chef@example.at" }));

    expect(ergebnis.fehler).toContain("betreibende Person");
  });

  /*
   * Der Angriff, den die Rolle verhindern soll: Eine eingeladene Person sperrt
   * die betreibende Person aus. Seit Fix-Runde 1 wäre das kein kosmetischer
   * Eingriff mehr, sondern ein endgültiger — zurück ginge es nur von Hand in
   * der Datenbank.
   */
  it("lässt eine eingeladene Person die betreibende Person nicht aussperren", async () => {
    await legeBetreiberAn();
    await legeGastAn();
    angemeldeteEmail = "gast@example.at";

    await entziehe({ fehler: null }, formular({ email: "chef@example.at" }));

    const rest = await umgebung.db.select().from(allowedEmail);
    expect(rest.map((e) => e.email).sort()).toEqual(["chef@example.at", "gast@example.at"]);
  });

  /*
   * Auch die betreibende Person selbst darf sich nicht aussperren — danach käme
   * niemand mehr in die Verwaltung.
   */
  it("verhindert den Selbstentzug", async () => {
    await legeBetreiberAn();

    const ergebnis = await entziehe({ fehler: null }, formular({ email: "chef@example.at" }));

    expect(ergebnis.fehler).toContain("nicht selbst entziehen");
    expect((await umgebung.db.select().from(allowedEmail)).length).toBe(1);
  });

  it("verhindert den Selbstentzug auch bei abweichender Schreibweise", async () => {
    await legeBetreiberAn();

    const ergebnis = await entziehe({ fehler: null }, formular({ email: " Chef@Example.AT " }));

    expect(ergebnis.fehler).toContain("nicht selbst entziehen");
    expect((await umgebung.db.select().from(allowedEmail)).length).toBe(1);
  });
});

import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { sql } from "drizzle-orm";
import { allowedEmail } from "@/db/schema/zugriff";
import { NichtBetreiber, type ZugriffsDb } from "@/lib/zugriff";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

/*
 * Prüft `src/lib/sitzung.ts` **selbst** — und zwar den echten Code, nicht eine
 * Attrappe davon.
 *
 * Warum es diese Datei braucht: `tests/verwaltung-aktionen.test.ts` ersetzt
 * `@/lib/sitzung` per `mock.module`, und das gilt in Bun für den gesamten Lauf.
 * Damit lief bis zu dieser Datei **keine einzige Zeile** aus `sitzung.ts` in
 * irgendeinem Test. Man konnte die Berechtigungsprüfung aus `requireBetreiber`
 * streichen, und die Suite blieb grün.
 *
 * `holeBerechtigung` ist dabei die schärfere Kante: Lieferte es einmal
 * bedingungslos `darfVerwalten: true`, zeigte `/verwaltung/zugriff` jeder
 * angemeldeten Person die vollständige Freischaltliste **und** das
 * Abweisungsprotokoll — also Adressen von Menschen, die gar keine Nutzer sind.
 * Keine Rechteausweitung, die Aktionen weigerten sich weiterhin; aber die
 * Preisgabe genau der Daten, für die es die 30-Tage-Frist in `abweisung.ts`
 * überhaupt gibt.
 */

const umgebung: TestDatenbank = await starteTestDatenbank();

/*
 * Tabelle auf oberster Ebene statt in `beforeAll`: Das Modul unter Test wird
 * weiter unten per `await import` geladen, und dieser Import läuft **vor**
 * jedem `beforeAll`.
 */
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
  `);
}

afterAll(async () => {
  await umgebung.stop();
});

type Angemeldet = {
  user: { id: string; email: string; name: string; image?: string | null };
} | null;

/** Wen Better Auth für die nächste Anfrage meldet. Pro Test gesetzt. */
let angemeldet: Angemeldet = null;

/*
 * Gestellt wird nur, was eine echte Anfrage bräuchte: die Kopfzeilen und die
 * Sitzungsauskunft. Die Berechtigungsprüfung darunter ist die echte und fragt
 * die Wegwerf-Datenbank.
 *
 * Jede Attrappe streut das echte Modul hinein (siehe die ausführliche Begründung
 * in `tests/verwaltung-aktionen.test.ts`): `mock.module` gilt für den ganzen
 * Lauf, eine unvollständige Attrappe nähme anderen Dateien Exporte weg.
 * `@/db` bleibt ohne Streuung, weil das Modul nur `db` exportiert.
 */
await mock.module("@/db", () => ({ db: umgebung.db as ZugriffsDb }));

const echtesHeaders = await import("next/headers");
await mock.module("next/headers", () => ({
  ...echtesHeaders,
  headers: async () => new Headers(),
}));

const echtesAuth = await import("@/lib/auth");
await mock.module("@/lib/auth", () => ({
  ...echtesAuth,
  auth: { api: { getSession: async () => angemeldet } },
}));

/*
 * Der Umweg über `?echt` ist der Kern dieser Datei.
 *
 * `tests/verwaltung-aktionen.test.ts` ersetzt `@/lib/sitzung` für den gesamten
 * Lauf. Ein gewöhnliches `import { requireBetreiber } from "@/lib/sitzung"`
 * bekäme hier je nach Dateireihenfolge die Attrappe — und die ruft
 * `pruefeBetreiber` selbst auf, die Tests unten wären also grün, ohne je den
 * echten Code berührt zu haben. Ein Wächter, den man nie hat scheitern sehen,
 * ist keiner.
 *
 * Der Anhang macht daraus einen eigenen Modul-Eintrag, den keine Attrappe
 * trifft; nachgemessen. Seine eigenen Importe — `@/db`, `@/lib/auth`,
 * `next/headers` — laufen dagegen über ihre gewöhnlichen Bezeichner und
 * bekommen deshalb sehr wohl die Attrappen von oben. Deshalb stehen die auch
 * vor diesem Import.
 *
 * `@/lib/zugriff` bleibt in beiden Fassungen dasselbe Modul, `NichtBetreiber`
 * ist also dieselbe Klasse — sonst schlüge `toBeInstanceOf` unten fehl.
 *
 * Der Bezeichner steht in einer Variablen, weil TypeScript ihn sonst auflösen
 * wollte und den Anhang nicht kennt.
 */
const echterBezeichner = "@/lib/sitzung?echt";
const { holeBerechtigung, requireBetreiber, requireUser } = (await import(
  echterBezeichner
)) as typeof import("@/lib/sitzung");

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table allowed_email`);
  angemeldet = null;
});

/** Betreiberin und Gast, beide freigeschaltet — nur eine darf verwalten. */
async function legeListeAn() {
  await umgebung.db.insert(allowedEmail).values([
    { id: "chef", email: "chef@example.at", istBetreiber: true },
    { id: "gast", email: "gast@example.at" },
  ]);
}

function meldeAn(email: string, weiteres: Partial<NonNullable<Angemeldet>["user"]> = {}) {
  angemeldet = { user: { id: "u1", email, name: "Wer", ...weiteres } };
}

describe("requireUser", () => {
  it("liefert die Person aus der Sitzung", async () => {
    meldeAn("gast@example.at", { id: "u7", name: "Gast", image: "https://example.at/bild.png" });

    expect(await requireUser()).toEqual({
      id: "u7",
      email: "gast@example.at",
      name: "Gast",
      image: "https://example.at/bild.png",
    });
  });
});

describe("holeBerechtigung", () => {
  // Der Normalfall: angemeldet, freigeschaltet — und trotzdem nicht berechtigt.
  it("meldet eine angemeldete Person ohne Betreiber-Rolle als nicht berechtigt", async () => {
    await legeListeAn();
    meldeAn("gast@example.at");

    const { benutzer, darfVerwalten } = await holeBerechtigung();

    expect(darfVerwalten).toBe(false);
    expect(benutzer.email).toBe("gast@example.at");
  });

  it("meldet die betreibende Person als berechtigt", async () => {
    await legeListeAn();
    meldeAn("chef@example.at");

    expect((await holeBerechtigung()).darfVerwalten).toBe(true);
  });

  /*
   * Dass die Entscheidung an der Adresse **der Sitzung** hängt und an nichts
   * sonst.
   *
   * Beide Fälle unterscheiden sich allein in der Sitzung, die Liste ist
   * dieselbe. Der erste schlösse aus, dass hier bloß „gibt es überhaupt eine
   * betreibende Person" gefragt wird (dann wäre er `true`); der zweite schließt
   * aus, dass ein anderes Feld der Sitzung gelesen wird — `name` und `id`
   * tragen dort die Adresse des Gasts, und trotzdem muss die Betreiberin
   * herauskommen.
   */
  it("entscheidet anhand der Adresse aus der Sitzung, nicht anhand eines anderen Feldes", async () => {
    await legeListeAn();
    meldeAn("chef@example.at", { id: "gast@example.at", name: "gast@example.at" });

    expect((await holeBerechtigung()).darfVerwalten).toBe(true);
  });
});

describe("requireBetreiber", () => {
  it("liefert die betreibende Person zurück", async () => {
    await legeListeAn();
    meldeAn("chef@example.at", { id: "u3", name: "Chefin" });

    expect(await requireBetreiber()).toEqual({
      id: "u3",
      email: "chef@example.at",
      name: "Chefin",
      image: undefined,
    });
  });

  /*
   * Die eine Zeile, um die es geht. Streicht jemand `pruefeBetreiber` aus
   * `requireBetreiber`, wird genau dieser Test rot — und mit ihm der einzige
   * Berechtigungswächter, den die beiden Server-Aktionen haben.
   */
  it("wirft NichtBetreiber für eine angemeldete Person ohne Rolle", async () => {
    await legeListeAn();
    meldeAn("gast@example.at");

    expect(await faengtFehler(() => requireBetreiber())).toBeInstanceOf(NichtBetreiber);
  });

  // Fehlschlagen in Richtung „zu": ohne Eintrag kommt niemand durch.
  it("wirft auch, wenn es überhaupt keine betreibende Person gibt", async () => {
    meldeAn("chef@example.at");

    expect(await faengtFehler(() => requireBetreiber())).toBeInstanceOf(NichtBetreiber);
  });

  /*
   * Und die Prüfung hängt an der Adresse der Sitzung: dieselbe Liste wie oben,
   * nur eine andere angemeldete Person — und das Ergebnis kippt.
   */
  it("prüft die Adresse aus der Sitzung", async () => {
    await legeListeAn();
    meldeAn("gast@example.at", { name: "chef@example.at" });

    expect(await faengtFehler(() => requireBetreiber())).toBeInstanceOf(NichtBetreiber);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import {
  NichtBetreiber,
  ZugriffVerweigert,
  gibtEsBetreiber,
  istBetreiber,
  istEmailZugelassen,
  normalisiereEmail,
  pruefeBetreiber,
  pruefeZugang,
  pruefeZugangFuerNutzer,
} from "@/lib/zugriff";
import { allowedEmail } from "@/db/schema/zugriff";
import { user } from "@/db/schema/auth";
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
    create table "user" (
      id text primary key,
      name text not null,
      email text not null unique,
      email_verified boolean not null default false,
      image text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table allowed_email, "user"`);
});

/** Legt eine Nutzerzeile an und liefert deren Kennung zurück. */
async function legeNutzerAn(email: string, id = "u1") {
  await umgebung.db.insert(user).values({ id, name: "Wer", email, updatedAt: new Date() });
  return id;
}

describe("normalisiereEmail", () => {
  it("senkt Groß- auf Kleinschreibung und entfernt Leerzeichen", () => {
    expect(normalisiereEmail("  Christopher@Example.AT ")).toBe("christopher@example.at");
  });
});

describe("istEmailZugelassen", () => {
  it("erkennt eine eingetragene Adresse", async () => {
    await umgebung.db.insert(allowedEmail).values({ id: "1", email: "christopher@example.at" });
    expect(await istEmailZugelassen(umgebung.db, "christopher@example.at")).toBe(true);
  });

  it("erkennt sie unabhängig von der Schreibweise", async () => {
    await umgebung.db.insert(allowedEmail).values({ id: "1", email: "christopher@example.at" });
    expect(await istEmailZugelassen(umgebung.db, " CHRISTOPHER@Example.at ")).toBe(true);
  });

  it("weist eine nicht eingetragene Adresse ab", async () => {
    expect(await istEmailZugelassen(umgebung.db, "fremd@example.at")).toBe(false);
  });

  it("weist bei komplett leerer Allowlist ab", async () => {
    expect(await istEmailZugelassen(umgebung.db, "irgendwer@example.at")).toBe(false);
  });

  it("weist Eingaben ab, die nur aus Leerzeichen bestehen", async () => {
    await umgebung.db.insert(allowedEmail).values({ id: "1", email: "christopher@example.at" });
    expect(await istEmailZugelassen(umgebung.db, "   ")).toBe(false);
  });
});

/*
 * Geprüft wird der **Name** der verletzten Bedingung, nicht bloß, dass
 * irgendetwas geworfen wurde.
 *
 * Ein `expect(fehler).toBeDefined()` wäre auch dann grün, wenn das Einfügen aus
 * einem völlig anderen Grund scheitert — ein doppelter Primärschlüssel, eine
 * umbenannte Spalte, eine fehlende Tabelle. Der Test bestätigte dann eine
 * Absicherung, die es gar nicht mehr gibt — nachgestellt und bestätigt: mit
 * einem doppelten Primärschlüssel meldet Postgres `allowed_email_pkey`, und
 * `toBeDefined()` war damit grün. Den Namen zu prüfen kostet nichts und macht
 * aus dem Test eine Aussage.
 */
describe("allowed_email-Constraints", () => {
  /**
   * Führt das Einfügen aus und liefert den Namen der verletzten Bedingung.
   *
   * Der Umweg über `cause`: Drizzle verpackt den Fehler von `pg` in einen
   * `DrizzleQueryError` (Feld `query`, `params`, `cause`). Der Name der
   * Bedingung steht am ursprünglichen Fehler darunter, nicht am äußeren.
   *
   * Kein `.rejects`: siehe Kommentar bei `pruefeZugang` unten — hier fangen wir
   * den Fehler selbst ein, statt ihn `expect().rejects` prüfen zu lassen.
   */
  async function verletzteBedingung(email: string): Promise<string | undefined> {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(allowedEmail).values({ id: "1", email }),
    );
    return (fehler as { cause?: { constraint?: string } } | undefined)?.cause?.constraint;
  }

  it("lehnt eine leere E-Mail-Adresse ab", async () => {
    expect(await verletzteBedingung("")).toBe("allowed_email_nicht_leer");
  });

  it("lehnt eine nicht kleingeschriebene E-Mail-Adresse ab", async () => {
    expect(await verletzteBedingung("Christopher@Example.AT")).toBe("allowed_email_klein");
  });
});

describe("pruefeZugang", () => {
  it("lässt eine zugelassene Adresse passieren", async () => {
    await umgebung.db.insert(allowedEmail).values({ id: "1", email: "christopher@example.at" });
    // Kein `.resolves` hier: Auf diesem Windows-Bun (1.3.14) hängt bzw. crasht
    // `expect(promise).resolves`, sobald im selben Test zuvor schon eine
    // pg-Query per einfachem `await` gelaufen ist (reproduzierbar bis zum
    // Bun-Segfault, unabhängig von drizzle — auch mit rohem `pg`). Serverseitig
    // ist die Query bereits fertig, nur das JS-Promise löst nie auf. Diese
    // Zeile ist funktional identisch zu `.resolves.toBeUndefined()`.
    expect(await pruefeZugang(umgebung.db, "christopher@example.at")).toBeUndefined();
  });

  it("wirft ZugriffVerweigert bei fremder Adresse", async () => {
    await expect(pruefeZugang(umgebung.db, "fremd@example.at")).rejects.toBeInstanceOf(
      ZugriffVerweigert,
    );
  });

  it("wirft ZugriffVerweigert bei fehlender Adresse", async () => {
    await expect(pruefeZugang(umgebung.db, undefined)).rejects.toBeInstanceOf(ZugriffVerweigert);
    await expect(pruefeZugang(umgebung.db, null)).rejects.toBeInstanceOf(ZugriffVerweigert);
    await expect(pruefeZugang(umgebung.db, "")).rejects.toBeInstanceOf(ZugriffVerweigert);
  });
});

/*
 * Die Prüfung, die aus „Zugang entziehen" eine echte Aussperrung macht.
 *
 * Der Sitzungs-Hook von Better Auth bekommt nur die Sitzungsdaten — darin steht
 * `userId`, aber keine Adresse. Diese Funktion schlägt sie nach und prüft sie.
 */
describe("pruefeZugangFuerNutzer", () => {
  it("lässt einen freigeschalteten Nutzer passieren und liefert seine Adresse", async () => {
    await umgebung.db.insert(allowedEmail).values({ id: "1", email: "christopher@example.at" });
    const id = await legeNutzerAn("christopher@example.at");

    expect(await pruefeZugangFuerNutzer(umgebung.db, id)).toBe("christopher@example.at");
  });

  /*
   * Der eigentliche Punkt: Ein Konto besteht, die Adresse steht nicht mehr auf
   * der Liste. Vor dieser Prüfung kam diese Person ungehindert wieder herein,
   * weil `user.create.before` nur beim Anlegen des Kontos feuert.
   */
  it("weist einen Nutzer ab, dessen Adresse nicht mehr freigeschaltet ist", async () => {
    const id = await legeNutzerAn("entzogen@example.at");

    expect(await faengtFehler(() => pruefeZugangFuerNutzer(umgebung.db, id))).toBeInstanceOf(
      ZugriffVerweigert,
    );
  });

  /*
   * `user.email` trägt die Schreibweise des Anbieters und wird nirgends
   * normalisiert; `allowed_email.email` ist per Constraint kleingeschrieben.
   * Ohne Normalisierung in der Prüfung würde diese Person fälschlich
   * ausgesperrt.
   */
  it("erkennt die Freischaltung unabhängig von der Schreibweise der Nutzerzeile", async () => {
    await umgebung.db.insert(allowedEmail).values({ id: "1", email: "gross@example.at" });
    const id = await legeNutzerAn("Gross@Example.AT");

    expect(await pruefeZugangFuerNutzer(umgebung.db, id)).toBe("gross@example.at");
  });

  it("weist ab, wenn es zu der Kennung gar keinen Nutzer gibt", async () => {
    expect(
      await faengtFehler(() => pruefeZugangFuerNutzer(umgebung.db, "gibtesnicht")),
    ).toBeInstanceOf(ZugriffVerweigert);
  });

  it("weist ohne Kennung ab", async () => {
    expect(await faengtFehler(() => pruefeZugangFuerNutzer(umgebung.db, ""))).toBeInstanceOf(
      ZugriffVerweigert,
    );
  });
});

/*
 * Die Betreiber-Rolle.
 *
 * Sie ist nötig, seit ein Entzug wirklich aussperrt: Vorher war es kosmetisch,
 * wenn eine eingeladene Person die Zeile der betreibenden Person löschte; heute
 * beendet derselbe Griff deren Sitzungen, und es gibt in der App keinen Weg
 * zurück.
 */
describe("istBetreiber", () => {
  it("erkennt die betreibende Person", async () => {
    await umgebung.db
      .insert(allowedEmail)
      .values({ id: "1", email: "chef@example.at", istBetreiber: true });

    expect(await istBetreiber(umgebung.db, "chef@example.at")).toBe(true);
  });

  it("erkennt sie unabhängig von der Schreibweise", async () => {
    await umgebung.db
      .insert(allowedEmail)
      .values({ id: "1", email: "chef@example.at", istBetreiber: true });

    expect(await istBetreiber(umgebung.db, " Chef@Example.AT ")).toBe(true);
  });

  // Der Normalfall: eingeladen heißt nicht verwalten dürfen.
  it("meldet eine bloß freigeschaltete Adresse als nicht betreibend", async () => {
    await umgebung.db.insert(allowedEmail).values({ id: "1", email: "gast@example.at" });

    expect(await istBetreiber(umgebung.db, "gast@example.at")).toBe(false);
  });

  it("meldet eine unbekannte Adresse als nicht betreibend", async () => {
    expect(await istBetreiber(umgebung.db, "fremd@example.at")).toBe(false);
  });

  it("meldet eine leere Adresse als nicht betreibend", async () => {
    expect(await istBetreiber(umgebung.db, "   ")).toBe(false);
  });
});

describe("gibtEsBetreiber", () => {
  it("meldet eine frisch aufgesetzte Datenbank als betreiberlos", async () => {
    expect(await gibtEsBetreiber(umgebung.db)).toBe(false);
  });

  // Eine Datenbank, bei der beim Aufsetzen das Flag vergessen wurde: Es gibt
  // Einträge, aber niemanden, der verwalten darf.
  it("meldet eine Liste ohne gesetztes Flag als betreiberlos", async () => {
    await umgebung.db.insert(allowedEmail).values({ id: "1", email: "gast@example.at" });

    expect(await gibtEsBetreiber(umgebung.db)).toBe(false);
  });

  it("erkennt, sobald es eine betreibende Person gibt", async () => {
    await umgebung.db
      .insert(allowedEmail)
      .values({ id: "1", email: "chef@example.at", istBetreiber: true });

    expect(await gibtEsBetreiber(umgebung.db)).toBe(true);
  });
});

describe("pruefeBetreiber", () => {
  it("lässt die betreibende Person passieren", async () => {
    await umgebung.db
      .insert(allowedEmail)
      .values({ id: "1", email: "chef@example.at", istBetreiber: true });

    expect(await pruefeBetreiber(umgebung.db, "chef@example.at")).toBeUndefined();
  });

  it("wirft NichtBetreiber für eine bloß eingeladene Person", async () => {
    await umgebung.db.insert(allowedEmail).values({ id: "1", email: "gast@example.at" });

    expect(await faengtFehler(() => pruefeBetreiber(umgebung.db, "gast@example.at"))).toBeInstanceOf(
      NichtBetreiber,
    );
  });

  it("wirft auch, wenn es überhaupt keine betreibende Person gibt", async () => {
    // Fehlschlagen in Richtung „zu", nicht in Richtung „offen": Eine Datenbank
    // ohne gesetztes Flag darf die Verwaltung nicht für alle öffnen.
    expect(await faengtFehler(() => pruefeBetreiber(umgebung.db, "wer@example.at"))).toBeInstanceOf(
      NichtBetreiber,
    );
  });
});

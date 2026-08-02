import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import {
  ZugriffVerweigert,
  istEmailZugelassen,
  normalisiereEmail,
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

describe("allowed_email-Constraints", () => {
  it("lehnt eine leere E-Mail-Adresse ab", async () => {
    // Kein `.rejects`: siehe Kommentar bei pruefeZugang oben — hier fangen wir
    // den Fehler selbst ein, statt ihn `expect().rejects` prüfen zu lassen.
    let fehler: unknown;
    try {
      await umgebung.db.insert(allowedEmail).values({ id: "1", email: "" });
    } catch (e) {
      fehler = e;
    }
    expect(fehler).toBeDefined();
  });

  it("lehnt eine nicht kleingeschriebene E-Mail-Adresse ab", async () => {
    let fehler: unknown;
    try {
      await umgebung.db.insert(allowedEmail).values({ id: "1", email: "Christopher@Example.AT" });
    } catch (e) {
      fehler = e;
    }
    expect(fehler).toBeDefined();
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

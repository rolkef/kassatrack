import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { erzeugeAuth } from "@/lib/auth";
import { allowedEmail } from "@/db/schema/zugriff";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

let umgebung: TestDatenbank;
let auth: ReturnType<typeof erzeugeAuth>;

/** Greift genau den Hook ab, den Better Auth vor jedem Nutzer-Insert ausführt. */
function holeGate() {
  const hook = auth.options.databaseHooks?.user?.create?.before;
  if (!hook) throw new Error("databaseHooks.user.create.before ist nicht verdrahtet");
  return hook;
}

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
    )
  `);
  auth = erzeugeAuth(umgebung.db);
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table allowed_email`);
});

describe("Registrierungs-Gate", () => {
  it("ist als databaseHooks.user.create.before verdrahtet", () => {
    expect(typeof holeGate()).toBe("function");
  });

  it("weist eine nicht freigeschaltete Adresse ab", async () => {
    const gate = holeGate();
    const fehler = await faengtFehler(() =>
      gate({ email: "fremd@example.at", name: "Fremd" } as never, {} as never),
    );
    expect(fehler).toBeDefined();
  });

  it("lässt eine freigeschaltete Adresse durch", async () => {
    await umgebung.db.insert(allowedEmail).values({ id: "1", email: "christopher@example.at" });
    const gate = holeGate();
    const fehler = await faengtFehler(() =>
      gate({ email: "christopher@example.at", name: "Christopher" } as never, {} as never),
    );
    expect(fehler).toBeUndefined();
  });
});

describe("Auth-Konfiguration", () => {
  it("hat Google als Social Provider", () => {
    expect(auth.options.socialProviders?.google).toBeDefined();
  });

  it("hat E-Mail-und-Passwort deaktiviert", () => {
    expect(auth.options.emailAndPassword?.enabled ?? false).toBe(false);
  });
});

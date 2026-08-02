import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { erzeugeAuth } from "@/lib/auth";
import { ABWEISUNG, ZUGANG_NICHT_FREIGESCHALTET } from "@/lib/anmeldung";
import { allowedEmail } from "@/db/schema/zugriff";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

/**
 * Legt `allowed_email` frisch an — als eigene Funktion, weil der
 * Rethrow-Test (siehe unten) die Tabelle absichtlich löscht, um einen
 * echten Datenbankfehler zu erzeugen, und sie danach wiederherstellen muss,
 * sonst würde jeder nachfolgende Test am fehlenden `truncate table
 * allowed_email` in `beforeEach` scheitern.
 */
async function erzeugeAllowedEmailTabelle(db: TestDatenbank["db"]) {
  await db.execute(sql`
    create table allowed_email (
      id text primary key,
      email text not null unique,
      hinzugefuegt_von text,
      erstellt_am timestamptz not null default now(),
      constraint allowed_email_nicht_leer check (email <> ''),
      constraint allowed_email_klein check (email = lower(email))
    )
  `);
}

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
  await erzeugeAllowedEmailTabelle(umgebung.db);
  // Nur die Better-Auth-Tabelle, die die neuen Adapter-Tests tatsächlich
  // brauchen (siehe "Datenbank-Adapter" unten) — bewusst nicht session,
  // account, verification, passkey, da hier niemand darauf zugreift.
  await umgebung.db.execute(sql`
    create table "user" (
      id text primary key,
      name text not null,
      email text not null unique,
      email_verified boolean not null default false,
      image text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  auth = erzeugeAuth(umgebung.db);
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table allowed_email`);
  await umgebung.db.execute(sql`truncate table "user" cascade`);
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

  // Ohne `code` im APIError-Body wird die Abweisung unsichtbar: Der
  // OAuth-Callback von Better Auth prüft `e.body?.code` und macht nur dann
  // eine Umleitung auf `errorCallbackURL` daraus (siehe
  // better-auth/dist/api/routes/callback.mjs). Fehlt der Code, fliegt der
  // Fehler weiter und die Person landet auf einer englischen Standardseite
  // statt auf der Anmeldeseite. Der Code muss zudem exakt der sein, den
  // `deuteRueckleitung` erwartet.
  it("gibt der Abweisung den Code mit, den die Anmeldeseite auswertet", async () => {
    const gate = holeGate();
    const fehler = await faengtFehler(() =>
      gate({ email: "fremd@example.at", name: "Fremd" } as never, {} as never),
    );

    expect(fehler).toBeInstanceOf(APIError);
    const koerper = (fehler as APIError).body;
    expect(koerper?.code).toBe(ZUGANG_NICHT_FREIGESCHALTET);
    expect(koerper?.message).toBe(ABWEISUNG);
  });

  // Better Auth hängt `message` als `error_description` an die
  // Rückleitungs-URL. Eine E-Mail-Adresse stünde damit im Browserverlauf und
  // in jedem Zugriffsprotokoll davor — deshalb bleibt sie serverseitig.
  it("trägt die abgewiesene Adresse nicht in die Meldung, die nach außen geht", async () => {
    const gate = holeGate();
    const fehler = await faengtFehler(() =>
      gate({ email: "fremd@example.at", name: "Fremd" } as never, {} as never),
    );

    expect((fehler as APIError).body?.message).not.toContain("fremd@example.at");
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

describe("Datenbank-Adapter", () => {
  // Ohne `schema` im drizzleAdapter wird kein Modell aufgelöst — jeder
  // Adapter-Aufruf wirft "The model ... was not found in the schema
  // object", bevor überhaupt eine Query läuft. `tsc` und `bun run build`
  // sehen das nicht (die Option ist optional, der Fehler passiert erst zur
  // Laufzeit), und die Gate-Tests oben auch nicht, weil sie den Hook direkt
  // aufrufen statt über Better Auth. Dieser Test ruft den echten Adapter.
  it("löst das user-Modell auf, statt mit einem Schema-Fehler zu werfen", async () => {
    const context = await auth.$context;
    const treffer = await context.adapter.findOne({ model: "user", where: [] });
    expect(treffer).toBeNull();
  });

  // Stärker als die Gate-Tests oben: die ruft niemand den Hook direkt auf,
  // sondern lässt Better Auths eigenen internen Erstellungspfad
  // (`internalAdapter.createUser`) laufen — dem Pfad, den jede echte
  // Registrierung (Google, Passkey) tatsächlich durchläuft. Das belegt,
  // dass das Gate nicht nur als Funktion existiert, sondern von Better Auth
  // wirklich aufgerufen wird.
  it("lässt eine echte Nutzererstellung für eine freigeschaltete Adresse durch", async () => {
    await umgebung.db.insert(allowedEmail).values({ id: "2", email: "erlaubt@example.at" });
    const context = await auth.$context;
    const nutzer = await context.internalAdapter.createUser({
      email: "erlaubt@example.at",
      name: "Erlaubt",
    });
    expect(nutzer.email).toBe("erlaubt@example.at");
  });

  it("blockiert eine echte Nutzererstellung für eine nicht freigeschaltete Adresse", async () => {
    const context = await auth.$context;
    const fehler = await faengtFehler(() =>
      context.internalAdapter.createUser({ email: "geblockt@example.at", name: "Geblockt" }),
    );
    expect(fehler).toBeDefined();
  });
});

describe("Datenbankausfall", () => {
  // Schützt genau die Zeile `throw fehler;` im else-Zweig des Gates
  // (Abnahmekriterium 1 aus dem Brief). Ohne diesen Test würde ein `catch`,
  // das den Fehler verschluckt oder ihn fälschlich in einen APIError
  // verpackt, keinen der obigen Tests zum Scheitern bringen — die laufen
  // alle gegen eine gesunde Datenbank und durchlaufen nie den else-Zweig.
  it("wirft den Datenbankfehler unverändert weiter, wenn die Abfrage selbst fehlschlägt", async () => {
    await umgebung.db.execute(sql`drop table allowed_email`);
    try {
      const gate = holeGate();
      const fehler = await faengtFehler(() =>
        gate({ email: "irgendwer@example.at", name: "Irgendwer" } as never, {} as never),
      );
      expect(fehler).toBeDefined();
      expect(fehler).not.toBeInstanceOf(APIError);
    } finally {
      // Sonst scheitert der `truncate table allowed_email` im nächsten
      // beforeEach an der fehlenden Tabelle — Testisolation wieder herstellen.
      await erzeugeAllowedEmailTabelle(umgebung.db);
    }
  });
});

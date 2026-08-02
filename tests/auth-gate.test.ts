import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { sql } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { erzeugeAuth } from "@/lib/auth";
import { ABWEISUNG, ZUGANG_NICHT_FREIGESCHALTET, deuteRueckleitung } from "@/lib/anmeldung";
import { holeAbweisungen } from "@/lib/abweisung";
import { entzieheZugang } from "@/lib/einladung";
import { allowedEmail } from "@/db/schema/zugriff";
import { user } from "@/db/schema/auth";
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

/**
 * Wie `erzeugeAllowedEmailTabelle`, und aus demselben Grund als Funktion: Der
 * Test „auch wenn das Mitschreiben scheitert" löscht die Tabelle absichtlich.
 */
async function erzeugeAbweisungsTabelle(db: TestDatenbank["db"]) {
  await db.execute(sql`
    create table abweisung (
      id text primary key,
      email text,
      weg text,
      zeitpunkt timestamptz not null default now()
    )
  `);
}

/**
 * Führt die Aktion aus, während `console.warn` stummgeschaltet ist, und
 * bestätigt, dass überhaupt gewarnt wurde.
 *
 * Die Tests, die das Protokoll absichtlich zerstören, erzeugen sonst echte
 * Warnungen in der Testausgabe. Stummschalten allein wäre aber zu viel des
 * Guten: Dass der Ausfall gemeldet wird, ist Teil der Zusage — still
 * verschluckt wäre er im Betrieb unauffindbar.
 */
async function ohneWarnung<T>(aktion: () => Promise<T>): Promise<T> {
  const stille = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const ergebnis = await aktion();
    expect(stille).toHaveBeenCalled();
    return ergebnis;
  } finally {
    stille.mockRestore();
  }
}

let umgebung: TestDatenbank;
let auth: ReturnType<typeof erzeugeAuth>;

/** Greift genau den Hook ab, den Better Auth vor jedem Nutzer-Insert ausführt. */
function holeGate() {
  const hook = auth.options.databaseHooks?.user?.create?.before;
  if (!hook) throw new Error("databaseHooks.user.create.before ist nicht verdrahtet");
  return hook;
}

/** Dasselbe für den Hook vor jedem Sitzungs-Insert — die Prüfung bei Anmeldung. */
function holeSitzungsGate() {
  const hook = auth.options.databaseHooks?.session?.create?.before;
  if (!hook) throw new Error("databaseHooks.session.create.before ist nicht verdrahtet");
  return hook;
}

beforeAll(async () => {
  umgebung = await starteTestDatenbank();
  await erzeugeAllowedEmailTabelle(umgebung.db);
  await erzeugeAbweisungsTabelle(umgebung.db);
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
    );
    -- Für den Nachweis, dass ein Entzug wirklich aussperrt: Dafür muss
    -- Better Auths echter createSession-Pfad laufen können.
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
  auth = erzeugeAuth(umgebung.db);
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table allowed_email`);
  await umgebung.db.execute(sql`truncate table abweisung`);
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

  it("weist mit einem APIError ab, nicht mit einem beliebigen Fehler", async () => {
    const gate = holeGate();
    const fehler = await faengtFehler(() =>
      gate({ email: "fremd@example.at", name: "Fremd" } as never, {} as never),
    );

    expect(fehler).toBeInstanceOf(APIError);
    expect((fehler as APIError).statusCode).toBe(403);
  });

  // Better Auth hängt die Meldung an die Rückleitungs-URL. Eine E-Mail-Adresse
  // stünde damit im Browserverlauf und in jedem Zugriffsprotokoll davor.
  it("trägt die abgewiesene Adresse nicht in das, was nach außen geht", async () => {
    const gate = holeGate();
    const fehler = await faengtFehler(() =>
      gate({ email: "fremd@example.at", name: "Fremd" } as never, {} as never),
    );

    const koerper = (fehler as APIError).body;
    expect(koerper?.message).not.toContain("fremd@example.at");
    expect(koerper?.code).not.toContain("fremd@example.at");
  });
});

/*
 * Bis hierher war eine Abweisung folgenlos: Die abgewiesene Person erfuhr
 * davon, die betreibende Person nicht. Und weil die Adresse aus dem
 * ausgehenden Fehler bewusst herausgehalten wird (siehe oben), gab es gar
 * keinen Weg mehr, auf dem sie irgendwo ankäme.
 */
describe("Mitschreiben der Abweisung", () => {
  it("hält eine Abweisung mit Adresse und Weg fest", async () => {
    const gate = holeGate();
    await faengtFehler(() =>
      gate({ email: "fremd@example.at", name: "Fremd" } as never, {
        path: "/callback/google",
      } as never),
    );

    const [eintrag] = await holeAbweisungen(umgebung.db);
    expect(eintrag?.email).toBe("fremd@example.at");
    expect(eintrag?.weg).toBe("/callback/google");
  });

  it("kommt ohne Kontext zurecht", async () => {
    const gate = holeGate();
    await faengtFehler(() =>
      gate({ email: "fremd@example.at", name: "Fremd" } as never, null as never),
    );

    const [eintrag] = await holeAbweisungen(umgebung.db);
    expect(eintrag?.weg).toBeNull();
  });

  it("schreibt eine erfolgreiche Anmeldung nicht mit", async () => {
    await umgebung.db.insert(allowedEmail).values({ id: "ok", email: "erlaubt@example.at" });
    const gate = holeGate();
    await faengtFehler(() =>
      gate({ email: "erlaubt@example.at", name: "Erlaubt" } as never, {} as never),
    );

    expect(await holeAbweisungen(umgebung.db)).toEqual([]);
  });

  /*
   * Der Test, der die Sicherheitsgrenze bewacht.
   *
   * Das Mitschreiben sitzt im Gate, direkt vor dem `throw`. Würde ein Fehler
   * dort nach außen dringen, wäre aus einer sauberen 403-Abweisung ein
   * Serverfehler geworden — und ein Serverfehler an dieser Stelle ist genau
   * das, was Better Auth anders behandelt als eine Abweisung. Eine fehlende
   * Protokolltabelle darf niemals die Tür öffnen.
   */
  it("weist trotzdem mit einem APIError ab, wenn das Mitschreiben scheitert", async () => {
    await umgebung.db.execute(sql`drop table abweisung`);
    try {
      const gate = holeGate();
      const fehler = await ohneWarnung(() =>
        faengtFehler(() => gate({ email: "fremd@example.at", name: "Fremd" } as never, {} as never)),
      );

      expect(fehler).toBeInstanceOf(APIError);
      expect((fehler as APIError).statusCode).toBe(403);
    } finally {
      await erzeugeAbweisungsTabelle(umgebung.db);
    }
  });

  it("lässt eine freigeschaltete Adresse auch dann durch, wenn das Protokoll fehlt", async () => {
    await umgebung.db.execute(sql`drop table abweisung`);
    try {
      await umgebung.db.insert(allowedEmail).values({ id: "ok2", email: "erlaubt@example.at" });
      const gate = holeGate();
      const fehler = await faengtFehler(() =>
        gate({ email: "erlaubt@example.at", name: "Erlaubt" } as never, {} as never),
      );

      expect(fehler).toBeUndefined();
    } finally {
      await erzeugeAbweisungsTabelle(umgebung.db);
    }
  });
});

/*
 * Der eigentliche Test dieser Runde.
 *
 * Die erste Fassung hatte an beiden Enden übereinstimmende Konstanten und war
 * zur Laufzeit trotzdem falsch: Better Auth nimmt auf dem Weg, den Google
 * wirklich geht, nicht den `code`, sondern die `message` — und ersetzt darin
 * Leerzeichen durch Unterstriche. Ein Test auf die Konstanten hätte das nie
 * bemerkt. Deshalb wird hier nachgebaut, was Better Auth aussendet, und das
 * Ergebnis durch `deuteRueckleitung` geschickt.
 */
describe("Ausgesendeter Fehlerparameter", () => {
  /**
   * Nachbau von `redirectOnError` aus better-auth. Zwei Quellen:
   *
   * - `api/routes/callback.mjs`: der Weg über `handleOAuthUserInfo` liefert
   *   `result.error` (= `e.message`) und ruft
   *   `redirectOnError(c, url, result.error.split(" ").join("_"))`.
   * - `oauth2/errors.mjs`: `new URLSearchParams({ error })`.
   */
  function ausgesendeterParameter(fehler: APIError, weg: "meldung" | "code") {
    const roh = weg === "meldung" ? fehler.message : (fehler.body?.code as string);
    const umgeformt = roh.split(" ").join("_");
    const url = new URL(`https://example.at/anmelden?${new URLSearchParams({ error: umgeformt })}`);
    return url.searchParams.get("error");
  }

  async function abweisung() {
    const gate = holeGate();
    const fehler = await faengtFehler(() =>
      gate({ email: "fremd@example.at", name: "Fremd" } as never, {} as never),
    );
    return fehler as APIError;
  }

  it("wird über die Meldung zu einer Abweisung gedeutet", async () => {
    // Das ist der Weg, den eine echte Google-Anmeldung nimmt.
    const parameter = ausgesendeterParameter(await abweisung(), "meldung");

    expect(parameter).toBe(ZUGANG_NICHT_FREIGESCHALTET);
    expect(deuteRueckleitung(parameter ?? undefined)?.abgewiesen).toBe(true);
  });

  it("wird über den Code zu einer Abweisung gedeutet", async () => {
    // Der zweite Weg, falls der Fehler außerhalb des inneren try fliegt.
    const parameter = ausgesendeterParameter(await abweisung(), "code");

    expect(parameter).toBe(ZUGANG_NICHT_FREIGESCHALTET);
    expect(deuteRueckleitung(parameter ?? undefined)?.abgewiesen).toBe(true);
  });

  it("bleibt unversehrt, wenn Leerzeichen zu Unterstrichen würden", async () => {
    // Genau hier ist die erste Fassung gescheitert: ein deutscher Satz wurde
    // zu `Diese_Adresse_ist_für_…` und lief an `deuteRueckleitung` vorbei.
    const fehler = await abweisung();

    expect(fehler.message).not.toContain(" ");
    expect(fehler.body?.code).not.toContain(" ");
    // Beide Wege müssen denselben Wert aussenden, sonst deutet die
    // Anmeldeseite je nach Weg etwas anderes.
    expect(fehler.message).toBe(fehler.body?.code as string);
  });

  it("zeigt der Person trotzdem einen deutschen Satz, keine Marke", () => {
    const meldung = deuteRueckleitung(ZUGANG_NICHT_FREIGESCHALTET);

    expect(meldung?.text).toBe(ABWEISUNG);
    expect(meldung?.text).not.toContain("ZUGANG_NICHT");
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

/*
 * Das Gate, das „Zugang entziehen" überhaupt erst wirksam macht.
 *
 * `user.create.before` feuert genau einmal — beim Anlegen des Kontos. Wer
 * bereits ein Konto hatte, kam danach ohne jede Prüfung wieder herein; ein
 * Entzug war für genau die Personen wirkungslos, für die man den Knopf drückt.
 * Diese Prüfung läuft bei **jeder** Anmeldung, weil zu jeder Anmeldung eine
 * Sitzung angelegt wird.
 */
describe("Sitzungs-Gate", () => {
  async function legeNutzerAn(email: string, id = "s1") {
    await umgebung.db.insert(user).values({ id, name: "Wer", email, updatedAt: new Date() });
    return id;
  }

  it("ist als databaseHooks.session.create.before verdrahtet", () => {
    expect(typeof holeSitzungsGate()).toBe("function");
  });

  it("lässt eine Sitzung für eine freigeschaltete Adresse zu", async () => {
    await umgebung.db.insert(allowedEmail).values({ id: "1", email: "erlaubt@example.at" });
    const id = await legeNutzerAn("erlaubt@example.at");

    const fehler = await faengtFehler(() =>
      holeSitzungsGate()({ userId: id, token: "t" } as never, {} as never),
    );
    expect(fehler).toBeUndefined();
  });

  it("weist eine Sitzung für eine entzogene Adresse mit 403 ab", async () => {
    const id = await legeNutzerAn("entzogen@example.at");

    const fehler = await faengtFehler(() =>
      holeSitzungsGate()({ userId: id, token: "t" } as never, {} as never),
    );
    expect(fehler).toBeInstanceOf(APIError);
    expect((fehler as APIError).statusCode).toBe(403);
  });

  it("trägt die abgewiesene Adresse nicht in das, was nach außen geht", async () => {
    const id = await legeNutzerAn("entzogen@example.at");

    const fehler = await faengtFehler(() =>
      holeSitzungsGate()({ userId: id, token: "t" } as never, {} as never),
    );
    const koerper = (fehler as APIError).body;
    expect(koerper?.message).not.toContain("entzogen@example.at");
    expect(koerper?.code).not.toContain("entzogen@example.at");
  });

  it("hält den abgewiesenen Anmeldeversuch fest", async () => {
    const id = await legeNutzerAn("entzogen@example.at");

    await faengtFehler(() =>
      holeSitzungsGate()({ userId: id, token: "t" } as never, {
        path: "/callback/google",
      } as never),
    );

    const [eintrag] = await holeAbweisungen(umgebung.db);
    expect(eintrag?.email).toBe("entzogen@example.at");
    expect(eintrag?.weg).toBe("/callback/google");
  });

  // Dieselbe Zusage wie beim Registrierungs-Gate: Ein kaputtes Protokoll darf
  // die Abweisung nicht ersetzen.
  it("weist trotzdem ab, wenn das Mitschreiben scheitert", async () => {
    const id = await legeNutzerAn("entzogen@example.at");
    await umgebung.db.execute(sql`drop table abweisung`);
    try {
      const fehler = await ohneWarnung(() =>
        faengtFehler(() => holeSitzungsGate()({ userId: id, token: "t" } as never, {} as never)),
      );
      expect(fehler).toBeInstanceOf(APIError);
      expect((fehler as APIError).statusCode).toBe(403);
    } finally {
      await erzeugeAbweisungsTabelle(umgebung.db);
    }
  });

  // Schützt den else-Zweig: Ein Datenbankausfall darf keine offene Anmeldung
  // ergeben, also muss der Fehler unverändert weiterfliegen statt zu einem
  // APIError zu werden — sonst sähe ein Ausfall aus wie eine saubere Abweisung.
  it("wirft einen Datenbankfehler unverändert weiter", async () => {
    const id = await legeNutzerAn("entzogen@example.at");
    await umgebung.db.execute(sql`drop table allowed_email`);
    try {
      const fehler = await faengtFehler(() =>
        holeSitzungsGate()({ userId: id, token: "t" } as never, {} as never),
      );
      expect(fehler).toBeDefined();
      expect(fehler).not.toBeInstanceOf(APIError);
    } finally {
      await erzeugeAllowedEmailTabelle(umgebung.db);
    }
  });
});

/*
 * Der Beweis, um den es bei dieser Änderung geht — über Better Auths echten
 * Erstellungspfad statt über den Hook direkt. `internalAdapter.createSession`
 * ist der Aufruf, den jede Anmeldung macht.
 */
describe("Entzug sperrt wirklich aus", () => {
  it("lässt eine freigeschaltete Person eine Sitzung anlegen, die entzogene nicht mehr", async () => {
    await umgebung.db.insert(allowedEmail).values({ id: "1", email: "person@example.at" });
    await umgebung.db
      .insert(user)
      .values({ id: "p1", name: "Person", email: "person@example.at", updatedAt: new Date() });

    const context = await auth.$context;

    // Vor dem Entzug: Anmelden geht.
    const sitzung = await context.internalAdapter.createSession("p1");
    expect(sitzung.userId).toBe("p1");

    // Entzug — genau das, was die Verwaltungsseite auslöst.
    await entzieheZugang(umgebung.db, "person@example.at");

    // Danach: keine neue Sitzung mehr, obwohl das Konto weiter besteht.
    const fehler = await faengtFehler(() => context.internalAdapter.createSession("p1"));
    expect(fehler).toBeDefined();

    // Und das Konto ist noch da — ausgesperrt, nicht gelöscht.
    expect((await umgebung.db.select().from(user)).length).toBe(1);
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

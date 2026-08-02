import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import {
  ZugriffVerweigert,
  istEmailZugelassen,
  normalisiereEmail,
  pruefeZugang,
} from "@/lib/zugriff";
import { allowedEmail } from "@/db/schema/zugriff";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";

let umgebung: TestDatenbank;

beforeAll(async () => {
  umgebung = await starteTestDatenbank();
  await umgebung.db.execute(sql`
    create table allowed_email (
      id text primary key,
      email text not null unique,
      hinzugefuegt_von text,
      erstellt_am timestamptz not null default now()
    )
  `);
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table allowed_email`);
});

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

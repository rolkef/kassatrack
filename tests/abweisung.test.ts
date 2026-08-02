import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import {
  AUFBEWAHRUNG_TAGE,
  benenneWeg,
  haltAbweisungFest,
  holeAbweisungen,
} from "@/lib/abweisung";
import { abweisung } from "@/db/schema/zugriff";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

let umgebung: TestDatenbank;

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

beforeAll(async () => {
  umgebung = await starteTestDatenbank();
  await erzeugeAbweisungsTabelle(umgebung.db);
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table abweisung`);
});

describe("haltAbweisungFest", () => {
  it("schreibt Adresse und Weg mit", async () => {
    await haltAbweisungFest(umgebung.db, { email: "fremd@example.at", weg: "/callback/google" });

    const [eintrag] = await holeAbweisungen(umgebung.db);
    expect(eintrag?.email).toBe("fremd@example.at");
    expect(eintrag?.weg).toBe("/callback/google");
  });

  it("hält den Zeitpunkt fest", async () => {
    const vorher = Date.now();
    await haltAbweisungFest(umgebung.db, { email: "fremd@example.at", weg: null });

    const [eintrag] = await holeAbweisungen(umgebung.db);
    expect(eintrag?.zeitpunkt.getTime()).toBeGreaterThanOrEqual(vorher - 1000);
  });

  it("schreibt die Adresse kleingeschrieben, damit Groß- und Kleinschreibung keine falsche Spur legt", async () => {
    // Die Allowlist vergleicht immer gegen die kleingeschriebene Form. Stünde
    // hier "Fremd@Example.AT", könnte man die Schreibweise für die Ursache
    // halten — sie ist es nie.
    await haltAbweisungFest(umgebung.db, { email: "  Fremd@Example.AT ", weg: null });

    const [eintrag] = await holeAbweisungen(umgebung.db);
    expect(eintrag?.email).toBe("fremd@example.at");
  });

  it("kommt ohne Adresse zurecht", async () => {
    // pruefeZugang wirft auch, wenn gar keine Adresse mitkam.
    await haltAbweisungFest(umgebung.db, { email: null, weg: "/passkey/verify" });

    const [eintrag] = await holeAbweisungen(umgebung.db);
    expect(eintrag?.email).toBeNull();
  });

  // Der wichtigste Test dieser Datei. Das Mitschreiben sitzt im Registrierungs-
  // Gate; könnte es werfen, würde ein kaputtes Protokoll die Abweisung selbst
  // zum Absturz bringen — und im schlimmsten Fall zu einem anderen Verhalten.
  it("wirft niemals, auch wenn die Tabelle fehlt", async () => {
    await umgebung.db.execute(sql`drop table abweisung`);
    try {
      const fehler = await faengtFehler(() =>
        haltAbweisungFest(umgebung.db, { email: "fremd@example.at", weg: null }),
      );
      expect(fehler).toBeUndefined();
    } finally {
      await erzeugeAbweisungsTabelle(umgebung.db);
    }
  });
});

describe("holeAbweisungen", () => {
  it("liefert den jüngsten Eintrag zuerst", async () => {
    await umgebung.db.insert(abweisung).values([
      { id: "alt", email: "alt@example.at", weg: null, zeitpunkt: new Date(Date.now() - 60_000) },
      { id: "neu", email: "neu@example.at", weg: null, zeitpunkt: new Date() },
    ]);

    const eintraege = await holeAbweisungen(umgebung.db);
    expect(eintraege.map((e) => e.email)).toEqual(["neu@example.at", "alt@example.at"]);
  });

  it("begrenzt die Anzahl", async () => {
    await umgebung.db.insert(abweisung).values(
      Array.from({ length: 5 }, (_, i) => ({
        id: `e${i}`,
        email: `e${i}@example.at`,
        weg: null,
        zeitpunkt: new Date(Date.now() - i * 1000),
      })),
    );

    expect((await holeAbweisungen(umgebung.db, 2)).length).toBe(2);
  });
});

describe("Aufbewahrung", () => {
  const zuAlt = () => new Date(Date.now() - (AUFBEWAHRUNG_TAGE + 1) * 86_400_000);

  it("zeigt Einträge nicht mehr an, die älter als die Aufbewahrungsfrist sind", async () => {
    await umgebung.db
      .insert(abweisung)
      .values({ id: "uralt", email: "uralt@example.at", weg: null, zeitpunkt: zuAlt() });

    expect(await holeAbweisungen(umgebung.db)).toEqual([]);
  });

  // Nicht-Anzeigen genügt nicht: Es geht um E-Mail-Adressen von Personen, die
  // keine Nutzer sind. Sie müssen wirklich verschwinden, nicht nur ausgeblendet
  // werden.
  it("löscht abgelaufene Einträge wirklich aus der Datenbank", async () => {
    await umgebung.db
      .insert(abweisung)
      .values({ id: "uralt", email: "uralt@example.at", weg: null, zeitpunkt: zuAlt() });

    await holeAbweisungen(umgebung.db);

    const rest = await umgebung.db.select().from(abweisung);
    expect(rest).toEqual([]);
  });

  it("lässt Einträge innerhalb der Frist unangetastet", async () => {
    await umgebung.db.insert(abweisung).values({
      id: "frisch",
      email: "frisch@example.at",
      weg: null,
      zeitpunkt: new Date(Date.now() - (AUFBEWAHRUNG_TAGE - 1) * 86_400_000),
    });

    await holeAbweisungen(umgebung.db);

    expect((await umgebung.db.select().from(abweisung)).length).toBe(1);
  });
});

describe("benenneWeg", () => {
  it("übersetzt den Google-Rückweg in Klartext", () => {
    expect(benenneWeg("/callback/google")).toBe("Google");
  });

  it("erkennt den Passkey-Weg", () => {
    expect(benenneWeg("/passkey/verify-authentication")).toBe("Passkey");
  });

  it("gibt einen unbekannten Weg unverändert zurück, statt ihn zu verschlucken", () => {
    // Ein neuer Anmeldeweg soll sichtbar sein, auch wenn niemand ihn übersetzt
    // hat — sonst verschwindet genau der Fall, der erklärungsbedürftig ist.
    expect(benenneWeg("/irgendwas/neues")).toBe("/irgendwas/neues");
  });

  it("sagt es, wenn gar kein Weg bekannt ist", () => {
    expect(benenneWeg(null)).toBe("Unbekannt");
  });
});

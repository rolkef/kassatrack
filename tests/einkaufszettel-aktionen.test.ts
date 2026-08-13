import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { holeListe, holeListen } from "@/lib/einkaufszettel";
import type { ZugriffsDb } from "@/lib/zugriff";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

/*
 * Prüft die beiden Server-Aktionen **direkt** gegen eine echte Datenbank, nach
 * demselben Muster wie `tests/erfassen-aktionen.test.ts`: Server-Aktionen sind
 * eigene Endpunkte und über ihre Kennung auch ohne die zugehörige Seite
 * aufrufbar. Ein Test, der nur das Formular betrachtet, sagt nichts darüber,
 * was beim Aufruf an der Oberfläche vorbei passiert.
 *
 * Jede Abweisung zählt zusätzlich die Zeilen nach. Eine Fehlermeldung allein
 * beweist nicht, dass nichts angelegt wurde — und ein abgewiesener Aufruf, der
 * trotzdem eine namenlose Liste hinterlässt, wäre genau der Fehler, den man
 * erst Wochen später in der Übersicht sieht.
 */

/*
 * Datenbank und Schema entstehen auf oberster Ebene, nicht in `beforeAll`:
 * `aktionen.ts` wird weiter unten per `await import` geladen und bindet `db`
 * beim Importieren, und dieser Import läuft **vor** jedem `beforeAll`.
 */
const umgebung: TestDatenbank = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });

afterAll(async () => {
  await umgebung.stop();
});

/** Ob `requireUser` die angemeldete Person liefert oder wie ohne Sitzung wirft. */
let angemeldet = true;

const echtesCache = await import("next/cache");
await mock.module("next/cache", () => ({
  ...echtesCache,
  revalidatePath: () => {},
}));

await mock.module("@/db", () => ({ db: umgebung.db as ZugriffsDb }));

/*
 * Der Anhang `?echt` ist kein Zierrat, sondern die einzige Fassung, die
 * unabhängig von der Dateireihenfolge stimmt: Andere Testdateien ersetzen
 * `@/lib/sitzung` ebenfalls für den ganzen Lauf, und ein gewöhnliches
 * `await import("@/lib/sitzung")` bekäme je nach Reihenfolge deren Attrappe und
 * streute sie hier wieder hinein. Ausführliche Begründung in
 * `tests/erfassen-aktionen.test.ts`.
 */
const echterBezeichner = "@/lib/sitzung?echt";
const echteSitzung = (await import(echterBezeichner)) as typeof import("@/lib/sitzung");
await mock.module("@/lib/sitzung", () => ({
  ...echteSitzung,
  requireUser: async () => {
    // Ohne Sitzung ruft das echte `requireUser` `redirect("/anmelden")` auf,
    // und `redirect` wirft. Die Attrappe bildet genau das nach.
    if (!angemeldet) throw new Error("NEXT_REDIRECT;/anmelden");
    return { id: "u1", email: "wer@example.at", name: "Wer" };
  },
}));

const { erzeugeListeAktion, loescheListeAktion } = await import("@/app/einkaufszettel/aktionen");

function formular(name: string): FormData {
  const daten = new FormData();
  daten.set("name", name);
  return daten;
}

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table shopping_list cascade`);
  angemeldet = true;
});

describe("erzeugeListeAktion", () => {
  it("legt eine Liste an", async () => {
    const ergebnis = await erzeugeListeAktion(undefined, formular("Wocheneinkauf"));

    expect(ergebnis.art).toBe("erfolg");
    if (ergebnis.art !== "erfolg") return;
    expect(await holeListe(umgebung.db, ergebnis.id)).not.toBeNull();
  });

  it("schneidet Leerraum am Namen ab", async () => {
    const ergebnis = await erzeugeListeAktion(undefined, formular("  Wocheneinkauf  "));

    expect(ergebnis.art).toBe("erfolg");
    if (ergebnis.art !== "erfolg") return;
    expect((await holeListe(umgebung.db, ergebnis.id))?.name).toBe("Wocheneinkauf");
  });

  it("weist einen leeren Namen ab, ohne etwas anzulegen", async () => {
    const ergebnis = await erzeugeListeAktion(undefined, formular("   "));

    expect(ergebnis.art).toBe("fehler");
    expect(await holeListen(umgebung.db)).toHaveLength(0);
  });

  /*
   * Nicht „irgendein Fehler", sondern ein Satz, der sagt, was zu tun ist. Ohne
   * diese Behauptung dürfte die Meldung auch leer sein — und ein leerer
   * `role="alert"` sieht aus wie ein Formular, das grundlos nichts tut.
   */
  it("nennt beim leeren Namen, was fehlt", async () => {
    const ergebnis = await erzeugeListeAktion(undefined, formular(""));

    expect(ergebnis.art).toBe("fehler");
    if (ergebnis.art !== "fehler") return;
    expect(ergebnis.meldung).toContain("Namen");
  });

  it("verlangt eine Anmeldung, ohne etwas anzulegen", async () => {
    angemeldet = false;

    const fehler = await faengtFehler(() => erzeugeListeAktion(undefined, formular("Heimlich")));

    expect(fehler).toBeDefined();
    expect(await holeListen(umgebung.db)).toHaveLength(0);
  });
});

describe("loescheListeAktion", () => {
  it("entfernt die Liste", async () => {
    const angelegt = await erzeugeListeAktion(undefined, formular("Zum Löschen"));
    if (angelegt.art !== "erfolg") throw new Error("Vorbereitung fehlgeschlagen");

    await loescheListeAktion(angelegt.id);

    expect(await holeListe(umgebung.db, angelegt.id)).toBeNull();
  });

  /*
   * Die Liste muss den Versuch **überleben**. Ohne diese zweite Behauptung
   * bliebe der Test auch dann grün, wenn `requireUser` erst nach dem Löschen
   * käme — dann wäre die Liste weg und der Fehler bloß Beiwerk.
   */
  it("verlangt eine Anmeldung und lässt die Liste stehen", async () => {
    const angelegt = await erzeugeListeAktion(undefined, formular("Bleibt"));
    if (angelegt.art !== "erfolg") throw new Error("Vorbereitung fehlgeschlagen");

    angemeldet = false;
    const fehler = await faengtFehler(() => loescheListeAktion(angelegt.id));

    expect(fehler).toBeDefined();
    angemeldet = true;
    expect(await holeListe(umgebung.db, angelegt.id)).not.toBeNull();
  });
});

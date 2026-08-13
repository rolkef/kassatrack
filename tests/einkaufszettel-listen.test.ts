import { afterAll, describe, expect, it } from "bun:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  erzeugeListe,
  holeListe,
  holeListen,
  loescheListe,
} from "@/lib/einkaufszettel";
import { starteTestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

const umgebung = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });

afterAll(() => umgebung.stop());

describe("erzeugeListe / holeListen / holeListe", () => {
  it("legt eine Liste an und findet sie wieder", async () => {
    const liste = await erzeugeListe(umgebung.db, "Wocheneinkauf");
    expect(liste.name).toBe("Wocheneinkauf");

    const gefunden = await holeListe(umgebung.db, liste.id);
    expect(gefunden).toEqual(liste);
  });

  it("liefert null für eine unbekannte Liste", async () => {
    expect(await holeListe(umgebung.db, "unbekannt")).toBeNull();
  });

  it("weist einen leeren Namen ab", async () => {
    const fehler = await faengtFehler(() => erzeugeListe(umgebung.db, "   "));
    expect(fehler).toBeDefined();
  });

  it("liefert alle Listen, neueste zuerst", async () => {
    const erste = await erzeugeListe(umgebung.db, "Erste Liste");
    const zweite = await erzeugeListe(umgebung.db, "Zweite Liste");

    const listen = await holeListen(umgebung.db);
    const indexErste = listen.findIndex((l) => l.id === erste.id);
    const indexZweite = listen.findIndex((l) => l.id === zweite.id);
    expect(indexZweite).toBeLessThan(indexErste);
  });
});

describe("loescheListe", () => {
  it("entfernt die Liste, ein zweiter Aufruf wirft nicht", async () => {
    const liste = await erzeugeListe(umgebung.db, "Zum Löschen");
    await loescheListe(umgebung.db, liste.id);
    expect(await holeListe(umgebung.db, liste.id)).toBeNull();

    await loescheListe(umgebung.db, liste.id);
  });
});

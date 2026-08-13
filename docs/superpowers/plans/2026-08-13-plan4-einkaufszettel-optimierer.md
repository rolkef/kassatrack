# Plan 4: Einkaufszettel und Optimierer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beliebig viele Einkaufszettel mit Artikeln aus dem Katalog oder als
Freitext; ein Optimierer zeigt „Bester Einzelmarkt" und „Optimale
Aufteilung" nebeneinander mit Ersparnis in Euro; ein Artikel abzuhaken
speichert atomar einen Preis und markiert den Artikel als erledigt.

**Architecture:** Zwei neue Tabellen (`shopping_list`,
`shopping_list_item`), eine reine Aggregationsschicht über die bestehende
Plan-2-Preis-Engine (`holePreisMatrix`, `bestesAngebot` — keine neue
Preislogik), und eine minimale Erweiterung der bestehenden `erfasse`-Aktion
um einen optionalen Bezug auf einen Zettel-Eintrag, damit Preis-Speichern
und Abhaken in derselben Datenbank-Transaktion geschehen.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19,
TypeScript 7, Drizzle 0.45, Bun 1.3 — unverändert gegenüber Plan 2/3.

## Global Constraints

- **Bun only.** Niemals `npm`/`yarn`/`pnpm`/`npx` — `bunx` für Werkzeuge.
- **Strenge Nonce-CSP, kein `unsafe-inline`.** Kein `style={{...}}`, kein
  `<style>`-Block, kein `dangerouslySetInnerHTML`, kein Inline-Handler in
  serverseitigem Markup.
- **Tailwind v4, CSS-first.** Keine `tailwind.config.*`-Datei irgendwo im
  Repository.
- **Komponententests:** `import "./dom"` als erste Zeile, `screen` von dort
  — nicht von `@testing-library/*`.
- **Nie `.resolves`/`.rejects` auf einem datenbanknahen Versprechen** —
  `faengtFehler()` aus `tests/helfer/fehler.ts`.
- **`mock.module` gilt in Bun für den ganzen Testlauf.** Server Actions
  werden Komponenten als Props injiziert (das in Plan 2/3 etablierte
  Muster), nicht per `mock.module` ersetzt.
- Deutsch, österreichisches Vokabular, deutsche Routensegmente.
- Echtes Postgres in Tests, keine Mocks, für alles Datenbanknahe.
- **Gestaltungspflicht für die Tasks 6, 7 und 8** (Listenübersicht,
  Listendetail, Optimierer-Anzeige, Abhak-Fluss): vor der Umsetzung die
  Skills `impeccable`, `ui-ux-pro-max` und `frontend-design` aufrufen und
  deren Ergebnis umsetzen. Bestehendes Gestaltungssystem erben
  (`src/app/globals.css`, `Schaltflaeche`, Marke `#005860`), nicht neu
  herleiten.
- **Kein Offline-Modus.** Der Einkaufszettel verhält sich wie `/erfassen`
  und `/produkte` — braucht Netz, kein Sonderfall im Service Worker.
- Ein Commit je Task, deutsche Nachricht, `feat:`/`fix:`-Präfix nach den
  Commit-Konventionen der bisherigen Pläne.

---

## Dateiübersicht

| Datei | Rolle |
|---|---|
| `src/db/schema/einkaufszettel.ts` | **Neu.** `shoppingList`, `shoppingListItem`. |
| `src/lib/einkaufszettel.ts` | **Neu.** Listen- und Artikel-CRUD, `hakeItemAb`. |
| `src/lib/optimierer.ts` | **Neu.** `berechneOptimierung(db, listId)` — Aggregation über Plan 2. |
| `src/app/erfassen/aktionen.ts` | **Geändert.** `erfasse` bekommt optionale `zettelItemId`/`zettelListId`-Felder. |
| `src/app/einkaufszettel/page.tsx` | **Neu.** Listenübersicht. |
| `src/app/einkaufszettel/aktionen.ts` | **Neu.** Server Actions: Liste anlegen/löschen. |
| `src/app/einkaufszettel/listenformular.tsx` | **Neu.** Formular „Neue Liste". |
| `src/app/einkaufszettel/[id]/page.tsx` | **Neu.** Listendetail. |
| `src/app/einkaufszettel/[id]/aktionen.ts` | **Neu.** Server Actions: Artikel hinzufügen/entfernen/Stückzahl. |
| `src/app/einkaufszettel/[id]/zettel-detail.tsx` | **Neu.** Artikelverwaltung, Client-Komponente. |
| `src/app/einkaufszettel/[id]/optimierer-anzeige.tsx` | **Neu.** Zweischichtige Optimierer-Ansicht. |
| `src/app/einkaufszettel/[id]/abhak-formular.tsx` | **Neu.** Mini-Preiserfassung beim Abhaken. |
| `src/components/app-navigation.tsx` | **Geändert.** Viertes Ziel „Zettel". |
| `docs/offene-punkte.md` | **Geändert.** Neuer Abschnitt „Aus Plan 4" am Ende (Task 9). |

---

### Task 1: Schema

**Files:**
- Create: `src/db/schema/einkaufszettel.ts`
- Modify: `src/db/schema/index.ts` (falls vorhanden — sonst den Export in
  die Datei ergänzen, die `drizzle-kit` als Schema-Einstieg nutzt; prüfen,
  wie `katalog.ts`/`preise.ts` heute eingebunden sind, bevor eine neue Datei
  angenommen wird)
- Migration: per `bunx drizzle-kit generate` erzeugt

**Interfaces:**
- Produces: `shoppingList` (Drizzle-Tabelle), `shoppingListItem`
  (Drizzle-Tabelle)

- [ ] **Step 1: Schema schreiben**

```ts
// src/db/schema/einkaufszettel.ts
import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { product } from "@/db/schema/katalog";

export const shoppingList = pgTable(
  "shopping_list",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabelle) => [check("shopping_list_name_nicht_leer", sql`btrim(${tabelle.name}) <> ''`)],
);

/**
 * Ein Eintrag trägt entweder `product_id` oder `freitext`, nie beides, nie
 * keines. Ohne diese Bedingung könnte ein Eintrag ohne jeden Bezug entstehen
 * — unsichtbar für den Optimierer und für die Person, die ihn angelegt hat,
 * gleichermaßen nichtssagend.
 */
export const shoppingListItem = pgTable(
  "shopping_list_item",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => shoppingList.id, { onDelete: "cascade" }),
    /*
     * `set null`, nicht die Vorgabe (Verhindern): Produktlöschung existiert
     * heute nirgends in der App, aber sollte sie einmal entstehen, darf ein
     * gelöschtes Produkt einen Zettel-Eintrag nicht blockieren oder ihn
     * mitreißen — er soll als Rest bestehen bleiben. Das Nachtragen des
     * ursprünglichen Namens in `freitext` beim Löschen ist bewusst nicht
     * Teil dieses Plans: Es gibt noch keine Lösch-Stelle, an die sich das
     * hängen ließe (siehe Design-Spec, Abschnitt „Bewusst nicht drin").
     */
    productId: text("product_id").references(() => product.id, { onDelete: "set null" }),
    freitext: text("freitext"),
    stueckzahl: integer("stueckzahl").notNull().default(1),
    abgehaktAm: timestamp("abgehakt_am", { withTimezone: true }),
  },
  (tabelle) => [
    check(
      "shopping_list_item_genau_eine_quelle",
      sql`(${tabelle.productId} is not null) <> (${tabelle.freitext} is not null)`,
    ),
    check("shopping_list_item_stueckzahl_positiv", sql`${tabelle.stueckzahl} > 0`),
  ],
);
```

- [ ] **Step 2: Migration erzeugen und anwenden**

Run: `bunx drizzle-kit generate`
Erwartet: eine neue Datei unter `drizzle/`, z. B. `0006_<name>.sql`, mit
`create table "shopping_list"` und `create table "shopping_list_item"`.

Run: `docker compose up -d postgres-test` (falls nicht bereits gestartet),
dann einmal `bun test tests/db.test.ts` — dieser Test migriert die
Test-Datenbank vollständig und schlägt fehl, wenn die neue Migration einen
Fehler hat.

- [ ] **Step 3: `bunx tsc --noEmit` ausführen**

Expected: keine Fehler

- [ ] **Step 4: Commit**

```bash
git add src/db/schema/einkaufszettel.ts drizzle/
git commit -m "feat: Schema für Einkaufszettel und Zettel-Einträge"
```

---

### Task 2: Listen-CRUD

**Files:**
- Create: `src/lib/einkaufszettel.ts`
- Test: `tests/einkaufszettel-listen.test.ts`

**Interfaces:**
- Consumes: `DbOderTransaktion` aus `@/lib/zugriff`
- Produces:
  - `type Liste = { id: string; name: string; erstelltAm: Date }`
  - `erzeugeListe(db, name: string): Promise<Liste>`
  - `holeListen(db): Promise<Liste[]>` — neueste zuerst
  - `holeListe(db, id: string): Promise<Liste | null>`
  - `loescheListe(db, id: string): Promise<void>`

- [ ] **Step 1: Fehlschlagenden Test schreiben**

```ts
// tests/einkaufszettel-listen.test.ts
import { afterAll, describe, expect, it } from "bun:test";
import {
  erzeugeListe,
  holeListe,
  holeListen,
  loescheListe,
} from "@/lib/einkaufszettel";
import { starteTestDatenbank } from "./helfer/db";

const umgebung = await starteTestDatenbank();
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
    await expect(erzeugeListe(umgebung.db, "   ")).rejects.toThrow();
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
```

Hinweis zu `.rejects` im dritten Test: `erzeugeListe` löst hier direkt gegen
eine echte Testdatenbank auf — nach diesem Projekts Regel ist `.rejects` auf
einem datenbanknahen Versprechen zu vermeiden. Ersetze das durch
`faengtFehler(() => erzeugeListe(umgebung.db, "   "))` aus
`tests/helfer/fehler.ts`, sobald du diese Datei schreibst — der Codeblock
oben ist absichtlich noch mit `.rejects` notiert, weil diese eine Zeile beim
Entwurf leichter zu lesen war; korrigiere sie beim Implementieren.

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `bun test tests/einkaufszettel-listen.test.ts`
Expected: FAIL — Modul `@/lib/einkaufszettel` existiert nicht

- [ ] **Step 3: `src/lib/einkaufszettel.ts` implementieren (Listen-Teil)**

```ts
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { shoppingList } from "@/db/schema/einkaufszettel";
import type { DbOderTransaktion } from "@/lib/zugriff";

export type Liste = { id: string; name: string; erstelltAm: Date };

export async function erzeugeListe(db: DbOderTransaktion, name: string): Promise<Liste> {
  const [zeile] = await db
    .insert(shoppingList)
    .values({ id: randomUUID(), name: name.trim() })
    .returning({ id: shoppingList.id, name: shoppingList.name, erstelltAm: shoppingList.erstelltAm });

  return zeile as Liste;
}

export async function holeListen(db: DbOderTransaktion): Promise<Liste[]> {
  return db
    .select({ id: shoppingList.id, name: shoppingList.name, erstelltAm: shoppingList.erstelltAm })
    .from(shoppingList)
    .orderBy(desc(shoppingList.erstelltAm)) as Promise<Liste[]>;
}

export async function holeListe(db: DbOderTransaktion, id: string): Promise<Liste | null> {
  const [zeile] = await db
    .select({ id: shoppingList.id, name: shoppingList.name, erstelltAm: shoppingList.erstelltAm })
    .from(shoppingList)
    .where(eq(shoppingList.id, id))
    .limit(1);

  return (zeile as Liste | undefined) ?? null;
}

export async function loescheListe(db: DbOderTransaktion, id: string): Promise<void> {
  await db.delete(shoppingList).where(eq(shoppingList.id, id));
}
```

`erzeugeListe` wirft über die Datenbank-Bedingung
`shopping_list_name_nicht_leer` (`btrim(name) <> ''`), sobald der Name nach
dem Trimmen leer ist — kein zusätzlicher Code-Zweig nötig, die Bedingung aus
Task 1 trägt das bereits.

- [ ] **Step 4: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/einkaufszettel-listen.test.ts`
Expected: PASS — 5 Tests

- [ ] **Step 5: `bunx tsc --noEmit` ausführen**

Expected: keine Fehler

- [ ] **Step 6: Commit**

```bash
git add src/lib/einkaufszettel.ts tests/einkaufszettel-listen.test.ts
git commit -m "feat: Listen-CRUD für Einkaufszettel"
```

---

### Task 3: Artikel-CRUD

**Files:**
- Modify: `src/lib/einkaufszettel.ts` (Artikel-Teil ergänzen)
- Test: `tests/einkaufszettel-artikel.test.ts`

**Interfaces:**
- Consumes: `Liste`, `erzeugeListe` (Task 2), `legeProduktAn`/`findeProdukt`/`Produkt` aus `@/lib/katalog`
- Produces:
  - `type ZettelArtikel = { id: string; listId: string; produkt: Produkt | null; freitext: string | null; stueckzahl: number; abgehaktAm: Date | null }`
  - `fuegeKatalogArtikelHinzu(db, listId: string, produktId: string, stueckzahl?: number): Promise<ZettelArtikel>`
  - `fuegeFreitextArtikelHinzu(db, listId: string, freitext: string, stueckzahl?: number): Promise<ZettelArtikel>`
  - `holeArtikel(db, listId: string): Promise<ZettelArtikel[]>`
  - `aendereStueckzahl(db, itemId: string, stueckzahl: number): Promise<void>`
  - `entferneArtikel(db, itemId: string): Promise<void>`
  - `hakeItemAb(db, itemId: string): Promise<void>`

- [ ] **Step 1: Fehlschlagenden Test schreiben**

```ts
// tests/einkaufszettel-artikel.test.ts
import { afterAll, describe, expect, it } from "bun:test";
import { legeProduktAn } from "@/lib/katalog";
import {
  aendereStueckzahl,
  entferneArtikel,
  erzeugeListe,
  fuegeFreitextArtikelHinzu,
  fuegeKatalogArtikelHinzu,
  hakeItemAb,
  holeArtikel,
} from "@/lib/einkaufszettel";
import { faengtFehler } from "./helfer/fehler";
import { starteTestDatenbank } from "./helfer/db";

const umgebung = await starteTestDatenbank();
afterAll(() => umgebung.stop());

describe("fuegeKatalogArtikelHinzu", () => {
  it("verknüpft ein Katalogprodukt, Stückzahl 1 als Vorgabe", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Butter",
      marke: "Berglandmilch",
      menge: 250,
      einheit: "G",
    });

    const artikel = await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, produkt.id);

    expect(artikel.produkt).toEqual(produkt);
    expect(artikel.freitext).toBeNull();
    expect(artikel.stueckzahl).toBe(1);
    expect(artikel.abgehaktAm).toBeNull();
  });

  it("übernimmt eine übergebene Stückzahl", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Milch",
      marke: null,
      menge: 1000,
      einheit: "ML",
    });

    const artikel = await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, produkt.id, 3);
    expect(artikel.stueckzahl).toBe(3);
  });
});

describe("fuegeFreitextArtikelHinzu", () => {
  it("legt einen Eintrag ohne Produktbezug an", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const artikel = await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Salz");

    expect(artikel.produkt).toBeNull();
    expect(artikel.freitext).toBe("Salz");
  });
});

describe("holeArtikel", () => {
  it("liefert alle Artikel einer Liste, nicht die einer anderen", async () => {
    const listeA = await erzeugeListe(umgebung.db, "A");
    const listeB = await erzeugeListe(umgebung.db, "B");
    await fuegeFreitextArtikelHinzu(umgebung.db, listeA.id, "Nur in A");
    await fuegeFreitextArtikelHinzu(umgebung.db, listeB.id, "Nur in B");

    const artikelA = await holeArtikel(umgebung.db, listeA.id);
    expect(artikelA).toHaveLength(1);
    expect(artikelA[0]?.freitext).toBe("Nur in A");
  });
});

describe("aendereStueckzahl / entferneArtikel / hakeItemAb", () => {
  it("ändert die Stückzahl", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const artikel = await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Zwiebeln");

    await aendereStueckzahl(umgebung.db, artikel.id, 5);

    const [aktualisiert] = await holeArtikel(umgebung.db, liste.id);
    expect(aktualisiert?.stueckzahl).toBe(5);
  });

  it("weist eine Stückzahl von null oder darunter ab", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const artikel = await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Zwiebeln");

    await faengtFehler(() => aendereStueckzahl(umgebung.db, artikel.id, 0));
  });

  it("entfernt einen Artikel", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const artikel = await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Zwiebeln");

    await entferneArtikel(umgebung.db, artikel.id);

    expect(await holeArtikel(umgebung.db, liste.id)).toHaveLength(0);
  });

  it("hakt einen Artikel ab", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const artikel = await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Zwiebeln");

    await hakeItemAb(umgebung.db, artikel.id);

    const [aktualisiert] = await holeArtikel(umgebung.db, liste.id);
    expect(aktualisiert?.abgehaktAm).not.toBeNull();
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `bun test tests/einkaufszettel-artikel.test.ts`
Expected: FAIL — die neuen Exporte existieren nicht

- [ ] **Step 3: Artikel-Funktionen ergänzen**

In `src/lib/einkaufszettel.ts` ergänzen:

```ts
import type { SQL } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { shoppingListItem } from "@/db/schema/einkaufszettel";
import { holeProdukt, type Produkt } from "@/lib/katalog";

export type ZettelArtikel = {
  id: string;
  listId: string;
  produkt: Produkt | null;
  freitext: string | null;
  stueckzahl: number;
  abgehaktAm: Date | null;
};

/**
 * `where: SQL` statt `ReturnType<typeof eq>`: `eq` ist generisch, und ihr
 * Rückgabetyp über `ReturnType` zu greifen instanziiert das Generikum an
 * dieser einen Stelle — an den drei Aufrufstellen unten mit
 * unterschiedlichen Spalten (`id`, `listId`) kann das je nach TypeScript-
 * Fassung nicht mehr passen. `SQL` (aus `drizzle-orm`, ungetypt auf den
 * konkreten Ausdruck) ist der stabile Weg, ein zusammengesetztes
 * `where`-Fragment als Parameter zu reichen.
 */
async function ladeArtikel(db: DbOderTransaktion, where: SQL): Promise<ZettelArtikel[]> {
  const zeilen = await db
    .select({
      id: shoppingListItem.id,
      listId: shoppingListItem.listId,
      productId: shoppingListItem.productId,
      freitext: shoppingListItem.freitext,
      stueckzahl: shoppingListItem.stueckzahl,
      abgehaktAm: shoppingListItem.abgehaktAm,
    })
    .from(shoppingListItem)
    .where(where);

  const ergebnis: ZettelArtikel[] = [];
  for (const zeile of zeilen) {
    const produkt = zeile.productId ? await holeProdukt(db, zeile.productId) : null;
    ergebnis.push({
      id: zeile.id,
      listId: zeile.listId,
      produkt,
      freitext: zeile.freitext,
      stueckzahl: zeile.stueckzahl,
      abgehaktAm: zeile.abgehaktAm,
    });
  }
  return ergebnis;
}

export async function fuegeKatalogArtikelHinzu(
  db: DbOderTransaktion,
  listId: string,
  produktId: string,
  stueckzahl = 1,
): Promise<ZettelArtikel> {
  const [zeile] = await db
    .insert(shoppingListItem)
    .values({ id: randomUUID(), listId, productId: produktId, stueckzahl })
    .returning({ id: shoppingListItem.id });

  const [artikel] = await ladeArtikel(db, eq(shoppingListItem.id, zeile!.id));
  return artikel!;
}

export async function fuegeFreitextArtikelHinzu(
  db: DbOderTransaktion,
  listId: string,
  freitext: string,
  stueckzahl = 1,
): Promise<ZettelArtikel> {
  const [zeile] = await db
    .insert(shoppingListItem)
    .values({ id: randomUUID(), listId, freitext: freitext.trim(), stueckzahl })
    .returning({ id: shoppingListItem.id });

  const [artikel] = await ladeArtikel(db, eq(shoppingListItem.id, zeile!.id));
  return artikel!;
}

export async function holeArtikel(db: DbOderTransaktion, listId: string): Promise<ZettelArtikel[]> {
  return ladeArtikel(db, eq(shoppingListItem.listId, listId));
}

export async function aendereStueckzahl(
  db: DbOderTransaktion,
  itemId: string,
  stueckzahl: number,
): Promise<void> {
  await db.update(shoppingListItem).set({ stueckzahl }).where(eq(shoppingListItem.id, itemId));
}

export async function entferneArtikel(db: DbOderTransaktion, itemId: string): Promise<void> {
  await db.delete(shoppingListItem).where(eq(shoppingListItem.id, itemId));
}

export async function hakeItemAb(db: DbOderTransaktion, itemId: string): Promise<void> {
  await db
    .update(shoppingListItem)
    .set({ abgehaktAm: new Date() })
    .where(eq(shoppingListItem.id, itemId));
}
```

`aendereStueckzahl` mit `stueckzahl <= 0` wirft über die
Datenbank-Bedingung `shopping_list_item_stueckzahl_positiv` aus Task 1 —
derselbe Mechanismus wie bei `erzeugeListe`s leerem Namen.

**Wichtig für Task 5:** `hakeItemAb` wird dort **innerhalb** derselben
Transaktion aufgerufen, die auch die Preisbeobachtung schreibt — übergib
dafür die Transaktion (`tx`), nicht `db`, wie es der Typ `DbOderTransaktion`
ohnehin zulässt.

- [ ] **Step 4: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/einkaufszettel-artikel.test.ts tests/einkaufszettel-listen.test.ts`
Expected: PASS — 12 Tests insgesamt

- [ ] **Step 5: `bunx tsc --noEmit` ausführen**

Expected: keine Fehler

- [ ] **Step 6: Commit**

```bash
git add src/lib/einkaufszettel.ts tests/einkaufszettel-artikel.test.ts
git commit -m "feat: Artikel-CRUD und Abhaken für Einkaufszettel"
```

---

### Task 4: Optimierer-Berechnung

**Files:**
- Create: `src/lib/optimierer.ts`
- Test: `tests/optimierer.test.ts`

**Interfaces:**
- Consumes: `holeArtikel`, `ZettelArtikel` (Task 3), `holePreisMatrix`, `bestesAngebot`, `PreisZeile` aus `@/lib/preise`, `holeKetten`, `Kette` aus `@/lib/katalog`
- Produces:
  - `type KettenSumme = { kette: Kette; summe: number; vollstaendig: boolean }`
  - `type AufteilungsZeile = { kette: Kette; artikel: { artikel: ZettelArtikel; preis: number }[]; summe: number }`
  - `type Optimierung = { aufteilung: AufteilungsZeile[]; aufteilungSumme: number; einzelmaerkte: KettenSumme[]; guenstigsterEinzelmarkt: KettenSumme | null; ersparnis: number | null }`
  - `berechneOptimierung(db, listId: string): Promise<Optimierung>`

- [ ] **Step 1: Fehlschlagenden Test schreiben**

```ts
// tests/optimierer.test.ts
import { afterAll, describe, expect, it } from "bun:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { legeKettenAn, legeProduktAn, holeKetten, sichereKettenProdukt } from "@/lib/katalog";
import { erzeugeListe, fuegeFreitextArtikelHinzu, fuegeKatalogArtikelHinzu } from "@/lib/einkaufszettel";
import { berechneOptimierung } from "@/lib/optimierer";
import { schreibeBeobachtung } from "@/lib/preise";
import { starteTestDatenbank } from "./helfer/db";

const umgebung = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });
await legeKettenAn(umgebung.db);
afterAll(() => umgebung.stop());

async function beobachte(produktId: string, kettenKuerzel: string, preis: number) {
  const ketten = await holeKetten(umgebung.db);
  const kette = ketten.find((k) => k.kuerzel === kettenKuerzel)!;
  const storeProductId = await sichereKettenProdukt(umgebung.db, { chainId: kette.id, productId: produktId });
  await schreibeBeobachtung(umgebung.db, {
    storeProductId,
    chainId: kette.id,
    productId,
    quelle: "MANUAL",
    preisart: "NORMAL",
    einzelpreis: preis,
    menge: 1,
    zeilensumme: preis,
    grundpreis: preis,
    aktionGueltigBis: null,
  });
}

describe("berechneOptimierung", () => {
  it("findet die optimale Aufteilung über zwei Ketten", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const butter = await legeProduktAn(umgebung.db, { name: "Butter", marke: null, menge: 250, einheit: "G" });
    const milch = await legeProduktAn(umgebung.db, { name: "Milch", marke: null, menge: 1000, einheit: "ML" });

    await beobachte(butter.id, "spar", 2.49);
    await beobachte(butter.id, "hofer", 2.99);
    await beobachte(milch.id, "spar", 1.5);
    await beobachte(milch.id, "hofer", 1.19);

    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, butter.id);
    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, milch.id);

    const optimierung = await berechneOptimierung(umgebung.db, liste.id);

    expect(optimierung.aufteilungSumme).toBeCloseTo(2.49 + 1.19, 2);
    const sparZeile = optimierung.aufteilung.find((z) => z.kette.kuerzel === "spar");
    const hoferZeile = optimierung.aufteilung.find((z) => z.kette.kuerzel === "hofer");
    expect(sparZeile?.artikel).toHaveLength(1);
    expect(hoferZeile?.artikel).toHaveLength(1);
  });

  it("markiert eine Kette mit fehlendem Preis als unvollständig", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const butter = await legeProduktAn(umgebung.db, { name: "Butter Zwei", marke: null, menge: 250, einheit: "G" });
    const milch = await legeProduktAn(umgebung.db, { name: "Milch Zwei", marke: null, menge: 1000, einheit: "ML" });

    await beobachte(butter.id, "spar", 2.49);
    await beobachte(milch.id, "spar", 1.5);
    // Hofer kennt nur Butter, nicht die Milch.
    await beobachte(butter.id, "hofer", 2.99);

    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, butter.id);
    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, milch.id);

    const optimierung = await berechneOptimierung(umgebung.db, liste.id);

    const spar = optimierung.einzelmaerkte.find((k) => k.kette.kuerzel === "spar");
    const hofer = optimierung.einzelmaerkte.find((k) => k.kette.kuerzel === "hofer");
    expect(spar?.vollstaendig).toBe(true);
    expect(hofer?.vollstaendig).toBe(false);
    expect(optimierung.guenstigsterEinzelmarkt?.kette.kuerzel).toBe("spar");
  });

  it("berechnet die Ersparnis als Differenz zwischen bestem Einzelmarkt und Aufteilung", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const butter = await legeProduktAn(umgebung.db, { name: "Butter Drei", marke: null, menge: 250, einheit: "G" });
    const milch = await legeProduktAn(umgebung.db, { name: "Milch Drei", marke: null, menge: 1000, einheit: "ML" });

    await beobachte(butter.id, "spar", 2.49);
    await beobachte(milch.id, "spar", 1.5);
    await beobachte(butter.id, "hofer", 2.99);
    await beobachte(milch.id, "hofer", 1.19);

    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, butter.id);
    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, milch.id);

    const optimierung = await berechneOptimierung(umgebung.db, liste.id);

    // Bester Einzelmarkt: Spar (2.49+1.50=3.99) vs. Hofer (2.99+1.19=4.18) -> Spar günstiger.
    // Aufteilung: 2.49 (Spar) + 1.19 (Hofer) = 3.68.
    expect(optimierung.guenstigsterEinzelmarkt?.summe).toBeCloseTo(3.99, 2);
    expect(optimierung.aufteilungSumme).toBeCloseTo(3.68, 2);
    expect(optimierung.ersparnis).toBeCloseTo(3.99 - 3.68, 2);
  });

  it("bezieht Stückzahl in die Summe ein", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const butter = await legeProduktAn(umgebung.db, { name: "Butter Vier", marke: null, menge: 250, einheit: "G" });
    await beobachte(butter.id, "spar", 2.0);
    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, butter.id, 3);

    const optimierung = await berechneOptimierung(umgebung.db, liste.id);

    expect(optimierung.aufteilungSumme).toBeCloseTo(6.0, 2);
  });

  it("lässt Freitext-Artikel aus beiden Rechnungen heraus", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const butter = await legeProduktAn(umgebung.db, { name: "Butter Fünf", marke: null, menge: 250, einheit: "G" });
    await beobachte(butter.id, "spar", 2.0);
    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, butter.id);
    await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Salz");

    const optimierung = await berechneOptimierung(umgebung.db, liste.id);

    expect(optimierung.aufteilungSumme).toBeCloseTo(2.0, 2);
    const alleArtikelInAufteilung = optimierung.aufteilung.flatMap((z) => z.artikel);
    expect(alleArtikelInAufteilung).toHaveLength(1);
  });

  it("liefert keine Ersparnis, wenn keine Kette vollständig ist", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const butter = await legeProduktAn(umgebung.db, { name: "Butter Sechs", marke: null, menge: 250, einheit: "G" });
    const milch = await legeProduktAn(umgebung.db, { name: "Milch Sechs", marke: null, menge: 1000, einheit: "ML" });
    await beobachte(butter.id, "spar", 2.0);
    await beobachte(milch.id, "hofer", 1.0);
    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, butter.id);
    await fuegeKatalogArtikelHinzu(umgebung.db, liste.id, milch.id);

    const optimierung = await berechneOptimierung(umgebung.db, liste.id);

    expect(optimierung.guenstigsterEinzelmarkt).toBeNull();
    expect(optimierung.ersparnis).toBeNull();
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `bun test tests/optimierer.test.ts`
Expected: FAIL — Modul `@/lib/optimierer` existiert nicht

- [ ] **Step 3: `src/lib/optimierer.ts` implementieren**

```ts
import { holeArtikel, type ZettelArtikel } from "@/lib/einkaufszettel";
import { holeKetten, type Kette } from "@/lib/katalog";
import { bestesAngebot, holePreisMatrix } from "@/lib/preise";
import type { DbOderTransaktion } from "@/lib/zugriff";

export type KettenSumme = { kette: Kette; summe: number; vollstaendig: boolean };
export type AufteilungsZeile = {
  kette: Kette;
  artikel: { artikel: ZettelArtikel; preis: number }[];
  summe: number;
};
export type Optimierung = {
  aufteilung: AufteilungsZeile[];
  aufteilungSumme: number;
  einzelmaerkte: KettenSumme[];
  guenstigsterEinzelmarkt: KettenSumme | null;
  ersparnis: number | null;
};

/**
 * Aggregiert ausschließlich über die bestehende Preis-Engine aus Plan 2 —
 * eine `holePreisMatrix`-Abfrage je katalogverknüpftem Artikel. Bewusst
 * nicht gebündelt: siehe Design-Spec, Abschnitt „Bewusst nicht drin". Bei
 * den zu erwartenden Listengrößen (ein Haushalt, keine Nebenläufigkeit,
 * typischerweise unter 30 Positionen) ist das eine Frage von Millisekunden.
 */
export async function berechneOptimierung(db: DbOderTransaktion, listId: string): Promise<Optimierung> {
  const alleArtikel = await holeArtikel(db, listId);
  const katalogArtikel = alleArtikel.filter((a) => a.produkt !== null);
  const ketten = await holeKetten(db);

  const kettenSummen = new Map<string, number>(ketten.map((k) => [k.id, 0]));
  const kettenVollstaendig = new Map<string, boolean>(ketten.map((k) => [k.id, true]));
  const aufteilungNachKette = new Map<string, { artikel: ZettelArtikel; preis: number }[]>(
    ketten.map((k) => [k.id, []]),
  );
  let aufteilungSumme = 0;

  for (const artikel of katalogArtikel) {
    const zeilen = await holePreisMatrix(db, artikel.produkt!.id);

    for (const zeile of zeilen) {
      if (zeile.bestpreis === null) {
        kettenVollstaendig.set(zeile.kette.id, false);
        continue;
      }
      const bisherige = kettenSummen.get(zeile.kette.id) ?? 0;
      kettenSummen.set(zeile.kette.id, bisherige + zeile.bestpreis * artikel.stueckzahl);
    }

    const { heuteSieger } = bestesAngebot(zeilen);
    if (heuteSieger) {
      const preis = heuteSieger.bestpreis! * artikel.stueckzahl;
      aufteilungSumme += preis;
      aufteilungNachKette.get(heuteSieger.kette.id)?.push({ artikel, preis });
    }
  }

  const einzelmaerkte: KettenSumme[] = ketten.map((kette) => ({
    kette,
    summe: kettenSummen.get(kette.id) ?? 0,
    vollstaendig: (kettenVollstaendig.get(kette.id) ?? false) && katalogArtikel.length > 0,
  }));

  const vollstaendigeMaerkte = einzelmaerkte.filter((k) => k.vollstaendig);
  const guenstigsterEinzelmarkt =
    vollstaendigeMaerkte.length === 0
      ? null
      : vollstaendigeMaerkte.reduce((a, b) => (b.summe < a.summe ? b : a));

  const aufteilung: AufteilungsZeile[] = ketten
    .map((kette) => {
      const eintraege = aufteilungNachKette.get(kette.id) ?? [];
      return {
        kette,
        artikel: eintraege,
        summe: eintraege.reduce((summe, e) => summe + e.preis, 0),
      };
    })
    .filter((zeile) => zeile.artikel.length > 0);

  return {
    aufteilung,
    aufteilungSumme,
    einzelmaerkte,
    guenstigsterEinzelmarkt,
    ersparnis: guenstigsterEinzelmarkt ? guenstigsterEinzelmarkt.summe - aufteilungSumme : null,
  };
}
```

**Hinweis für den Implementierer:** Die Bedingung
`katalogArtikel.length > 0` bei `vollstaendig` verhindert, dass eine leere
Liste jede Kette fälschlich als „vollständig, Summe null" ausgibt. Wenn du
beim Implementieren einen saubereren Weg findest, das auszudrücken (etwa
einen frühen Rückgabewert für `katalogArtikel.length === 0`), ist das in
Ordnung — die Tests oben prüfen das Verhalten, nicht diese eine Zeile.

- [ ] **Step 4: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/optimierer.test.ts`
Expected: PASS — 6 Tests

- [ ] **Step 5: `bunx tsc --noEmit` und `bun run build` ausführen**

Expected: keine Fehler

- [ ] **Step 6: Commit**

```bash
git add src/lib/optimierer.ts tests/optimierer.test.ts
git commit -m "feat: Optimierer-Berechnung (Bester Einzelmarkt, Optimale Aufteilung)"
```

---

### Task 5: `erfasse` um Zettel-Bezug erweitern

**Files:**
- Modify: `src/app/erfassen/aktionen.ts:34-273` (Funktion `erfasse`)
- Test: `tests/erfassen-aktionen.test.ts` (Erweiterung der bestehenden Datei)

**Interfaces:**
- Consumes: `hakeItemAb` (Task 3)
- Produces: `erfasse` akzeptiert weiterhin `FormData`, liest jetzt
  zusätzlich die optionalen Felder `zettelItemId` — wenn gesetzt, wird
  `hakeItemAb` innerhalb derselben Transaktion aufgerufen, die auch die
  Preisbeobachtung schreibt

- [ ] **Step 1: Fehlschlagende Tests ergänzen**

In `tests/erfassen-aktionen.test.ts` ergänzen (die Datei existiert bereits
aus Plan 2 — die bestehenden Tests unverändert lassen, nur ergänzen):

```ts
import { fuegeFreitextArtikelHinzu, erzeugeListe, holeArtikel } from "@/lib/einkaufszettel";

describe("erfasse — Zettel-Bezug", () => {
  it("hakt den Zettel-Eintrag ab, wenn zettelItemId übergeben wird", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const artikel = await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Butter");

    const formular = neuesFormular({ zettelItemId: artikel.id });
    const ergebnis = await erfasse(undefined, formular);

    expect(ergebnis.art).toBe("erfolg");
    const [aktualisiert] = await holeArtikel(umgebung.db, liste.id);
    expect(aktualisiert?.abgehaktAm).not.toBeNull();
  });

  it("lässt den Zettel-Eintrag unabgehakt, wenn die Erfassung abgewiesen wird", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const artikel = await fuegeFreitextArtikelHinzu(umgebung.db, liste.id, "Butter");

    const formular = neuesFormular({ zettelItemId: artikel.id, preis: "-1" });
    const ergebnis = await erfasse(undefined, formular);

    expect(ergebnis.art).toBe("fehler");
    const [unveraendert] = await holeArtikel(umgebung.db, liste.id);
    expect(unveraendert?.abgehaktAm).toBeNull();
  });

  it("funktioniert unverändert ohne zettelItemId", async () => {
    const formular = neuesFormular({});
    const ergebnis = await erfasse(undefined, formular);
    expect(ergebnis.art).toBe("erfolg");
  });
});
```

Prüfe beim Implementieren, wie die bestehende Testdatei ein
`FormData`-Objekt für einen gültigen Erfassungsversuch zusammenbaut (dort
existiert vermutlich schon eine Hilfsfunktion oder ein wiederholtes Muster
mit `kette`, `name`, `marke`, `menge`, `preis`, `preisart`) — nenne die neue
Hilfsfunktion oben `neuesFormular` nur, falls es noch keine vergleichbare
gibt; existiert bereits eine, erweitere **die**, statt eine zweite
danebenzustellen, und übernimm den Namen, den die Datei bereits verwendet.

- [ ] **Step 2: Tests ausführen, Fehlschlag bestätigen**

Run: `bun test tests/erfassen-aktionen.test.ts`
Expected: FAIL — `zettelItemId` wird ignoriert, `abgehaktAm` bleibt `null`

- [ ] **Step 3: `erfasse` erweitern**

In `src/app/erfassen/aktionen.ts`:

```ts
import { hakeItemAb } from "@/lib/einkaufszettel";
```

Am Anfang von `erfasse`, nach dem Einlesen der übrigen Felder:

```ts
  const zettelItemId = String(formular.get("zettelItemId") ?? "").trim() || null;
```

Innerhalb von `db.transaction(async (tx) => { ... })`, **nach** dem
`if (preisart === "PROMO" && aktionGueltigBis) { ... }`-Block und **vor**
`return produkt.id;`:

```ts
      if (zettelItemId) {
        await hakeItemAb(tx, zettelItemId);
      }
```

Das ist die einzige Änderung an der Transaktion — sie nutzt exakt denselben
Rückbau-Schutz, den die bestehende Preis-Schreiblogik schon hat: Scheitert
irgendein Schritt, rollt die ganze Transaktion zurück, und der Zettel-
Eintrag bleibt so unabgehakt wie das Produkt ungespeichert.

- [ ] **Step 4: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/erfassen-aktionen.test.ts`
Expected: PASS — alle bisherigen und die drei neuen Fälle

- [ ] **Step 5: Volle Testsuite, `tsc`, Build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: alles sauber

- [ ] **Step 6: Commit**

```bash
git add src/app/erfassen/aktionen.ts tests/erfassen-aktionen.test.ts
git commit -m "feat: Abhaken eines Zettel-Eintrags in derselben Transaktion wie die Preiserfassung"
```

---

### Task 6: Listenübersicht

> **Gestaltungspflicht.** Vor dem ersten Code die Skills `impeccable`,
> `ui-ux-pro-max` und `frontend-design` aufrufen und deren Ergebnis
> umsetzen. Bestehendes Gestaltungssystem erben (`globals.css`,
> `Schaltflaeche`), nicht neu herleiten.

**Files:**
- Create: `src/app/einkaufszettel/page.tsx`
- Create: `src/app/einkaufszettel/aktionen.ts`
- Create: `src/app/einkaufszettel/listenformular.tsx`
- Test: `tests/einkaufszettel-aktionen.test.ts`
- Test: `tests/listenformular.test.tsx`

**Interfaces:**
- Consumes: `erzeugeListe`, `holeListen`, `loescheListe` (Task 2),
  `requireUser` aus `@/lib/sitzung`
- Produces: `erzeugeListeAktion(vorher, formular): Promise<{ art: "erfolg"; id: string } | { art: "fehler"; meldung: string }>`,
  `loescheListeAktion(id: string): Promise<void>`

- [ ] **Step 1: Design-Skills aufrufen**

`impeccable`, `ui-ux-pro-max` und `frontend-design` für „Übersicht mehrerer
Listen, eine neue anlegen, eine bestehende öffnen oder löschen — ruhige
Ebene, wenige, große Ziele" aufrufen; Ergebnis in den folgenden Schritten
umsetzen.

- [ ] **Step 2: Fehlschlagenden Test für die Server Actions schreiben**

```ts
// tests/einkaufszettel-aktionen.test.ts
import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { holeListe, holeListen } from "@/lib/einkaufszettel";
import { faengtFehler } from "./helfer/fehler";
import { starteTestDatenbank } from "./helfer/db";

const umgebung = await starteTestDatenbank();
afterAll(() => umgebung.stop());

mock.module("@/db", () => ({ db: umgebung.db }));

const echteSitzung = await import("@/lib/sitzung?echt");
let angemeldet = true;
mock.module("@/lib/sitzung", () => ({
  ...echteSitzung,
  requireUser: async () => {
    if (!angemeldet) throw new Error("nicht angemeldet");
    return { id: "u1", email: "wer@example.at" };
  },
}));

afterEach(() => {
  angemeldet = true;
});

import { erzeugeListeAktion, loescheListeAktion } from "@/app/einkaufszettel/aktionen";

describe("erzeugeListeAktion", () => {
  it("legt eine Liste an", async () => {
    const formular = new FormData();
    formular.set("name", "Wocheneinkauf");

    const ergebnis = await erzeugeListeAktion(undefined, formular);

    expect(ergebnis.art).toBe("erfolg");
    if (ergebnis.art === "erfolg") {
      expect(await holeListe(umgebung.db, ergebnis.id)).not.toBeNull();
    }
  });

  it("weist einen leeren Namen ab", async () => {
    const formular = new FormData();
    formular.set("name", "   ");

    const ergebnis = await erzeugeListeAktion(undefined, formular);
    expect(ergebnis.art).toBe("fehler");
  });

  it("verlangt eine Anmeldung", async () => {
    angemeldet = false;
    const formular = new FormData();
    formular.set("name", "Wocheneinkauf");

    await faengtFehler(() => erzeugeListeAktion(undefined, formular));
  });
});

describe("loescheListeAktion", () => {
  it("entfernt die Liste", async () => {
    const formular = new FormData();
    formular.set("name", "Zum Löschen");
    const angelegt = await erzeugeListeAktion(undefined, formular);
    if (angelegt.art !== "erfolg") throw new Error("Vorbereitung fehlgeschlagen");

    await loescheListeAktion(angelegt.id);

    expect(await holeListe(umgebung.db, angelegt.id)).toBeNull();
  });

  it("verlangt eine Anmeldung", async () => {
    angemeldet = false;
    await faengtFehler(() => loescheListeAktion("irgendeine-id"));
  });
});
```

- [ ] **Step 3: Test ausführen, Fehlschlag bestätigen**

Run: `bun test tests/einkaufszettel-aktionen.test.ts`
Expected: FAIL — Modul existiert nicht

- [ ] **Step 4: `src/app/einkaufszettel/aktionen.ts` implementieren**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { erzeugeListe, loescheListe } from "@/lib/einkaufszettel";
import { requireUser } from "@/lib/sitzung";

export type ListenErgebnis = { art: "erfolg"; id: string } | { art: "fehler"; meldung: string };

export async function erzeugeListeAktion(
  _vorher: ListenErgebnis | undefined,
  formular: FormData,
): Promise<ListenErgebnis> {
  await requireUser();

  const name = String(formular.get("name") ?? "").trim();
  if (!name) {
    return { art: "fehler", meldung: "Gib der Liste einen Namen." };
  }

  try {
    const liste = await erzeugeListe(db, name);
    revalidatePath("/einkaufszettel");
    return { art: "erfolg", id: liste.id };
  } catch {
    return { art: "fehler", meldung: "Die Liste ließ sich nicht anlegen. Versuch es noch einmal." };
  }
}

export async function loescheListeAktion(id: string): Promise<void> {
  await requireUser();
  await loescheListe(db, id);
  revalidatePath("/einkaufszettel");
}
```

- [ ] **Step 5: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/einkaufszettel-aktionen.test.ts`
Expected: PASS — 5 Tests

- [ ] **Step 6: Fehlschlagenden Test für das Formular schreiben**

```tsx
// tests/listenformular.test.tsx
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ListenErgebnis } from "@/app/einkaufszettel/aktionen";
import { ListenFormular } from "@/app/einkaufszettel/listenformular";

const erzeugeListeAktion = mock(
  async (_vorher: ListenErgebnis | undefined, _formular: FormData): Promise<ListenErgebnis> => ({
    art: "erfolg",
    id: "l1",
  }),
);

afterEach(() => {
  cleanup();
  erzeugeListeAktion.mockClear();
});

describe("ListenFormular", () => {
  it("hat ein beschriftetes Namensfeld", () => {
    render(<ListenFormular aktion={erzeugeListeAktion} />);
    expect(screen.getByLabelText("Name der Liste")).toBeDefined();
  });

  it("ruft die Aktion mit dem eingegebenen Namen auf", async () => {
    render(<ListenFormular aktion={erzeugeListeAktion} />);
    await userEvent.type(screen.getByLabelText("Name der Liste"), "Wocheneinkauf");
    await userEvent.click(screen.getByRole("button", { name: "Liste anlegen" }));

    await waitFor(() => {
      expect(erzeugeListeAktion).toHaveBeenCalled();
    });
  });

  it("zeigt eine Fehlermeldung", async () => {
    erzeugeListeAktion.mockResolvedValueOnce({ art: "fehler", meldung: "Gib der Liste einen Namen." });
    render(<ListenFormular aktion={erzeugeListeAktion} />);
    await userEvent.click(screen.getByRole("button", { name: "Liste anlegen" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Gib der Liste einen Namen.");
    });
  });
});
```

- [ ] **Step 7: Test ausführen, Fehlschlag bestätigen**

Run: `bun test tests/listenformular.test.tsx`
Expected: FAIL — Modul existiert nicht

- [ ] **Step 8: `src/app/einkaufszettel/listenformular.tsx` implementieren**

```tsx
"use client";

import { useActionState } from "react";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";
import type { ListenErgebnis } from "./aktionen";

export function ListenFormular({
  aktion,
}: {
  aktion: (vorher: ListenErgebnis | undefined, formular: FormData) => Promise<ListenErgebnis>;
}) {
  const [ergebnis, absenden, laeuft] = useActionState<ListenErgebnis | undefined, FormData>(
    aktion,
    undefined,
  );

  return (
    <form action={absenden} className="flex flex-col gap-3">
      <label htmlFor="name" className="text-sm font-medium">
        Name der Liste
      </label>
      <input
        id="name"
        name="name"
        type="text"
        placeholder="z. B. Wocheneinkauf"
        className="min-h-14 rounded-block border border-linie bg-hintergrund px-4 text-base"
      />
      {ergebnis?.art === "fehler" ? (
        <p role="alert" className="text-sm text-fehler">
          {ergebnis.meldung}
        </p>
      ) : null}
      <Schaltflaeche variante="haupt" groesse="ruhig" disabled={laeuft} laedt={laeuft}>
        Liste anlegen
      </Schaltflaeche>
    </form>
  );
}
```

**Hinweis für den Implementierer:** Prüfe die tatsächlichen Props von
`Schaltflaeche` (`src/components/ui/schaltflaeche.tsx`) gegen das Obige,
bevor du es übernimmst — jede bisherige Aufgabe in Plan 2 und 3 fand
mindestens eine Abweichung zwischen einem vorgeschlagenen Prop-Namen und dem
tatsächlichen. Die Gestaltung (Abstände, Platzierung, Tonfall) unterliegt
der Gestaltungspflicht oben und ist hier nur ein Ausgangspunkt.

- [ ] **Step 9: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/listenformular.test.tsx tests/einkaufszettel-aktionen.test.ts`
Expected: PASS

- [ ] **Step 10: `src/app/einkaufszettel/page.tsx` implementieren**

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/db";
import { holeListen } from "@/lib/einkaufszettel";
import { requireUser } from "@/lib/sitzung";
import { erzeugeListeAktion, loescheListeAktion } from "./aktionen";
import { ListenFormular } from "./listenformular";

export const metadata: Metadata = { title: "Einkaufszettel — KassaTrack" };

export default async function EinkaufszettelSeite() {
  await requireUser();
  const listen = await holeListen(db);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-5 pt-8 sm:px-8 sm:pt-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-anzeige text-[clamp(1.75rem,7vw,2.125rem)] font-semibold">
          Einkaufszettel
        </h1>
      </header>

      <ListenFormular aktion={erzeugeListeAktion} />

      {listen.length === 0 ? (
        <p className="text-sm text-gedaempft">Noch keine Liste angelegt.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {listen.map((liste) => (
            <li key={liste.id} className="flex items-center justify-between gap-3">
              <Link href={`/einkaufszettel/${liste.id}`} className="min-h-14 flex-1 py-3">
                {liste.name}
              </Link>
              <form action={loescheListeAktion.bind(null, liste.id)}>
                <button type="submit" className="min-h-11 px-3 text-sm text-fehler">
                  Löschen
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

**Hinweis für den Implementierer:** Die konkrete Gestaltung (Layout,
Abstände, ob „Löschen" eine Bestätigung braucht) unterliegt der
Gestaltungspflicht — das Obige ist ein Ausgangspunkt für die Struktur, nicht
das fertige Ergebnis. Prüfe insbesondere, ob ein zerstörender Vorgang wie
„Liste löschen" ohne Rückfrage der Tonalität dieser App entspricht (siehe
`Schaltflaeche`s `gefahr`-Variante und ihre Doku dazu, wann Rot angemessen
ist).

- [ ] **Step 11: `bunx tsc --noEmit` und `bun run build` ausführen**

Expected: keine Fehler; `/einkaufszettel` erscheint in der Routenliste

- [ ] **Step 12: Browser-Verifikation**

Produktionsbau, `/einkaufszettel` öffnen (Handy- und Desktopbreite), eine
Liste anlegen, eine löschen. Konsole auf CSP-Verstöße prüfen. Screenshots
nach `docs/bilder/`.

- [ ] **Step 13: Commit**

```bash
git add src/app/einkaufszettel/page.tsx src/app/einkaufszettel/aktionen.ts src/app/einkaufszettel/listenformular.tsx tests/einkaufszettel-aktionen.test.ts tests/listenformular.test.tsx docs/bilder
git commit -m "feat: Listenübersicht für Einkaufszettel"
```

---

### Task 7: Listendetail — Artikel verwalten

> **Gestaltungspflicht.** Skills wie in Task 6 aufrufen.

**Files:**
- Create: `src/app/einkaufszettel/[id]/page.tsx`
- Create: `src/app/einkaufszettel/[id]/aktionen.ts`
- Create: `src/app/einkaufszettel/[id]/zettel-detail.tsx`
- Test: `tests/einkaufszettel-detail-aktionen.test.ts`
- Test: `tests/zettel-detail.test.tsx`

**Interfaces:**
- Consumes: `fuegeKatalogArtikelHinzu`, `fuegeFreitextArtikelHinzu`,
  `aendereStueckzahl`, `entferneArtikel`, `holeArtikel` (Task 3),
  `sucheProdukte` aus `@/lib/katalog`
- Produces:
  - `artikelHinzufuegenAktion(eingabe: { listId: string; produktId?: string; freitext?: string; stueckzahl?: number }): Promise<void>`
  - `stueckzahlAktion(itemId: string, stueckzahl: number): Promise<void>`
  - `entferneArtikelAktion(itemId: string): Promise<void>`
  - `sucheProdukteAktion(begriff: string): Promise<Produkt[]>`

- [ ] **Step 1: Design-Skills aufrufen**

Für „Artikelliste mit Mengenangabe, Hinzufügen aus Katalogsuche oder als
Freitext, Entfernen" aufrufen; Ergebnis in den folgenden Schritten
umsetzen.

- [ ] **Step 2: Fehlschlagenden Test für die Server Actions schreiben**

```ts
// tests/einkaufszettel-detail-aktionen.test.ts
import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { mock } from "bun:test";
import { erzeugeListe, holeArtikel } from "@/lib/einkaufszettel";
import { legeProduktAn } from "@/lib/katalog";
import { faengtFehler } from "./helfer/fehler";
import { starteTestDatenbank } from "./helfer/db";

const umgebung = await starteTestDatenbank();
afterAll(() => umgebung.stop());

mock.module("@/db", () => ({ db: umgebung.db }));

const echteSitzung = await import("@/lib/sitzung?echt");
let angemeldet = true;
mock.module("@/lib/sitzung", () => ({
  ...echteSitzung,
  requireUser: async () => {
    if (!angemeldet) throw new Error("nicht angemeldet");
    return { id: "u1", email: "wer@example.at" };
  },
}));

afterEach(() => {
  angemeldet = true;
});

import {
  artikelHinzufuegenAktion,
  entferneArtikelAktion,
  stueckzahlAktion,
  sucheProdukteAktion,
} from "@/app/einkaufszettel/[id]/aktionen";

describe("artikelHinzufuegenAktion", () => {
  it("fügt ein Katalogprodukt hinzu", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    const produkt = await legeProduktAn(umgebung.db, { name: "Butter", marke: null, menge: 250, einheit: "G" });

    await artikelHinzufuegenAktion({ listId: liste.id, produktId: produkt.id });

    const artikel = await holeArtikel(umgebung.db, liste.id);
    expect(artikel).toHaveLength(1);
    expect(artikel[0]?.produkt?.id).toBe(produkt.id);
  });

  it("fügt einen Freitext-Artikel hinzu", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    await artikelHinzufuegenAktion({ listId: liste.id, freitext: "Salz" });

    const artikel = await holeArtikel(umgebung.db, liste.id);
    expect(artikel[0]?.freitext).toBe("Salz");
  });

  it("verlangt eine Anmeldung", async () => {
    angemeldet = false;
    await faengtFehler(() => artikelHinzufuegenAktion({ listId: "x", freitext: "Salz" }));
  });
});

describe("stueckzahlAktion / entferneArtikelAktion", () => {
  it("ändert die Stückzahl", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    await artikelHinzufuegenAktion({ listId: liste.id, freitext: "Salz" });
    const [artikel] = await holeArtikel(umgebung.db, liste.id);

    await stueckzahlAktion(artikel!.id, 4);

    const [aktualisiert] = await holeArtikel(umgebung.db, liste.id);
    expect(aktualisiert?.stueckzahl).toBe(4);
  });

  it("entfernt einen Artikel", async () => {
    const liste = await erzeugeListe(umgebung.db, "Test");
    await artikelHinzufuegenAktion({ listId: liste.id, freitext: "Salz" });
    const [artikel] = await holeArtikel(umgebung.db, liste.id);

    await entferneArtikelAktion(artikel!.id);

    expect(await holeArtikel(umgebung.db, liste.id)).toHaveLength(0);
  });
});

describe("sucheProdukteAktion", () => {
  it("findet ein Produkt über Ähnlichkeit", async () => {
    await legeProduktAn(umgebung.db, { name: "Buttermilch", marke: null, menge: 500, einheit: "ML" });
    const treffer = await sucheProdukteAktion("Buttermilch");
    expect(treffer.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Test ausführen, Fehlschlag bestätigen**

Run: `bun test tests/einkaufszettel-detail-aktionen.test.ts`
Expected: FAIL — Modul existiert nicht

- [ ] **Step 4: `src/app/einkaufszettel/[id]/aktionen.ts` implementieren**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  aendereStueckzahl,
  entferneArtikel,
  fuegeFreitextArtikelHinzu,
  fuegeKatalogArtikelHinzu,
} from "@/lib/einkaufszettel";
import { sucheProdukte, type Produkt } from "@/lib/katalog";
import { requireUser } from "@/lib/sitzung";

export async function artikelHinzufuegenAktion(eingabe: {
  listId: string;
  produktId?: string;
  freitext?: string;
  stueckzahl?: number;
}): Promise<void> {
  await requireUser();

  if (eingabe.produktId) {
    await fuegeKatalogArtikelHinzu(db, eingabe.listId, eingabe.produktId, eingabe.stueckzahl);
  } else if (eingabe.freitext) {
    await fuegeFreitextArtikelHinzu(db, eingabe.listId, eingabe.freitext, eingabe.stueckzahl);
  } else {
    throw new Error("Weder produktId noch freitext übergeben.");
  }

  revalidatePath(`/einkaufszettel/${eingabe.listId}`);
}

export async function stueckzahlAktion(itemId: string, stueckzahl: number): Promise<void> {
  await requireUser();
  await aendereStueckzahl(db, itemId, stueckzahl);
}

export async function entferneArtikelAktion(itemId: string): Promise<void> {
  await requireUser();
  await entferneArtikel(db, itemId);
}

export async function sucheProdukteAktion(begriff: string): Promise<Produkt[]> {
  await requireUser();
  return sucheProdukte(db, begriff);
}
```

**Hinweis:** `stueckzahlAktion`/`entferneArtikelAktion` lösen bewusst kein
`revalidatePath` aus — sie werden aus `zettel-detail.tsx` (Step 6) heraus
aufgerufen, einer Client-Komponente, die ihren eigenen Zustand nach dem
Aufruf aktualisiert, ohne auf eine Serverantwort mit neuem HTML zu warten.
Falls das beim Implementieren nicht zum gewählten Zustandsmuster passt,
`revalidatePath(`/einkaufszettel/${listId}`)` ergänzen — dafür muss die
Funktion dann `listId` mitbekommen.

- [ ] **Step 5: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/einkaufszettel-detail-aktionen.test.ts`
Expected: PASS — 6 Tests

- [ ] **Step 6: Fehlschlagenden Test für `zettel-detail.tsx` schreiben**

```tsx
// tests/zettel-detail.test.tsx
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ZettelArtikel } from "@/lib/einkaufszettel";
import { ZettelDetail } from "@/app/einkaufszettel/[id]/zettel-detail";

const ARTIKEL: ZettelArtikel[] = [
  {
    id: "a1",
    listId: "l1",
    produkt: { id: "p1", name: "Butter", marke: "Berglandmilch", menge: 250, einheit: "G", bildSchluessel: null },
    freitext: null,
    stueckzahl: 1,
    abgehaktAm: null,
  },
];

const artikelHinzufuegen = mock(async () => {});
const stueckzahlAendern = mock(async () => {});
const entferneArtikel = mock(async () => {});
const sucheProdukte = mock(async () => []);

afterEach(() => {
  cleanup();
  artikelHinzufuegen.mockClear();
  stueckzahlAendern.mockClear();
  entferneArtikel.mockClear();
  sucheProdukte.mockClear();
});

function zeichne(artikel = ARTIKEL) {
  return render(
    <ZettelDetail
      listId="l1"
      artikel={artikel}
      artikelHinzufuegen={artikelHinzufuegen}
      stueckzahlAendern={stueckzahlAendern}
      entferneArtikel={entferneArtikel}
      sucheProdukte={sucheProdukte}
    />,
  );
}

describe("ZettelDetail", () => {
  it("zeigt jeden Artikel mit Namen und Stückzahl", () => {
    zeichne();
    expect(screen.getByText("Butter")).toBeDefined();
  });

  it("fügt einen Freitext-Artikel über das Eingabefeld hinzu", async () => {
    zeichne();
    await userEvent.type(screen.getByLabelText("Artikel hinzufügen"), "Salz");
    await userEvent.click(screen.getByRole("button", { name: "Als Freitext hinzufügen" }));

    await waitFor(() => {
      expect(artikelHinzufuegen).toHaveBeenCalledWith(expect.objectContaining({ freitext: "Salz" }));
    });
  });

  it("entfernt einen Artikel", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /entfernen/i }));

    await waitFor(() => {
      expect(entferneArtikel).toHaveBeenCalledWith("a1");
    });
  });
});
```

- [ ] **Step 7: Test ausführen, Fehlschlag bestätigen**

Run: `bun test tests/zettel-detail.test.tsx`
Expected: FAIL — Modul existiert nicht

- [ ] **Step 8: `src/app/einkaufszettel/[id]/zettel-detail.tsx` implementieren**

```tsx
"use client";

import { useId, useState } from "react";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";
import { formatierePackung } from "@/lib/einheiten";
import type { Produkt } from "@/lib/katalog";
import type { ZettelArtikel } from "@/lib/einkaufszettel";

export function ZettelDetail({
  listId,
  artikel,
  artikelHinzufuegen,
  stueckzahlAendern,
  entferneArtikel,
  sucheProdukte,
}: {
  listId: string;
  artikel: ZettelArtikel[];
  artikelHinzufuegen: (eingabe: {
    listId: string;
    produktId?: string;
    freitext?: string;
  }) => Promise<void>;
  stueckzahlAendern: (itemId: string, stueckzahl: number) => Promise<void>;
  entferneArtikel: (itemId: string) => Promise<void>;
  sucheProdukte: (begriff: string) => Promise<Produkt[]>;
}) {
  const eingabeId = useId();
  const [eingabe, setEingabe] = useState("");
  const [treffer, setTreffer] = useState<Produkt[]>([]);

  async function beiEingabe(wert: string) {
    setEingabe(wert);
    setTreffer(wert.trim() ? await sucheProdukte(wert) : []);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor={eingabeId} className="text-sm font-medium">
          Artikel hinzufügen
        </label>
        <input
          id={eingabeId}
          value={eingabe}
          onChange={(e) => beiEingabe(e.target.value)}
          className="min-h-14 rounded-block border border-linie bg-hintergrund px-4 text-base"
          placeholder="z. B. Butter"
        />
        {treffer.map((produkt) => (
          <Schaltflaeche
            key={produkt.id}
            variante="neben"
            className="justify-start px-4 text-left"
            onClick={() => {
              artikelHinzufuegen({ listId, produktId: produkt.id });
              setEingabe("");
              setTreffer([]);
            }}
          >
            {produkt.name} · {formatierePackung(produkt.menge, produkt.einheit)}
          </Schaltflaeche>
        ))}
        {eingabe.trim() ? (
          <Schaltflaeche
            variante="neben"
            onClick={() => {
              artikelHinzufuegen({ listId, freitext: eingabe });
              setEingabe("");
              setTreffer([]);
            }}
          >
            Als Freitext hinzufügen
          </Schaltflaeche>
        ) : null}
      </div>

      <ul className="flex flex-col gap-2">
        {artikel.map((eintrag) => (
          <li key={eintrag.id} className="flex items-center justify-between gap-3">
            <span>
              {eintrag.produkt
                ? `${eintrag.produkt.name} · ${formatierePackung(eintrag.produkt.menge, eintrag.produkt.einheit)}`
                : eintrag.freitext}
              {eintrag.stueckzahl > 1 ? ` × ${eintrag.stueckzahl}` : ""}
            </span>
            <button
              type="button"
              onClick={() => entferneArtikel(eintrag.id)}
              className="min-h-11 px-3 text-sm text-fehler"
            >
              Entfernen
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

**Hinweis für den Implementierer:** Das Obige ist ein Ausgangspunkt für
Struktur und Verhalten — die tatsächliche Gestaltung, die Katalogsuche live
beim Tippen (dieselbe `pg_trgm`-Ähnlichkeitssuche wie `/produkte`), das
Anzeigen/Ändern der Stückzahl (im Test oben nicht geprüft, aber vom Auftrag
verlangt — ein `<input type="number">` oder +/−-Schaltflächen, die
`stueckzahlAendern` aufrufen, je nach Gestaltungs-Skill-Ergebnis) und die
Übernahmestrategie für das lokale `useState` nach einem Server-Aufruf
gehören zur Gestaltungspflicht dieser Aufgabe.

- [ ] **Step 9: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/zettel-detail.test.tsx tests/einkaufszettel-detail-aktionen.test.ts`
Expected: PASS

- [ ] **Step 10: `src/app/einkaufszettel/[id]/page.tsx` implementieren**

```tsx
import { notFound } from "next/navigation";
import { db } from "@/db";
import { holeArtikel, holeListe } from "@/lib/einkaufszettel";
import { requireUser } from "@/lib/sitzung";
import {
  artikelHinzufuegenAktion,
  entferneArtikelAktion,
  stueckzahlAktion,
  sucheProdukteAktion,
} from "./aktionen";
import { ZettelDetail } from "./zettel-detail";

export default async function ListendetailSeite({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const liste = await holeListe(db, id);
  if (!liste) notFound();

  const artikel = await holeArtikel(db, id);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-5 pt-8 sm:px-8 sm:pt-12">
      <h1 className="font-anzeige text-[clamp(1.75rem,7vw,2.125rem)] font-semibold">{liste.name}</h1>

      <ZettelDetail
        listId={liste.id}
        artikel={artikel}
        artikelHinzufuegen={artikelHinzufuegenAktion}
        stueckzahlAendern={stueckzahlAktion}
        entferneArtikel={entferneArtikelAktion}
        sucheProdukte={sucheProdukteAktion}
      />
    </main>
  );
}
```

- [ ] **Step 11: `bunx tsc --noEmit` und `bun run build` ausführen**

Expected: keine Fehler; `/einkaufszettel/[id]` erscheint in der Routenliste

- [ ] **Step 12: Browser-Verifikation**

Eine Liste öffnen, Katalogartikel und Freitext hinzufügen, entfernen.
Screenshots nach `docs/bilder/`.

- [ ] **Step 13: Commit**

```bash
git add src/app/einkaufszettel/\[id\] tests/einkaufszettel-detail-aktionen.test.ts tests/zettel-detail.test.tsx docs/bilder
git commit -m "feat: Listendetail — Artikel hinzufügen, ändern, entfernen"
```

---

### Task 8: Optimierer-Anzeige und Abhak-Fluss

> **Gestaltungspflicht.** Skills wie in Task 6/7 aufrufen — hier
> insbesondere für die zweischichtige Optimierer-Ansicht und die
> Mini-Preiserfassung beim Abhaken.

**Files:**
- Create: `src/app/einkaufszettel/[id]/optimierer-anzeige.tsx`
- Create: `src/app/einkaufszettel/[id]/abhak-formular.tsx`
- Modify: `src/app/einkaufszettel/[id]/page.tsx` (Optimierer + Abhaken einhängen)
- Modify: `src/app/einkaufszettel/[id]/zettel-detail.tsx` (Abhaken-Schaltfläche je Zeile)
- Test: `tests/optimierer-anzeige.test.tsx`
- Test: `tests/abhak-formular.test.tsx`

**Interfaces:**
- Consumes: `Optimierung`, `berechneOptimierung` (Task 4), `erfasse`,
  `ErfassungsAktion` aus `@/app/erfassen/zustand` (Task 5 erweitert),
  `holeKetten` aus `@/lib/katalog`

- [ ] **Step 1: Design-Skills aufrufen**

Für „zweischichtige Preisvergleichs-Zusammenfassung, ruhige Kernaussage
plus Ketten-Aufschlüsselung auf Tap" und „minimale Preiserfassung direkt
nach einem Abhaken, ein bis zwei Felder, keine volle Formularseite"
aufrufen; Ergebnis in den folgenden Schritten umsetzen.

- [ ] **Step 2: Fehlschlagenden Test für `OptimiererAnzeige` schreiben**

```tsx
// tests/optimierer-anzeige.test.tsx
import { screen } from "./dom";

import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { Optimierung } from "@/lib/optimierer";
import { OptimiererAnzeige } from "@/app/einkaufszettel/[id]/optimierer-anzeige";

afterEach(cleanup);

const KETTE_SPAR = { id: "c1", name: "Spar", kuerzel: "spar" };
const KETTE_HOFER = { id: "c2", name: "Hofer", kuerzel: "hofer" };

function optimierung(ueberschreibung: Partial<Optimierung> = {}): Optimierung {
  return {
    aufteilung: [],
    aufteilungSumme: 3.68,
    einzelmaerkte: [
      { kette: KETTE_SPAR, summe: 3.99, vollstaendig: true },
      { kette: KETTE_HOFER, summe: 4.18, vollstaendig: true },
    ],
    guenstigsterEinzelmarkt: { kette: KETTE_SPAR, summe: 3.99, vollstaendig: true },
    ersparnis: 0.31,
    ...ueberschreibung,
  };
}

describe("OptimiererAnzeige", () => {
  it("zeigt die Ersparnis als betonte Aussage, wenn sie positiv ist", () => {
    render(<OptimiererAnzeige optimierung={optimierung()} />);
    expect(screen.getByText(/sparst/i)).toBeDefined();
  });

  it("zeigt bester Einzelmarkt, wenn es keine Ersparnis gibt", () => {
    render(<OptimiererAnzeige optimierung={optimierung({ ersparnis: 0 })} />);
    expect(screen.getByText(/Spar/)).toBeDefined();
  });

  it("zeigt einen Hinweis, wenn keine Kette vollständig ist", () => {
    render(
      <OptimiererAnzeige
        optimierung={optimierung({ guenstigsterEinzelmarkt: null, ersparnis: null })}
      />,
    );
    expect(screen.getByText(/noch keine Preise|nicht alles/i)).toBeDefined();
  });

  it("zeigt die dichte Ketten-Aufschlüsselung erst nach dem Aufklappen", async () => {
    render(<OptimiererAnzeige optimierung={optimierung()} />);
    expect(screen.queryByText("4,18")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Details|Ketten/i }));
    expect(screen.getByText(/4,18/)).toBeDefined();
  });
});
```

- [ ] **Step 3: Test ausführen, Fehlschlag bestätigen**

Run: `bun test tests/optimierer-anzeige.test.tsx`
Expected: FAIL — Modul existiert nicht

- [ ] **Step 4: `optimierer-anzeige.tsx` implementieren**

```tsx
"use client";

import type { Optimierung } from "@/lib/optimierer";

function formatiereEuro(betrag: number): string {
  return betrag.toLocaleString("de-AT", { style: "currency", currency: "EUR" });
}

export function OptimiererAnzeige({ optimierung }: { optimierung: Optimierung }) {
  const { guenstigsterEinzelmarkt, ersparnis, einzelmaerkte } = optimierung;

  return (
    <div data-auftritt className="flex animate-auftritt flex-col gap-3 rounded-block bg-flaeche px-5 py-4">
      {guenstigsterEinzelmarkt === null ? (
        <p className="text-[0.9375rem] text-gedaempft">
          Noch keine Kette vollständig erfasst — nicht alles hier verfügbar.
        </p>
      ) : ersparnis !== null && ersparnis > 0 ? (
        <p className="text-[1.0625rem] font-medium">
          Aufgeteilt sparst du {formatiereEuro(ersparnis)} gegenüber {guenstigsterEinzelmarkt.kette.name}.
        </p>
      ) : (
        <p className="text-[1.0625rem] font-medium">
          Am günstigsten: alles bei {guenstigsterEinzelmarkt.kette.name},{" "}
          {formatiereEuro(guenstigsterEinzelmarkt.summe)}.
        </p>
      )}

      <details>
        <summary className="min-h-11 cursor-pointer text-sm text-gedaempft">
          Ketten im Detail
        </summary>
        <table className="zahlen mt-2 w-full text-sm">
          <tbody>
            {einzelmaerkte.map((zeile) => (
              <tr key={zeile.kette.id}>
                <td>{zeile.kette.name}</td>
                <td className="text-right">
                  {zeile.vollstaendig ? formatiereEuro(zeile.summe) : "nicht alles hier erfasst"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
```

**Hinweis:** Ein natives `<details>`/`<summary>` — kein Client-Handler, den
die CSP blockieren würde, dieselbe Entscheidung wie in Plan 3s
Produktdetailseite. Gestaltung (Ton der Kernaussage, Layout der Tabelle)
unterliegt der Gestaltungspflicht.

- [ ] **Step 5: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/optimierer-anzeige.test.tsx`
Expected: PASS — 4 Tests

- [ ] **Step 6: Fehlschlagenden Test für `AbhakFormular` schreiben**

```tsx
// tests/abhak-formular.test.tsx
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { Ergebnis } from "@/app/erfassen/zustand";
import type { Kette } from "@/lib/katalog";
import { AbhakFormular } from "@/app/einkaufszettel/[id]/abhak-formular";

const erfasse = mock(
  async (_vorher: Ergebnis | undefined, _formular: FormData): Promise<Ergebnis> => ({
    art: "erfolg",
    produktId: "p1",
    grundpreis: "9,96 €/kg",
  }),
);

const KETTEN: Kette[] = [
  { id: "c1", name: "Spar", kuerzel: "spar" },
  { id: "c2", name: "Hofer", kuerzel: "hofer" },
];

afterEach(() => {
  cleanup();
  erfasse.mockClear();
});

describe("AbhakFormular", () => {
  it("schlägt die empfohlene Kette vor", () => {
    render(
      <AbhakFormular
        artikelId="a1"
        name="Butter"
        marke="Berglandmilch"
        menge="250 g"
        empfohleneKette="spar"
        ketten={KETTEN}
        aktion={erfasse}
        onAbgeschlossen={() => {}}
      />,
    );
    expect(screen.getByRole("radio", { name: "Spar" })).toHaveProperty("checked", true);
  });

  it("sendet Produktname, Menge und Zettel-Bezug mit", async () => {
    render(
      <AbhakFormular
        artikelId="a1"
        name="Butter"
        marke="Berglandmilch"
        menge="250 g"
        empfohleneKette="spar"
        ketten={KETTEN}
        aktion={erfasse}
        onAbgeschlossen={() => {}}
      />,
    );
    await userEvent.type(screen.getByLabelText("Preis"), "2,49");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => {
      expect(erfasse).toHaveBeenCalled();
    });
    const [, formular] = erfasse.mock.calls[0]!;
    expect(formular.get("zettelItemId")).toBe("a1");
    expect(formular.get("name")).toBe("Butter");
  });

  it("ruft onAbgeschlossen nach erfolgreichem Speichern auf", async () => {
    const onAbgeschlossen = mock(() => {});
    render(
      <AbhakFormular
        artikelId="a1"
        name="Butter"
        marke={null}
        menge="250 g"
        empfohleneKette="spar"
        ketten={KETTEN}
        aktion={erfasse}
        onAbgeschlossen={onAbgeschlossen}
      />,
    );
    await userEvent.type(screen.getByLabelText("Preis"), "2,49");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => {
      expect(onAbgeschlossen).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 7: Test ausführen, Fehlschlag bestätigen**

Run: `bun test tests/abhak-formular.test.tsx`
Expected: FAIL — Modul existiert nicht

- [ ] **Step 8: `abhak-formular.tsx` implementieren**

```tsx
"use client";

import { useActionState, useEffect } from "react";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";
import type { Ergebnis, ErfassungsAktion } from "@/app/erfassen/zustand";
import type { Kette } from "@/lib/katalog";

export function AbhakFormular({
  artikelId,
  name,
  marke,
  menge,
  empfohleneKette,
  ketten,
  aktion,
  onAbgeschlossen,
}: {
  artikelId: string;
  name: string;
  marke: string | null;
  menge: string;
  empfohleneKette: string | null;
  ketten: Kette[];
  aktion: ErfassungsAktion;
  onAbgeschlossen: () => void;
}) {
  const [ergebnis, absenden, laeuft] = useActionState<Ergebnis | undefined, FormData>(
    aktion,
    undefined,
  );

  useEffect(() => {
    if (ergebnis?.art === "erfolg") onAbgeschlossen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ergebnis]);

  return (
    <form action={absenden} className="flex flex-col gap-3 rounded-block bg-flaeche px-4 py-3">
      <input type="hidden" name="zettelItemId" value={artikelId} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="marke" value={marke ?? ""} />
      <input type="hidden" name="menge" value={menge} />
      <input type="hidden" name="preisart" value="NORMAL" />

      <div className="flex gap-2">
        {ketten.map((kette) => (
          <label key={kette.id} className="flex items-center gap-1 text-sm">
            <input
              type="radio"
              name="kette"
              value={kette.kuerzel}
              defaultChecked={kette.kuerzel === empfohleneKette}
            />
            {kette.name}
          </label>
        ))}
      </div>

      <label htmlFor={`preis-${artikelId}`} className="text-sm font-medium">
        Preis
      </label>
      <input
        id={`preis-${artikelId}`}
        name="preis"
        type="text"
        inputMode="decimal"
        className="min-h-14 rounded-block border border-linie bg-hintergrund px-4 text-base"
      />

      {ergebnis?.art === "fehler" ? (
        <p role="alert" className="text-sm text-fehler">
          {ergebnis.meldung}
        </p>
      ) : null}

      <Schaltflaeche variante="haupt" groesse="ruhig" disabled={laeuft} laedt={laeuft}>
        Speichern
      </Schaltflaeche>
    </form>
  );
}
```

**Hinweis für den Implementierer:** Prüfe `erfasse`s tatsächliche
`FormData`-Feldnamen in `src/app/erfassen/aktionen.ts` gegen das Obige,
bevor du es übernimmst (`kette` als Kürzel, `menge` als Text wie „250 g" —
beides bereits durch Plan 2 festgelegt, hier nur wiederverwendet). Die
Gestaltung dieses Mini-Formulars — wie viele Felder sichtbar sind, wie es
sich zur Artikelzeile in `zettel-detail.tsx` verhält (ausklappend? als
eigener Bereich?) — unterliegt der Gestaltungspflicht.

- [ ] **Step 9: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/abhak-formular.test.tsx`
Expected: PASS — 3 Tests

- [ ] **Step 10: `zettel-detail.tsx` um Abhaken erweitern**

Ergänze in `ZettelDetail` (aus Task 7) für jeden nicht abgehakten,
katalogverknüpften Artikel eine Möglichkeit, `AbhakFormular` einzublenden
(z. B. ein Häkchen-Button, der den Artikel als „wird gerade abgehakt"
markiert und darunter `AbhakFormular` zeichnet). Das Formular braucht die
empfohlene Kette — dafür muss `ZettelDetail` entweder die volle
`Optimierung` (Task 4) als Prop bekommen, oder `page.tsx` reicht bereits
aufgelöste empfohlene Ketten je Artikel-ID mit. Entscheide beim
Implementieren, was zum gewählten Zustandsmuster aus Task 7 passt, und
dokumentiere die Wahl kurz im Commit.

Erweitere `tests/zettel-detail.test.tsx` um einen Fall, der bestätigt: nach
dem Antippen von „Abhaken" erscheint `AbhakFormular` für genau diesen
Artikel.

- [ ] **Step 11: `page.tsx` um Optimierer und `erfasse` erweitern**

```tsx
import { berechneOptimierung } from "@/lib/optimierer";
import { holeKetten } from "@/lib/katalog";
import { erfasse } from "@/app/erfassen/aktionen";
import { OptimiererAnzeige } from "./optimierer-anzeige";
```

Nach `const artikel = await holeArtikel(db, id);` ergänzen:

```tsx
  const ketten = await holeKetten(db);
  const optimierung = await berechneOptimierung(db, id);
```

Im JSX vor `<ZettelDetail ...>`:

```tsx
      {artikel.length > 0 ? <OptimiererAnzeige optimierung={optimierung} /> : null}
```

`ZettelDetail` bekommt zusätzlich `ketten={ketten}` und `aktion={erfasse}`
als Props, die es an `AbhakFormular` weiterreicht.

- [ ] **Step 12: Volle Testsuite, `tsc`, Build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: alles sauber

- [ ] **Step 13: Browser-Verifikation**

Eine Liste mit Artikeln aus mindestens zwei Ketten öffnen, Optimierer-
Anzeige prüfen (beide Aussagen, aufgeklappte Details), einen Artikel
abhaken und einen Preis speichern, bestätigen dass der Artikel danach als
abgehakt erscheint. Konsole auf CSP-Verstöße prüfen (insbesondere: kein
Inline-Handler durch das `<details>`-Element). Screenshots nach
`docs/bilder/`.

- [ ] **Step 14: Commit**

```bash
git add src/app/einkaufszettel tests/optimierer-anzeige.test.tsx tests/abhak-formular.test.tsx tests/zettel-detail.test.tsx docs/bilder
git commit -m "feat: Optimierer-Anzeige und Abhak-Fluss im Einkaufszettel"
```

---

### Task 9: Navigation und Gesamtverifikation

**Files:**
- Modify: `src/components/app-navigation.tsx`
- Modify: `docs/offene-punkte.md`

**Interfaces:**
- Consumes: alles aus Tasks 1–8

- [ ] **Step 1: Navigationsziel ergänzen**

In `src/components/app-navigation.tsx`, `ZIELE`-Array um einen vierten
Eintrag ergänzen:

```ts
const ZIELE: Ziel[] = [
  { href: "/erfassen", name: "Erfassen", Symbol: SymbolErfassen },
  { href: "/produkte", name: "Produkte", Symbol: SymbolProdukte },
  { href: "/einkaufszettel", name: "Zettel", Symbol: SymbolZettel },
];
```

Ein `SymbolZettel` nach demselben Muster wie `SymbolErfassen`/
`SymbolProdukte` in derselben Datei ergänzen (SVG, `aktiv`-Prop für
gefüllt/umrissen — siehe die beiden bestehenden Symbole für das genaue
Muster, nicht neu erfinden).

Bestehenden Test in `tests/app-navigation.test.tsx` um einen Fall
ergänzen, der bestätigt, dass „Zettel" als viertes Ziel erscheint und auf
`/einkaufszettel` sowie `/einkaufszettel/irgendeine-id` als aktiv gilt
(Präfix-Vergleich, wie es die Datei für „Produkte" bereits testet).

- [ ] **Step 2: Test ausführen**

Run: `bun test tests/app-navigation.test.tsx`
Expected: PASS

- [ ] **Step 3: `docs/offene-punkte.md` — Abschnitt „Aus Plan 4" anlegen**

Nach demselben Muster wie „Aus Plan 3" (Erledigt / Warten / Bewusste
Entscheidungen). Mindestens:

- Kein Offline-Modus (bewusste Entscheidung, Begründung siehe Design-Spec).
- Keine gebündelte Preisabfrage im Optimierer (bewusste Entscheidung).
- Keine Katalog-Vorschläge beim Freitext-Tippen (bewusste Entscheidung).
- Jede beim Implementieren tatsächlich aufgetretene Abweichung oder Lücke
  (durch den Implementierer beim Abschluss zu ergänzen).

- [ ] **Step 4: Gesamtverifikation**

```bash
docker compose up -d postgres-test
bun test
bunx tsc --noEmit
bun run build
git grep -nE "(GOCSPX-|sk-[A-Za-z0-9]{20,})" -- . ':!docs'
```

Erwartet: alles sauber, kein Treffer im Secret-Grep, keine *Seite* in der
Build-Ausgabe als `○` (statisch) markiert.

- [ ] **Step 5: Browser-Verifikation**

Vollständigen Ablauf im Browser: Liste anlegen → Artikel aus Katalog und
als Freitext hinzufügen → Optimierer-Anzeige prüfen → einen Artikel abhaken
und Preis speichern → zur Listenübersicht zurück über die neue Navigation.
Konsole auf CSP-Verstöße prüfen. Screenshots nach `docs/bilder/` — vorher
etwaige veraltete Aufnahmen löschen, danach jede neue Aufnahme öffnen und
gegen ihren Dateinamen prüfen.

- [ ] **Step 6: Commit**

```bash
git add src/components/app-navigation.tsx tests/app-navigation.test.tsx docs/offene-punkte.md docs/bilder
git commit -m "feat: Navigation um Einkaufszettel ergänzt, Gesamtverifikation"
```

---

## Verifikation

**Plan 4 gilt als fertig, wenn:**

1. `bun test`, `bunx tsc --noEmit`, `bun run build` fehlerfrei
2. Eine Liste mit Artikeln aus mindestens zwei Ketten zeigt „Bester
   Einzelmarkt" und „Optimale Aufteilung" korrekt und unterschiedlich,
   inklusive Ersparnis in Euro
3. Eine Kette mit einer Preislücke bei einem Artikel gilt für „Bester
   Einzelmarkt" nachweislich als unvollständig
4. Ein katalogverknüpftes Item abzuhaken öffnet die vorausgefüllte
   Preiserfassung; ein Abbruch lässt das Item nachweislich unabgehakt
5. Ein Freitext-Item abzuhaken öffnet dieselbe Erfassung ohne Vorbefüllung
6. Freitext-Items erscheinen in keiner der beiden Optimierer-Rechnungen
7. Einkaufszettel-Bildschirme sind auf einem Handy in der Hand bedienbar,
   im Browser geprüft, mit Aufnahmen belegt

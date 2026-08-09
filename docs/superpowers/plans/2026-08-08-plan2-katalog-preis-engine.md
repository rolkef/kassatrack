# Plan 2 — Katalog und Preis-Engine: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aus dem Anmeldegerüst von Phase 1 einen benutzbaren Preisvergleich machen — Preise von Hand erfassen, Produkte suchen, und pro Produkt sehen, wo es normalerweise und wo es heute am günstigsten ist.

**Architecture:** Ein Katalog mit kanonischen Produkten über den Ketten und kettenspezifischen Ausprägungen darunter. Alle Preise landen als unveränderliche Beobachtungen in einer append-only Tabelle, klassifiziert nach Art (Normalpreis, Aktion, Treuekarte, Mengenrabatt). Darüber liegt eine reine Rechenschicht, die daraus zwei Zahlen ableitet: den **Referenzpreis** (robuster Normalpreis) und den **aktuellen Bestpreis** (inklusive laufender Aktionen). Die Oberfläche zeigt beide gleichzeitig — ruhig oben, dicht im Detail.

**Tech Stack:** Wie Phase 1. Next.js 16.2.12, React 19.2.8, TypeScript 7.0.2, Tailwind 4.3.3, Drizzle 0.45.2, PostgreSQL 18, Bun 1.3.14.

## Global Constraints

Diese gelten für **jede** Task, ohne dass sie dort wiederholt werden.

- Paketmanager ist ausschließlich **Bun**. Niemals `npm`, `yarn`, `pnpm`, `npx` — für Werkzeuge `bunx`.
- **Tailwind v4 ist CSS-first.** Es gibt keine `tailwind.config.js` und es darf keine entstehen. Tokens leben in `@theme` in `src/app/globals.css`; die aus Phase 1 sind vorhanden und werden **wiederverwendet**, nicht neu erfunden.
- Alle nutzersichtbaren Texte **deutsch, österreichisches Vokabular**. Routen-Segmente ebenfalls deutsch. Bezeichner im Code deutsch, wie in Phase 1.
- **Niemals auf `main`.** Der Branch für diesen Plan ist `plan2/katalog-preis-engine`.
- Neue Module nehmen die Datenbank als **Parameter** (`db: ZugriffsDb`), sie importieren `@/db` nicht selbst. Das ist das Muster aus `src/lib/zugriff.ts` und `src/lib/einladung.ts` und der Grund, warum diese Module testbar sind.
- **Invarianten gehören in die Datenbank**, nicht in das Vertrauen auf Aufrufer. `allowed_email` zeigt das Muster: `check`-Bedingungen statt Zusicherungen im Code.
- Tests benutzen `starteTestDatenbank()` aus `tests/helfer/db.ts` (eigene Wegwerf-Datenbank pro Aufruf, `await umgebung.stop()` in `afterAll`) und `faengtFehler()` aus `tests/helfer/fehler.ts`.
- **Niemals `expect(...).resolves` oder `.rejects` auf ein Versprechen, das selbst die Datenbank abfragt** — Bun 1.3.14 hängt auf Windows oder stürzt ab, wenn im selben Test bereits eine Abfrage abgewartet wurde. `faengtFehler()` benutzen.
- **Komponenten-Tests importieren als erste Zeile `./dom`** und beziehen `screen` von dort, nicht von `@testing-library`.
- Die App läuft unter einer strengen Sicherheitsrichtlinie **ohne `unsafe-inline`**. Eingebettete Stilangaben und eingebettete Ereignisbehandler werden vom Browser blockiert und von keinem Test erkannt.
- Vor dem Testen: `docker compose up -d postgres-test`.
- **Tasks, die Oberfläche bauen (6, 7, 8), MÜSSEN zuerst die Skills `impeccable`, `ui-ux-pro-max` und `frontend-design` aufrufen.** Das Markup in diesem Plan legt Struktur und Verhalten fest, nicht die Gestaltung.
- **Gestalterische Richtung: zweischichtig.** Die tägliche Oberfläche ist ruhig, großflächig, selbsterklärend. Ein Tap auf „Detail" öffnet die dichte, technische Ebene mit Tabellenziffern, Verlauf und Datenalter. Phase 1 hat das System etabliert (Marke `#005860`, Tokens, `Schaltflaeche` mit `variante`/`groesse`, Fokusring, `auftritt`-Animation) — **erben, nicht neu ableiten.**
- Jede Task endet mit einem Commit. Deutsche Nachricht, englisches Conventional-Commits-Präfix.

---

## Der Kern: zwei Preisbegriffe

Alles in diesem Plan dient dieser Unterscheidung.

| Begriff | Definition | Beantwortet |
|---|---|---|
| **Referenzpreis** | Median der jüngsten `NORMAL`-Beobachtungen innerhalb von 180 Tagen, pro Kette | „Wo ist Butter *grundsätzlich* günstig?" |
| **Aktueller Bestpreis** | `min(Referenzpreis, laufende Aktion)` mit Gültig-bis | „Wo kaufe ich *heute*?" |

Beide werden gleichzeitig angezeigt. Hofer kann normal teurer sein als Spar und trotzdem heute gewinnen.

**Warum Median und nicht Durchschnitt:** Ein einzelner Tippfehler bei der Erfassung — 2,99 statt 0,299 — verschiebt einen Durchschnitt dauerhaft. Der Median ignoriert Ausreißer.

**Warum „aktualitätsgewichtet" als „jüngste fünf" umgesetzt wird:** Ein echter gewichteter Median ist schwer nachvollziehbar und noch schwerer zu testen. Der Median der jüngsten fünf Beobachtungen bevorzugt aktuelle Daten von Natur aus, ist in einem Satz erklärbar und in einem Test festnagelbar. Bewusste Vereinfachung gegenüber dem Spec-Wortlaut.

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `src/db/schema/katalog.ts` | Ketten, Kategorien, Produkte, EANs, Ketten-Produkte |
| `src/db/schema/preise.ts` | Preisbeobachtungen und Aktionen |
| `src/lib/einheiten.ts` | Mengenangaben zerlegen und in Basiseinheiten rechnen — rein, ohne Datenbank |
| `src/lib/katalog.ts` | Produkte suchen, anlegen, lesen |
| `src/lib/preise.ts` | Beobachtungen schreiben; Referenzpreis und Bestpreis berechnen |
| `src/lib/median.ts` | Median über Zahlen — rein, eigene Datei weil sicherheitsrelevant für die Aussage |
| `src/app/produkte/page.tsx` | Produktsuche |
| `src/app/produkte/[id]/page.tsx` | Produktdetail, zweischichtig |
| `src/app/produkte/[id]/preis-tabelle.tsx` | Die dichte Ebene |
| `src/app/erfassen/page.tsx` | Manuelle Preiserfassung |
| `src/app/erfassen/aktionen.ts` | Server-Aktionen der Erfassung |
| `src/components/app-navigation.tsx` | Navigation zwischen den drei Bereichen |

---

## Task 1: Ketten und Kategorien

**Files:**
- Create: `src/db/schema/katalog.ts`, `src/lib/katalog.ts`
- Test: `tests/katalog-stammdaten.test.ts`

**Interfaces:**
- Consumes: `ZugriffsDb` aus `@/lib/zugriff`
- Produces:
  - Tabellen `chain` (`id`, `name`, `kuerzel`, `sortierung`) und `category` (`id`, `name`)
  - `KETTEN: readonly { kuerzel: string; name: string; sortierung: number }[]` aus `@/lib/katalog`
  - `legeKettenAn(db: ZugriffsDb): Promise<void>` — legt fehlende Ketten an, idempotent
  - `holeKetten(db: ZugriffsDb): Promise<Kette[]>` mit `Kette = { id: string; name: string; kuerzel: string }`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/katalog-stammdaten.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { KETTEN, holeKetten, legeKettenAn } from "@/lib/katalog";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";
import { chain } from "@/db/schema/katalog";

let umgebung: TestDatenbank;

beforeAll(async () => {
  umgebung = await starteTestDatenbank();
  await umgebung.db.execute(sql`
    create table chain (
      id text primary key,
      name text not null,
      kuerzel text not null unique,
      sortierung integer not null,
      constraint chain_kuerzel_klein check (kuerzel = lower(kuerzel))
    )
  `);
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

describe("Ketten", () => {
  it("kennt die fünf österreichischen Ketten", () => {
    expect(KETTEN.map((k) => k.kuerzel).sort()).toEqual([
      "billa",
      "hofer",
      "lidl",
      "penny",
      "spar",
    ]);
  });

  it("legt sie an", async () => {
    await legeKettenAn(umgebung.db);
    expect((await holeKetten(umgebung.db)).length).toBe(5);
  });

  it("ist bei doppeltem Aufruf unkritisch", async () => {
    await legeKettenAn(umgebung.db);
    await legeKettenAn(umgebung.db);
    expect((await holeKetten(umgebung.db)).length).toBe(5);
  });

  it("liefert sie in fester Reihenfolge, nicht in Einfügereihenfolge", async () => {
    await legeKettenAn(umgebung.db);
    const kuerzel = (await holeKetten(umgebung.db)).map((k) => k.kuerzel);
    expect(kuerzel).toEqual(["billa", "spar", "hofer", "lidl", "penny"]);
  });

  it("verweigert ein großgeschriebenes Kürzel", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(chain).values({ id: "x", name: "X", kuerzel: "BILLA", sortierung: 9 }),
    );
    expect(fehler).toBeDefined();
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `docker compose up -d postgres-test && bun test tests/katalog-stammdaten.test.ts`
Expected: FAIL — `Cannot find module '@/lib/katalog'`

- [ ] **Step 3: Schema implementieren**

`src/db/schema/katalog.ts`:

```ts
import { sql } from "drizzle-orm";
import { check, integer, pgTable, text } from "drizzle-orm/pg-core";

/**
 * Die Supermarktketten, deren Preise verglichen werden.
 *
 * Bewusst ohne Filialebene: Preise sind in Österreich innerhalb einer Kette
 * faktisch einheitlich. Eine Filialtabelle wäre Aufwand ohne Erkenntnisgewinn
 * und würde jede Abfrage um eine Ebene verlängern.
 */
export const chain = pgTable(
  "chain",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** Stabiler Schlüssel für Code und URLs, z. B. `billa`. */
    kuerzel: text("kuerzel").notNull().unique(),
    /** Anzeigereihenfolge. Nicht alphabetisch — Vollsortimenter zuerst. */
    sortierung: integer("sortierung").notNull(),
  },
  (tabelle) => [
    // Das Kürzel landet in URLs und wird im Code verglichen. Ohne diese
    // Bedingung würde ein großgeschriebener Eintrag stillschweigend nie treffen.
    check("chain_kuerzel_klein", sql`${tabelle.kuerzel} = lower(${tabelle.kuerzel})`),
  ],
);

export const category = pgTable("category", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
});
```

- [ ] **Step 4: Logik implementieren**

`src/lib/katalog.ts`:

```ts
import { randomUUID } from "node:crypto";
import { asc } from "drizzle-orm";
import { chain } from "@/db/schema/katalog";
import type { ZugriffsDb } from "@/lib/zugriff";

export type Kette = { id: string; name: string; kuerzel: string };

/**
 * Die Ketten, die KassaTrack vergleicht.
 *
 * Reihenfolge ist Absicht: die beiden Vollsortimenter zuerst, weil dort die
 * meisten Preise entstehen, danach die Discounter. Alphabetisch wäre für
 * niemanden hilfreich.
 */
export const KETTEN = [
  { kuerzel: "billa", name: "Billa", sortierung: 10 },
  { kuerzel: "spar", name: "Spar", sortierung: 20 },
  { kuerzel: "hofer", name: "Hofer", sortierung: 30 },
  { kuerzel: "lidl", name: "Lidl", sortierung: 40 },
  { kuerzel: "penny", name: "Penny", sortierung: 50 },
] as const;

/** Legt fehlende Ketten an. Mehrfach aufrufbar. */
export async function legeKettenAn(db: ZugriffsDb): Promise<void> {
  for (const eintrag of KETTEN) {
    await db
      .insert(chain)
      .values({ id: randomUUID(), ...eintrag })
      .onConflictDoNothing({ target: chain.kuerzel });
  }
}

export async function holeKetten(db: ZugriffsDb): Promise<Kette[]> {
  return db
    .select({ id: chain.id, name: chain.name, kuerzel: chain.kuerzel })
    .from(chain)
    .orderBy(asc(chain.sortierung));
}
```

- [ ] **Step 5: Test laufen lassen und Erfolg bestätigen**

Run: `bun test tests/katalog-stammdaten.test.ts`
Expected: PASS, 5 pass 0 fail

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/katalog.ts src/lib/katalog.ts tests/katalog-stammdaten.test.ts
git commit -m "feat: Ketten und Kategorien als Stammdaten"
```

---

## Task 2: Einheiten-Normalisierung

Diese Task ist der Grund, warum ein Preisvergleich überhaupt möglich ist. Ohne sie vergleicht man 2,49 € für 250 g mit 3,99 € für 1 kg und kommt zum falschen Ergebnis.

**Files:**
- Create: `src/lib/einheiten.ts`
- Test: `tests/einheiten.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces:
  - `type Basiseinheit = "G" | "ML" | "STK"`
  - `type Menge = { wert: number; einheit: Basiseinheit }`
  - `zerlegeMenge(eingabe: string): Menge | null` — versteht `"250 g"`, `"1 kg"`, `"1,5 l"`, `"6 Stk"`, `"0,5L"`
  - `grundpreis(gesamtpreis: number, menge: Menge): number` — Preis je 1000 g / 1000 ml / 1 Stück
  - `formatiereGrundpreis(wert: number, einheit: Basiseinheit): string` — z. B. `"9,96 €/kg"`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/einheiten.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { formatiereGrundpreis, grundpreis, zerlegeMenge } from "@/lib/einheiten";

describe("zerlegeMenge", () => {
  it("versteht Gramm", () => {
    expect(zerlegeMenge("250 g")).toEqual({ wert: 250, einheit: "G" });
  });

  it("rechnet Kilogramm in Gramm um", () => {
    expect(zerlegeMenge("1 kg")).toEqual({ wert: 1000, einheit: "G" });
  });

  it("versteht das deutsche Dezimalkomma", () => {
    expect(zerlegeMenge("1,5 l")).toEqual({ wert: 1500, einheit: "ML" });
  });

  it("versteht auch den Punkt als Dezimaltrenner", () => {
    expect(zerlegeMenge("1.5 l")).toEqual({ wert: 1500, einheit: "ML" });
  });

  it("kommt ohne Leerzeichen aus", () => {
    expect(zerlegeMenge("0,5L")).toEqual({ wert: 500, einheit: "ML" });
  });

  it("versteht Stück", () => {
    expect(zerlegeMenge("6 Stk")).toEqual({ wert: 6, einheit: "STK" });
  });

  it("liefert null bei Unsinn", () => {
    expect(zerlegeMenge("ein bisschen")).toBeNull();
    expect(zerlegeMenge("")).toBeNull();
    expect(zerlegeMenge("250")).toBeNull();
  });

  it("liefert null bei null oder negativer Menge", () => {
    expect(zerlegeMenge("0 g")).toBeNull();
    expect(zerlegeMenge("-5 g")).toBeNull();
  });
});

describe("grundpreis", () => {
  it("rechnet auf ein Kilogramm hoch", () => {
    expect(grundpreis(2.49, { wert: 250, einheit: "G" })).toBeCloseTo(9.96, 4);
  });

  it("rechnet auf einen Liter hoch", () => {
    expect(grundpreis(1.29, { wert: 1500, einheit: "ML" })).toBeCloseTo(0.86, 4);
  });

  it("rechnet bei Stück auf ein Stück", () => {
    expect(grundpreis(3.0, { wert: 6, einheit: "STK" })).toBeCloseTo(0.5, 4);
  });
});

describe("formatiereGrundpreis", () => {
  it("schreibt Euro je Kilogramm", () => {
    expect(formatiereGrundpreis(9.96, "G")).toBe("9,96 €/kg");
  });

  it("schreibt Euro je Liter", () => {
    expect(formatiereGrundpreis(0.86, "ML")).toBe("0,86 €/l");
  });

  it("schreibt Euro je Stück", () => {
    expect(formatiereGrundpreis(0.5, "STK")).toBe("0,50 €/Stk");
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `bun test tests/einheiten.test.ts`
Expected: FAIL — `Cannot find module '@/lib/einheiten'`

- [ ] **Step 3: Implementierung**

`src/lib/einheiten.ts`:

```ts
/**
 * Mengenangaben zerlegen und Preise vergleichbar machen.
 *
 * Ohne diese Umrechnung ist jeder Vergleich falsch: 2,49 € für 250 g Butter
 * gegen 3,99 € für 500 g sagt nichts, bevor beides auf dieselbe Einheit
 * gebracht ist.
 *
 * Intern wird alles in Gramm, Milliliter oder Stück gehalten — ganzzahlig,
 * damit Rundungsfehler nicht durch die Datenbank wandern.
 */
export type Basiseinheit = "G" | "ML" | "STK";

export type Menge = { wert: number; einheit: Basiseinheit };

const EINHEITEN: Record<string, { einheit: Basiseinheit; faktor: number }> = {
  g: { einheit: "G", faktor: 1 },
  gr: { einheit: "G", faktor: 1 },
  kg: { einheit: "G", faktor: 1000 },
  ml: { einheit: "ML", faktor: 1 },
  cl: { einheit: "ML", faktor: 10 },
  l: { einheit: "ML", faktor: 1000 },
  stk: { einheit: "STK", faktor: 1 },
  stueck: { einheit: "STK", faktor: 1 },
  st: { einheit: "STK", faktor: 1 },
};

/** Auf welche Menge sich der Grundpreis bezieht. */
const BEZUG: Record<Basiseinheit, number> = { G: 1000, ML: 1000, STK: 1 };

const BEZUGSNAME: Record<Basiseinheit, string> = { G: "kg", ML: "l", STK: "Stk" };

/**
 * Zerlegt eine Eingabe wie `"250 g"` oder `"1,5l"`.
 *
 * Liefert `null` statt zu werfen, weil das hier ein Benutzereingabefeld ist und
 * eine unverständliche Eingabe kein Ausnahmefall, sondern der Normalfall ist.
 */
export function zerlegeMenge(eingabe: string): Menge | null {
  // ö und ü gehören in die Zeichenklasse, sonst scheitert „6 Stück" — die
  // natürliche Schreibweise — und der Tabelleneintrag dafür wäre unerreichbar.
  const treffer = eingabe.trim().toLowerCase().match(/^(-?[\d]+(?:[.,]\d+)?)\s*([a-zäöü]+)$/);
  if (!treffer) return null;

  const zahlString = treffer[1];

  // Ein Punkt vor genau DREI Ziffern ist im deutschen Sprachraum das
  // Tausendertrennzeichen: „1.234" heißt 1234, nicht 1,234. Diese Form wird
  // abgelehnt statt geraten — wer rät, entscheidet nur, welcher Hälfte der
  // Nutzer er stillschweigend Zahlen liefert, die um den Faktor 1000 daneben
  // liegen, und nichts weiter unten kann das erkennen.
  //
  // Das führende `[1-9]` ist notwendig: Ein Tausenderzeichen steht nie hinter
  // einer alleinstehenden Null. „0.750" ist deshalb eindeutig ein Dezimalwert
  // — eine 750-ml-Flasche — und darf nicht mitabgelehnt werden.
  if (/[1-9]\d*\.\d{3}$/.test(zahlString)) return null;

  const zahl = Number(zahlString.replace(",", "."));
  const gefunden = EINHEITEN[treffer[2]];
  if (!gefunden || !Number.isFinite(zahl) || zahl <= 0) return null;

  return { wert: Math.round(zahl * gefunden.faktor), einheit: gefunden.einheit };
}

/** Preis je Kilogramm, Liter oder Stück. */
export function grundpreis(gesamtpreis: number, menge: Menge): number {
  return (gesamtpreis / menge.wert) * BEZUG[menge.einheit];
}

export function formatiereGrundpreis(wert: number, einheit: Basiseinheit): string {
  const zahl = wert.toFixed(2).replace(".", ",");
  return `${zahl} €/${BEZUGSNAME[einheit]}`;
}
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `bun test tests/einheiten.test.ts`
Expected: PASS, 14 pass 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/lib/einheiten.ts tests/einheiten.test.ts
git commit -m "feat: Mengen zerlegen und Grundpreise berechnen"
```

---

## Task 3: Produkt-Schema

**Files:**
- Modify: `src/db/schema/katalog.ts`
- Modify: `src/lib/katalog.ts`
- Test: `tests/katalog-produkte.test.ts`

**Interfaces:**
- Consumes: `Basiseinheit` aus `@/lib/einheiten`; `chain`, `category` aus Task 1
- Produces:
  - Tabellen `product` (`id`, `name`, `marke`, `kategorieId`, `menge`, `einheit`, `bildSchluessel`, `erstelltAm`), `productEan` (`ean` unique, `productId`), `storeProduct` (`id`, `chainId`, `productId`, `rohNamen` text[], unique auf `(chainId, productId)`)
  - `legeProduktAn(db, { name, marke?, menge, einheit }): Promise<Produkt>`
  - `holeProdukt(db, id): Promise<Produkt | null>`
  - `Produkt = { id: string; name: string; marke: string | null; menge: number; einheit: Basiseinheit }`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/katalog-produkte.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { holeProdukt, legeProduktAn } from "@/lib/katalog";
import { product } from "@/db/schema/katalog";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

let umgebung: TestDatenbank;

beforeAll(async () => {
  umgebung = await starteTestDatenbank();
  await umgebung.db.execute(sql`
    create table product (
      id text primary key,
      name text not null,
      marke text,
      kategorie_id text,
      menge integer not null,
      einheit text not null,
      bild_schluessel text,
      erstellt_am timestamptz not null default now(),
      constraint product_menge_positiv check (menge > 0),
      constraint product_einheit_bekannt check (einheit in ('G','ML','STK')),
      constraint product_name_nicht_leer check (btrim(name) <> '')
    )
  `);
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table product`);
});

describe("legeProduktAn", () => {
  it("legt ein Produkt an und liest es zurück", async () => {
    const angelegt = await legeProduktAn(umgebung.db, {
      name: "Butter",
      marke: "Vorarlberg Milch",
      menge: 250,
      einheit: "G",
    });

    const gelesen = await holeProdukt(umgebung.db, angelegt.id);
    expect(gelesen?.name).toBe("Butter");
    expect(gelesen?.menge).toBe(250);
    expect(gelesen?.einheit).toBe("G");
  });

  it("erlaubt ein Produkt ohne Marke", async () => {
    const angelegt = await legeProduktAn(umgebung.db, { name: "Vollmilch", menge: 1000, einheit: "ML" });
    expect((await holeProdukt(umgebung.db, angelegt.id))?.marke).toBeNull();
  });

  it("entfernt Leerzeichen am Rand des Namens", async () => {
    const angelegt = await legeProduktAn(umgebung.db, { name: "  Butter  ", menge: 250, einheit: "G" });
    expect((await holeProdukt(umgebung.db, angelegt.id))?.name).toBe("Butter");
  });
});

describe("holeProdukt", () => {
  it("liefert null für eine unbekannte Kennung", async () => {
    expect(await holeProdukt(umgebung.db, "gibtesnicht")).toBeNull();
  });
});

describe("Datenbank-Bedingungen", () => {
  it("verweigert eine Menge von null", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(product).values({ id: "1", name: "X", menge: 0, einheit: "G" }),
    );
    expect(fehler).toBeDefined();
  });

  it("verweigert eine unbekannte Einheit", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(product).values({ id: "1", name: "X", menge: 1, einheit: "PFUND" as never }),
    );
    expect(fehler).toBeDefined();
  });

  it("verweigert einen leeren Namen", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(product).values({ id: "1", name: "   ", menge: 1, einheit: "G" }),
    );
    expect(fehler).toBeDefined();
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `bun test tests/katalog-produkte.test.ts`
Expected: FAIL — `legeProduktAn` ist nicht exportiert

- [ ] **Step 3: Schema ergänzen**

In `src/db/schema/katalog.ts` anhängen:

```ts
import { timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Das kanonische Produkt — kettenübergreifend, genau einmal.
 *
 * `menge` und `einheit` sind Pflicht, weil ohne sie kein Grundpreis
 * berechenbar ist und damit kein Vergleich möglich wäre. Das ist der Grund,
 * warum sie hier stehen und nicht als optionales Beiwerk.
 */
export const product = pgTable(
  "product",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    marke: text("marke"),
    kategorieId: text("kategorie_id").references(() => category.id),
    /** In Gramm, Milliliter oder Stück — siehe src/lib/einheiten.ts. */
    menge: integer("menge").notNull(),
    einheit: text("einheit").notNull(),
    bildSchluessel: text("bild_schluessel"),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabelle) => [
    // Eine Menge von null würde beim Grundpreis durch null teilen.
    check("product_menge_positiv", sql`${tabelle.menge} > 0`),
    check("product_einheit_bekannt", sql`${tabelle.einheit} in ('G','ML','STK')`),
    check("product_name_nicht_leer", sql`btrim(${tabelle.name}) <> ''`),
  ],
);

/**
 * Strichcodes. Ein Produkt kann mehrere haben (Gebindewechsel, Regionen).
 *
 * Die Tabelle entsteht hier, obwohl erst Plan 3 sie füllt: Sie ist der Anker,
 * über den Barcode-Scan und Belegerkennung später ohne Ratespiel treffen.
 */
export const productEan = pgTable("product_ean", {
  ean: text("ean").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => product.id, { onDelete: "cascade" }),
});

/**
 * Die kettenspezifische Ausprägung eines Produkts.
 *
 * `rohNamen` sammelt die Kürzel, unter denen die Kette das Produkt schreibt
 * („BUTT.EXTRA 250"). Plan 4 nutzt sie für die Zuordnung von Belegzeilen;
 * hier entstehen sie schon, damit die Beobachtungen von Anfang an daran hängen.
 */
export const storeProduct = pgTable(
  "store_product",
  {
    id: text("id").primaryKey(),
    chainId: text("chain_id")
      .notNull()
      .references(() => chain.id),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    rohNamen: text("roh_namen").array().notNull().default(sql`'{}'::text[]`),
  },
  (tabelle) => [uniqueIndex("store_product_kette_produkt").on(tabelle.chainId, tabelle.productId)],
);
```

- [ ] **Step 4: Logik ergänzen**

In `src/lib/katalog.ts` anhängen:

```ts
import { eq } from "drizzle-orm";
import { product } from "@/db/schema/katalog";
import type { Basiseinheit } from "@/lib/einheiten";

export type Produkt = {
  id: string;
  name: string;
  marke: string | null;
  menge: number;
  einheit: Basiseinheit;
};

export async function legeProduktAn(
  db: ZugriffsDb,
  eingabe: { name: string; marke?: string | null; menge: number; einheit: Basiseinheit },
): Promise<Produkt> {
  const [zeile] = await db
    .insert(product)
    .values({
      id: randomUUID(),
      name: eingabe.name.trim(),
      marke: eingabe.marke?.trim() || null,
      menge: eingabe.menge,
      einheit: eingabe.einheit,
    })
    .returning({
      id: product.id,
      name: product.name,
      marke: product.marke,
      menge: product.menge,
      einheit: product.einheit,
    });

  return zeile as Produkt;
}

export async function holeProdukt(db: ZugriffsDb, id: string): Promise<Produkt | null> {
  const [zeile] = await db
    .select({
      id: product.id,
      name: product.name,
      marke: product.marke,
      menge: product.menge,
      einheit: product.einheit,
    })
    .from(product)
    .where(eq(product.id, id))
    .limit(1);

  return (zeile as Produkt | undefined) ?? null;
}
```

- [ ] **Step 5: Test laufen lassen und Erfolg bestätigen**

Run: `bun test tests/katalog-produkte.test.ts`
Expected: PASS, 7 pass 0 fail

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/katalog.ts src/lib/katalog.ts tests/katalog-produkte.test.ts
git commit -m "feat: Produkte, Strichcodes und Ketten-Produkte"
```

---

## Task 4: Preisbeobachtungen

**Files:**
- Create: `src/db/schema/preise.ts`
- Test: `tests/preise-schema.test.ts`

**Interfaces:**
- Consumes: `chain`, `product`, `storeProduct` aus Task 1/3
- Produces:
  - Tabelle `price_observation` mit `id`, `storeProductId`, `chainId`, `productId`, `beobachtetAm`, `quelle`, `preisart`, `einzelpreis`, `menge`, `zeilensumme`, `grundpreis`, `aktionsHinweis`, `aktionGueltigBis`, `pfandBetrag`, `konfidenz`, `pruefenNoetig`
  - Tabelle `offer` mit `id`, `storeProductId`, `preis`, `gueltigVon`, `gueltigBis`, `bedingung`, `quelle`
  - `type Quelle = "RECEIPT" | "BARCODE" | "MANUAL" | "CHAIN_API" | "FLYER"`
  - `type Preisart = "NORMAL" | "PROMO" | "LOYALTY" | "MULTIBUY"`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/preise-schema.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { priceObservation } from "@/db/schema/preise";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

let umgebung: TestDatenbank;

beforeAll(async () => {
  umgebung = await starteTestDatenbank();
  await umgebung.db.execute(sql`
    create table price_observation (
      id text primary key,
      store_product_id text not null,
      chain_id text not null,
      product_id text not null,
      beobachtet_am timestamptz not null default now(),
      quelle text not null,
      preisart text not null,
      einzelpreis numeric(10,4) not null,
      menge numeric(10,3) not null default 1,
      zeilensumme numeric(10,4) not null,
      grundpreis numeric(12,4) not null,
      aktions_hinweis text,
      aktion_gueltig_bis timestamptz,
      pfand_betrag numeric(10,4) not null default 0,
      konfidenz numeric(4,3) not null default 1,
      pruefen_noetig boolean not null default false,
      constraint preis_quelle_bekannt check (quelle in ('RECEIPT','BARCODE','MANUAL','CHAIN_API','FLYER')),
      constraint preis_art_bekannt check (preisart in ('NORMAL','PROMO','LOYALTY','MULTIBUY')),
      constraint preis_positiv check (einzelpreis > 0 and zeilensumme > 0 and grundpreis > 0),
      constraint preis_aktion_hat_ende check (preisart <> 'PROMO' or aktion_gueltig_bis is not null)
    )
  `);
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

const basis = {
  storeProductId: "sp1",
  chainId: "c1",
  productId: "p1",
  quelle: "MANUAL" as const,
  einzelpreis: "2.49",
  zeilensumme: "2.49",
  grundpreis: "9.96",
};

describe("Datenbank-Bedingungen der Preisbeobachtung", () => {
  it("nimmt eine gültige Normalpreis-Beobachtung an", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(priceObservation).values({ id: "1", ...basis, preisart: "NORMAL" }),
    );
    expect(fehler).toBeUndefined();
  });

  it("verweigert eine unbekannte Quelle", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db
        .insert(priceObservation)
        .values({ id: "2", ...basis, preisart: "NORMAL", quelle: "ERFUNDEN" as never }),
    );
    expect(fehler).toBeDefined();
  });

  it("verweigert eine unbekannte Preisart", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db
        .insert(priceObservation)
        .values({ id: "3", ...basis, preisart: "RABATT" as never }),
    );
    expect(fehler).toBeDefined();
  });

  it("verweigert einen Preis von null", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db
        .insert(priceObservation)
        .values({ id: "4", ...basis, preisart: "NORMAL", einzelpreis: "0" }),
    );
    expect(fehler).toBeDefined();
  });

  // Eine Aktion ohne Ende wäre keine Aktion, sondern der neue Normalpreis —
  // und würde den Bestpreis für immer verfälschen.
  it("verweigert eine Aktion ohne Gültig-bis", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(priceObservation).values({ id: "5", ...basis, preisart: "PROMO" }),
    );
    expect(fehler).toBeDefined();
  });

  it("nimmt eine Aktion mit Gültig-bis an", async () => {
    const fehler = await faengtFehler(() =>
      umgebung.db.insert(priceObservation).values({
        id: "6",
        ...basis,
        preisart: "PROMO",
        aktionGueltigBis: new Date(Date.now() + 86_400_000),
      }),
    );
    expect(fehler).toBeUndefined();
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `bun test tests/preise-schema.test.ts`
Expected: FAIL — `Cannot find module '@/db/schema/preise'`

- [ ] **Step 3: Implementierung**

`src/db/schema/preise.ts`:

```ts
import { sql } from "drizzle-orm";
import { boolean, check, index, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { chain, product, storeProduct } from "@/db/schema/katalog";

export type Quelle = "RECEIPT" | "BARCODE" | "MANUAL" | "CHAIN_API" | "FLYER";
export type Preisart = "NORMAL" | "PROMO" | "LOYALTY" | "MULTIBUY";

/**
 * Jede beobachtete Preiszeile — append-only, nichts wird korrigiert.
 *
 * Warum nichts überschrieben wird: Ein Preis ist eine Tatsache zu einem
 * Zeitpunkt, keine Eigenschaft eines Produkts. Wer eine Beobachtung ändert,
 * verliert die Vergangenheit, aus der der Referenzpreis entsteht.
 *
 * Warum `numeric` und nicht `real`: Geld in Gleitkomma zu halten erzeugt
 * Abweichungen, die sich über Summen aufaddieren. `numeric` rechnet exakt.
 * Drizzle liefert es als String zurück — das ist Absicht, nicht ein Mangel.
 */
export const priceObservation = pgTable(
  "price_observation",
  {
    id: text("id").primaryKey(),
    storeProductId: text("store_product_id")
      .notNull()
      .references(() => storeProduct.id, { onDelete: "cascade" }),
    /** Redundant zu store_product, aber jede Abfrage filtert danach. */
    chainId: text("chain_id")
      .notNull()
      .references(() => chain.id),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    beobachtetAm: timestamp("beobachtet_am", { withTimezone: true }).notNull().defaultNow(),
    quelle: text("quelle").notNull(),
    preisart: text("preisart").notNull(),
    einzelpreis: numeric("einzelpreis", { precision: 10, scale: 4 }).notNull(),
    menge: numeric("menge", { precision: 10, scale: 3 }).notNull().default("1"),
    zeilensumme: numeric("zeilensumme", { precision: 10, scale: 4 }).notNull(),
    /** Preis je Kilogramm, Liter oder Stück — die einzige vergleichbare Zahl. */
    grundpreis: numeric("grundpreis", { precision: 12, scale: 4 }).notNull(),
    aktionsHinweis: text("aktions_hinweis"),
    aktionGueltigBis: timestamp("aktion_gueltig_bis", { withTimezone: true }),
    /** Einwegpfand, aus dem Einzelpreis bereits herausgerechnet. */
    pfandBetrag: numeric("pfand_betrag", { precision: 10, scale: 4 }).notNull().default("0"),
    konfidenz: numeric("konfidenz", { precision: 4, scale: 3 }).notNull().default("1"),
    pruefenNoetig: boolean("pruefen_noetig").notNull().default(false),
  },
  (tabelle) => [
    check(
      "preis_quelle_bekannt",
      sql`${tabelle.quelle} in ('RECEIPT','BARCODE','MANUAL','CHAIN_API','FLYER')`,
    ),
    check("preis_art_bekannt", sql`${tabelle.preisart} in ('NORMAL','PROMO','LOYALTY','MULTIBUY')`),
    check(
      "preis_positiv",
      sql`${tabelle.einzelpreis} > 0 and ${tabelle.zeilensumme} > 0 and ${tabelle.grundpreis} > 0`,
    ),
    // Eine Aktion ohne Ende ist keine Aktion, sondern der neue Normalpreis.
    // Ohne diese Bedingung würde sie den Bestpreis für immer verfälschen.
    check(
      "preis_aktion_hat_ende",
      sql`${tabelle.preisart} <> 'PROMO' or ${tabelle.aktionGueltigBis} is not null`,
    ),
    index("preis_produkt_kette_zeit").on(tabelle.productId, tabelle.chainId, tabelle.beobachtetAm),
  ],
);

/**
 * Laufende Aktionen aus Ketten-Schnittstellen oder Flugblättern.
 *
 * Bewusst getrennt von den Beobachtungen: Eine Beobachtung ist etwas, das
 * bereits bezahlt wurde. Eine Aktion ist eine Ankündigung für die Zukunft.
 * Erst Plan 3 füllt diese Tabelle; sie entsteht hier, weil die Bestpreis-Logik
 * sie sonst nicht abfragen könnte.
 */
export const offer = pgTable(
  "offer",
  {
    id: text("id").primaryKey(),
    storeProductId: text("store_product_id")
      .notNull()
      .references(() => storeProduct.id, { onDelete: "cascade" }),
    preis: numeric("preis", { precision: 10, scale: 4 }).notNull(),
    gueltigVon: timestamp("gueltig_von", { withTimezone: true }).notNull(),
    gueltigBis: timestamp("gueltig_bis", { withTimezone: true }).notNull(),
    bedingung: text("bedingung"),
    quelle: text("quelle").notNull(),
  },
  (tabelle) => [
    check("offer_zeitraum", sql`${tabelle.gueltigBis} > ${tabelle.gueltigVon}`),
    check("offer_preis_positiv", sql`${tabelle.preis} > 0`),
  ],
);
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `bun test tests/preise-schema.test.ts`
Expected: PASS, 6 pass 0 fail

- [ ] **Step 5: Migration erzeugen und anwenden**

```bash
bunx drizzle-kit generate
docker compose up -d postgres
bunx drizzle-kit migrate
```

Prüfen, dass die erzeugte Migration alle Bedingungen enthält — insbesondere `preis_aktion_hat_ende`.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/preise.ts tests/preise-schema.test.ts drizzle
git commit -m "feat: Preisbeobachtungen und Aktionen"
```

---

## Task 5: Median

**Files:**
- Create: `src/lib/median.ts`
- Test: `tests/median.test.ts`

Eigene Datei, weil auf dieser Funktion die zentrale Aussage der App ruht. Sie soll ohne Datenbank, ohne Kontext und ohne Ausreden testbar sein.

**Interfaces:**
- Produces: `median(werte: readonly number[]): number | null`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/median.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { median } from "@/lib/median";

describe("median", () => {
  it("liefert null bei leerer Liste", () => {
    expect(median([])).toBeNull();
  });

  it("liefert den Wert selbst bei einem Element", () => {
    expect(median([2.49])).toBe(2.49);
  });

  it("nimmt bei ungerader Anzahl den mittleren Wert", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("mittelt bei gerader Anzahl die beiden mittleren", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("ist unempfindlich gegen einen Ausreißer", () => {
    // Genau dafür ist der Median da: ein Tippfehler bei der Erfassung
    // (299 statt 2,99) darf die Aussage nicht verschieben.
    expect(median([2.49, 2.59, 2.45, 299])).toBeCloseTo(2.54, 4);
  });

  it("verändert die übergebene Liste nicht", () => {
    const eingabe = [3, 1, 2];
    median(eingabe);
    expect(eingabe).toEqual([3, 1, 2]);
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `bun test tests/median.test.ts`
Expected: FAIL — `Cannot find module '@/lib/median'`

- [ ] **Step 3: Implementierung**

`src/lib/median.ts`:

```ts
/**
 * Median einer Zahlenreihe.
 *
 * Warum Median und nicht Durchschnitt: Ein einzelner Tippfehler bei der
 * Erfassung — 299 statt 2,99 — verschiebt einen Durchschnitt dauerhaft und
 * unauffällig. Der Median ignoriert ihn.
 */
export function median(werte: readonly number[]): number | null {
  if (werte.length === 0) return null;

  // Kopie: die Aufrufer übergeben oft Ergebnisse, die sie danach weiter
  // benutzen. Ein sortierendes Nebenwirkungen-Rätsel will hier niemand.
  // Nicht-Zahlen fliegen raus, bevor sortiert wird. Der Vergleicher `a - b`
  // liefert bei NaN selbst NaN, und das ist für `sort()` undefiniertes
  // Verhalten: bei kurzen Listen kommt NaN heraus — sichtbar —, ab neun Werten
  // bleibt der NaN unsortiert am Rand liegen und die Funktion liefert eine
  // völlig normale, falsche Zahl. Das Filtern ist derselbe Gedanke wie beim
  // Ausreißer: ein Wert, der nicht in die Ordnung gehört, darf die Aussage
  // nicht verschieben.
  //
  // `filter` erzeugt zugleich die nötige Kopie — die Aufrufer benutzen ihre
  // Liste danach weiter, ein sortierendes Nebenwirkungs-Rätsel will hier
  // niemand.
  const sortiert = werte.filter(Number.isFinite).sort((a, b) => a - b);
  if (sortiert.length === 0) return null;
  const mitte = Math.floor(sortiert.length / 2);

  return sortiert.length % 2 === 1 ? sortiert[mitte] : (sortiert[mitte - 1] + sortiert[mitte]) / 2;
}
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `bun test tests/median.test.ts`
Expected: PASS, 6 pass 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/lib/median.ts tests/median.test.ts
git commit -m "feat: Median als eigene, geprüfte Funktion"
```

---

## Task 6: Die Preis-Engine

Das Herzstück. Hier entstehen die beiden Zahlen, wegen derer es die App gibt.

**Files:**
- Create: `src/lib/preise.ts`
- Test: `tests/preise.test.ts`

**Interfaces:**
- Consumes: `median` aus `@/lib/median`; `priceObservation`, `offer` aus `@/db/schema/preise`; `chain` aus `@/db/schema/katalog`
- Produces:
  - `BEOBACHTUNGSFENSTER_TAGE = 180`, `JUENGSTE_BEOBACHTUNGEN = 5`
  - `schreibeBeobachtung(db, eingabe): Promise<void>` mit `eingabe = { storeProductId, chainId, productId, quelle, preisart, einzelpreis, menge?, zeilensumme, grundpreis, aktionsHinweis?, aktionGueltigBis? }`
  - `holePreisMatrix(db, productId): Promise<PreisZeile[]>`
  - `PreisZeile = { kette: Kette; referenzpreis: number | null; anzahl: number; letzteBeobachtung: Date | null; aktion: { preis: number; gueltigBis: Date } | null; bestpreis: number | null }`
  - `bestesAngebot(zeilen: PreisZeile[]): { referenzSieger: PreisZeile | null; heuteSieger: PreisZeile | null }`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/preise.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { bestesAngebot, holePreisMatrix, schreibeBeobachtung } from "@/lib/preise";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";

let umgebung: TestDatenbank;

/** Legt Ketten, ein Produkt und die Ketten-Produkte an. */
async function grundgeruest() {
  // Vollständiges DDL siehe Tasks 1, 3 und 4 — hier identisch anlegen.
  // Danach: fünf Ketten, ein Produkt "Butter 250 g", je ein store_product.
}

beforeAll(async () => {
  umgebung = await starteTestDatenbank();
  await grundgeruest();
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table price_observation, offer`);
});

describe("Referenzpreis", () => {
  it("ist null, solange nichts beobachtet wurde", async () => {
    const zeilen = await holePreisMatrix(umgebung.db, "p1");
    expect(zeilen.every((z) => z.referenzpreis === null)).toBe(true);
  });

  it("ist der Median der Normalpreis-Beobachtungen", async () => {
    for (const preis of [9.6, 9.96, 10.4]) {
      await schreibeBeobachtung(umgebung.db, {
        storeProductId: "sp-spar",
        chainId: "c-spar",
        productId: "p1",
        quelle: "MANUAL",
        preisart: "NORMAL",
        einzelpreis: 2.49,
        zeilensumme: 2.49,
        grundpreis: preis,
      });
    }

    const spar = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "spar");
    expect(spar?.referenzpreis).toBeCloseTo(9.96, 4);
    expect(spar?.anzahl).toBe(3);
  });

  it("ignoriert Aktionspreise", async () => {
    await schreibeBeobachtung(umgebung.db, {
      storeProductId: "sp-spar", chainId: "c-spar", productId: "p1",
      quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 2.49, zeilensumme: 2.49, grundpreis: 9.96,
    });
    await schreibeBeobachtung(umgebung.db, {
      storeProductId: "sp-spar", chainId: "c-spar", productId: "p1",
      quelle: "MANUAL", preisart: "PROMO", einzelpreis: 1.49, zeilensumme: 1.49, grundpreis: 5.96,
      aktionGueltigBis: new Date(Date.now() + 86_400_000),
    });

    const spar = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "spar");
    expect(spar?.referenzpreis).toBeCloseTo(9.96, 4);
  });

  it("ignoriert Beobachtungen, die älter als das Fenster sind", async () => {
    await umgebung.db.execute(sql`
      insert into price_observation
        (id, store_product_id, chain_id, product_id, beobachtet_am, quelle, preisart,
         einzelpreis, zeilensumme, grundpreis)
      values ('alt', 'sp-spar', 'c-spar', 'p1', now() - interval '200 days', 'MANUAL', 'NORMAL',
              1, 1, 4.00)
    `);

    const spar = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "spar");
    expect(spar?.referenzpreis).toBeNull();
    expect(spar?.anzahl).toBe(0);
  });

  it("nimmt nur die jüngsten fünf Beobachtungen", async () => {
    // Sechs alte teure, danach fünf junge günstige. Ohne die Begrenzung läge
    // der Median bei den teuren; mit ihr bei den günstigen.
    for (let i = 0; i < 6; i++) {
      await umgebung.db.execute(sql`
        insert into price_observation
          (id, store_product_id, chain_id, product_id, beobachtet_am, quelle, preisart,
           einzelpreis, zeilensumme, grundpreis)
        values (${"teuer" + i}, 'sp-spar', 'c-spar', 'p1', now() - interval '100 days',
                'MANUAL', 'NORMAL', 1, 1, 20.00)
      `);
    }
    for (let i = 0; i < 5; i++) {
      await schreibeBeobachtung(umgebung.db, {
        storeProductId: "sp-spar", chainId: "c-spar", productId: "p1",
        quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 1, zeilensumme: 1, grundpreis: 10,
      });
    }

    const spar = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "spar");
    expect(spar?.referenzpreis).toBeCloseTo(10, 4);
  });
});

describe("Aktueller Bestpreis", () => {
  it("entspricht dem Referenzpreis, wenn keine Aktion läuft", async () => {
    await schreibeBeobachtung(umgebung.db, {
      storeProductId: "sp-spar", chainId: "c-spar", productId: "p1",
      quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 2.49, zeilensumme: 2.49, grundpreis: 9.96,
    });

    const spar = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "spar");
    expect(spar?.bestpreis).toBeCloseTo(9.96, 4);
    expect(spar?.aktion).toBeNull();
  });

  it("nimmt die laufende Aktion, wenn sie günstiger ist", async () => {
    await schreibeBeobachtung(umgebung.db, {
      storeProductId: "sp-hofer", chainId: "c-hofer", productId: "p1",
      quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 2.79, zeilensumme: 2.79, grundpreis: 11.16,
    });
    await umgebung.db.execute(sql`
      insert into offer (id, store_product_id, preis, gueltig_von, gueltig_bis, quelle)
      values ('a1', 'sp-hofer', 8.76, now() - interval '1 day', now() + interval '5 days', 'FLYER')
    `);

    const hofer = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "hofer");
    expect(hofer?.bestpreis).toBeCloseTo(8.76, 4);
    expect(hofer?.aktion?.preis).toBeCloseTo(8.76, 4);
  });

  it("ignoriert eine abgelaufene Aktion", async () => {
    await schreibeBeobachtung(umgebung.db, {
      storeProductId: "sp-hofer", chainId: "c-hofer", productId: "p1",
      quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 2.79, zeilensumme: 2.79, grundpreis: 11.16,
    });
    await umgebung.db.execute(sql`
      insert into offer (id, store_product_id, preis, gueltig_von, gueltig_bis, quelle)
      values ('a2', 'sp-hofer', 1.00, now() - interval '10 days', now() - interval '1 day', 'FLYER')
    `);

    const hofer = (await holePreisMatrix(umgebung.db, "p1")).find((z) => z.kette.kuerzel === "hofer");
    expect(hofer?.bestpreis).toBeCloseTo(11.16, 4);
    expect(hofer?.aktion).toBeNull();
  });
});

describe("bestesAngebot — das Butter-Szenario", () => {
  it("trennt Referenz-Sieger und Heute-Sieger", async () => {
    // Spar ist normal günstiger. Hofer hat diese Woche Aktion und gewinnt heute.
    await schreibeBeobachtung(umgebung.db, {
      storeProductId: "sp-spar", chainId: "c-spar", productId: "p1",
      quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 2.29, zeilensumme: 2.29, grundpreis: 9.16,
    });
    await schreibeBeobachtung(umgebung.db, {
      storeProductId: "sp-hofer", chainId: "c-hofer", productId: "p1",
      quelle: "MANUAL", preisart: "NORMAL", einzelpreis: 2.79, zeilensumme: 2.79, grundpreis: 11.16,
    });
    await umgebung.db.execute(sql`
      insert into offer (id, store_product_id, preis, gueltig_von, gueltig_bis, quelle)
      values ('a3', 'sp-hofer', 8.76, now() - interval '1 day', now() + interval '5 days', 'FLYER')
    `);

    const { referenzSieger, heuteSieger } = bestesAngebot(await holePreisMatrix(umgebung.db, "p1"));

    expect(referenzSieger?.kette.kuerzel).toBe("spar");
    expect(heuteSieger?.kette.kuerzel).toBe("hofer");
  });

  it("liefert null, wenn es nirgends Daten gibt", async () => {
    const { referenzSieger, heuteSieger } = bestesAngebot(await holePreisMatrix(umgebung.db, "p1"));
    expect(referenzSieger).toBeNull();
    expect(heuteSieger).toBeNull();
  });
});
```

- [ ] **Step 2: Das Grundgerüst im Test vervollständigen**

`grundgeruest()` legt die Tabellen `chain`, `product`, `store_product`, `price_observation` und `offer` mit dem DDL aus den Tasks 1, 3 und 4 an, danach fünf Ketten mit den Kennungen `c-billa` … `c-penny`, ein Produkt `p1` („Butter", 250 g) und fünf `store_product`-Zeilen `sp-billa` … `sp-penny`.

Alternativ die erzeugte Migration anwenden — sauberer, weil die Testdatenbank dann exakt der Produktionsdatenbank entspricht:

```ts
import { migrate } from "drizzle-orm/node-postgres/migrator";
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });
```

Diese Variante bevorzugen, wenn sie läuft.

- [ ] **Step 3: Test laufen lassen und Fehlschlag bestätigen**

Run: `bun test tests/preise.test.ts`
Expected: FAIL — `Cannot find module '@/lib/preise'`

- [ ] **Step 4: Implementierung**

`src/lib/preise.ts`:

```ts
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { chain } from "@/db/schema/katalog";
import { offer, priceObservation, type Preisart, type Quelle } from "@/db/schema/preise";
import { holeKetten, type Kette } from "@/lib/katalog";
import { median } from "@/lib/median";
import type { ZugriffsDb } from "@/lib/zugriff";

/** Wie weit zurück eine Beobachtung noch als aussagekräftig gilt. */
export const BEOBACHTUNGSFENSTER_TAGE = 180;

/**
 * Wie viele der jüngsten Beobachtungen in den Median eingehen.
 *
 * Das ist die Umsetzung von „aktualitätsgewichtet": Statt einer Gewichtung,
 * die niemand nachrechnen kann, zählen schlicht die letzten fünf. Erklärbar
 * in einem Satz, festnagelbar in einem Test.
 */
export const JUENGSTE_BEOBACHTUNGEN = 5;

export type PreisZeile = {
  kette: Kette;
  referenzpreis: number | null;
  anzahl: number;
  letzteBeobachtung: Date | null;
  aktion: { preis: number; gueltigBis: Date } | null;
  bestpreis: number | null;
};

export async function schreibeBeobachtung(
  db: ZugriffsDb,
  eingabe: {
    storeProductId: string;
    chainId: string;
    productId: string;
    quelle: Quelle;
    preisart: Preisart;
    einzelpreis: number;
    menge?: number;
    zeilensumme: number;
    grundpreis: number;
    aktionsHinweis?: string | null;
    aktionGueltigBis?: Date | null;
  },
): Promise<void> {
  await db.insert(priceObservation).values({
    id: randomUUID(),
    storeProductId: eingabe.storeProductId,
    chainId: eingabe.chainId,
    productId: eingabe.productId,
    quelle: eingabe.quelle,
    preisart: eingabe.preisart,
    einzelpreis: eingabe.einzelpreis.toFixed(4),
    menge: (eingabe.menge ?? 1).toFixed(3),
    zeilensumme: eingabe.zeilensumme.toFixed(4),
    grundpreis: eingabe.grundpreis.toFixed(4),
    aktionsHinweis: eingabe.aktionsHinweis ?? null,
    aktionGueltigBis: eingabe.aktionGueltigBis ?? null,
  });
}

/** Referenzpreis und aktueller Bestpreis, eine Zeile je Kette. */
export async function holePreisMatrix(db: ZugriffsDb, productId: string): Promise<PreisZeile[]> {
  const ketten = await holeKetten(db);
  const grenze = new Date(Date.now() - BEOBACHTUNGSFENSTER_TAGE * 86_400_000);
  const jetzt = new Date();

  const zeilen: PreisZeile[] = [];

  for (const kette of ketten) {
    const beobachtungen = await db
      .select({
        grundpreis: priceObservation.grundpreis,
        beobachtetAm: priceObservation.beobachtetAm,
      })
      .from(priceObservation)
      .where(
        and(
          eq(priceObservation.productId, productId),
          eq(priceObservation.chainId, kette.id),
          // Nur Normalpreise. Aktionen sind der Grund, warum es diese
          // Trennung gibt — sie dürfen den Referenzpreis nicht verschieben.
          eq(priceObservation.preisart, "NORMAL"),
          gte(priceObservation.beobachtetAm, grenze),
        ),
      )
      .orderBy(desc(priceObservation.beobachtetAm))
      .limit(JUENGSTE_BEOBACHTUNGEN);

    const referenzpreis = median(beobachtungen.map((b) => Number(b.grundpreis)));

    const [laufende] = await db
      .select({ preis: offer.preis, gueltigBis: offer.gueltigBis })
      .from(offer)
      .innerJoin(
        sql`store_product`,
        sql`store_product.id = ${offer.storeProductId} and store_product.chain_id = ${kette.id} and store_product.product_id = ${productId}`,
      )
      .where(and(lte(offer.gueltigVon, jetzt), gt(offer.gueltigBis, jetzt)))
      .orderBy(offer.preis)
      .limit(1);

    const aktion = laufende
      ? { preis: Number(laufende.preis), gueltigBis: laufende.gueltigBis }
      : null;

    const bestpreis =
      aktion && referenzpreis !== null
        ? Math.min(aktion.preis, referenzpreis)
        : (aktion?.preis ?? referenzpreis);

    zeilen.push({
      kette,
      referenzpreis,
      anzahl: beobachtungen.length,
      letzteBeobachtung: beobachtungen[0]?.beobachtetAm ?? null,
      aktion: aktion && bestpreis === aktion.preis ? aktion : null,
      bestpreis,
    });
  }

  return zeilen;
}

/**
 * Wer gewinnt langfristig, wer heute.
 *
 * Beide gleichzeitig, weil beide stimmen: Hofer kann normal teurer sein als
 * Spar und trotzdem diese Woche der richtige Weg sein.
 */
export function bestesAngebot(zeilen: PreisZeile[]): {
  referenzSieger: PreisZeile | null;
  heuteSieger: PreisZeile | null;
} {
  const mitReferenz = zeilen.filter((z) => z.referenzpreis !== null);
  const mitBest = zeilen.filter((z) => z.bestpreis !== null);

  const kleinster = <T>(liste: T[], wert: (e: T) => number): T | null =>
    liste.length === 0 ? null : liste.reduce((a, b) => (wert(b) < wert(a) ? b : a));

  return {
    referenzSieger: kleinster(mitReferenz, (z) => z.referenzpreis!),
    heuteSieger: kleinster(mitBest, (z) => z.bestpreis!),
  };
}
```

- [ ] **Step 5: Test laufen lassen und Erfolg bestätigen**

Run: `bun test tests/preise.test.ts`
Expected: PASS, 10 pass 0 fail

Falls der `innerJoin` mit rohem SQL nicht typprüft: die Aktion in zwei Schritten holen — erst die `storeProduct`-Kennung für Kette und Produkt, dann die Aktion darauf. Lesbarer und ohne rohes SQL; das Ergebnis muss identisch sein.

- [ ] **Step 6: Commit**

```bash
git add src/lib/preise.ts tests/preise.test.ts
git commit -m "feat: Referenzpreis und aktueller Bestpreis"
```

---

## Task 7: Manuelle Preiserfassung

> **Gestaltungspflicht.** Vor dem ersten Code die Skills `impeccable`, `ui-ux-pro-max` und `frontend-design` aufrufen und deren Ergebnis umsetzen. Das Markup unten legt Struktur und Verhalten fest, nicht die Gestaltung.
>
> Dieses Formular ist der einzige Weg, wie in Plan 2 Daten in die App kommen — und der Weg, den Christopher benutzt, während er vor dem Regal steht oder den Beleg in der Hand hält. Es muss auf einem Handy mit einer Hand bedienbar sein und darf beim zweiten Produkt nicht mehr Arbeit machen als beim ersten. Nach dem Speichern bleibt die Kette gewählt: Man erfasst mehrere Preise desselben Einkaufs hintereinander, nicht einen.
>
> Der zweite Bildschirm, den es zu gestalten gilt, ist der Erfolgsfall: Was passiert, nachdem gespeichert wurde? Eine Bestätigung, die verschwindet, und ein leeres Formular ist die schwächste Antwort. Der berechnete Grundpreis ist die interessante Information — er sagt sofort, ob sich das Angebot lohnt.

**Files:**
- Create: `src/app/erfassen/page.tsx`, `src/app/erfassen/aktionen.ts`, `src/app/erfassen/erfassungs-formular.tsx`
- Test: `tests/erfassen-aktionen.test.ts`, `tests/erfassungs-formular.test.tsx`

**Interfaces:**
- Consumes: `requireUser` aus `@/lib/sitzung`; `holeKetten`, `legeProduktAn` aus `@/lib/katalog`; `zerlegeMenge`, `grundpreis` aus `@/lib/einheiten`; `schreibeBeobachtung` aus `@/lib/preise`
- Produces: Server-Aktion `erfasse(vorher, formular): Promise<Ergebnis>` mit `Ergebnis = { art: "erfolg"; produktId: string; grundpreis: string } | { art: "fehler"; meldung: string }`

- [ ] **Step 1: Den fehlschlagenden Test für die Server-Aktion schreiben**

`tests/erfassen-aktionen.test.ts` prüft gegen eine echte Testdatenbank:

```ts
```ts
/** Baut ein FormData wie es das Formular schickt. */
function formular(felder: Record<string, string>): FormData {
  const daten = new FormData();
  for (const [schluessel, wert] of Object.entries(felder)) daten.set(schluessel, wert);
  return daten;
}

const gueltig = {
  kette: "billa",
  name: "Butter",
  menge: "250 g",
  preis: "2,49",
  preisart: "NORMAL",
};

async function anzahlBeobachtungen(): Promise<number> {
  const [zeile] = await umgebung.db.execute(sql`select count(*)::int as n from price_observation`)
    .then((e) => e.rows as { n: number }[]);
  return zeile.n;
}

describe("erfasse", () => {
  it("legt Produkt und Beobachtung an und liefert den Grundpreis", async () => {
    const ergebnis = await erfasse(undefined, formular(gueltig));

    expect(ergebnis.art).toBe("erfolg");
    if (ergebnis.art !== "erfolg") return;
    expect(ergebnis.grundpreis).toBe("9,96 €/kg");
    expect(await anzahlBeobachtungen()).toBe(1);
  });

  it("weist eine unverständliche Mengenangabe ab, ohne etwas anzulegen", async () => {
    const ergebnis = await erfasse(undefined, formular({ ...gueltig, menge: "ein bisschen" }));

    expect(ergebnis.art).toBe("fehler");
    // Die Meldung allein beweist nichts — die Datenbank muss unberührt sein.
    expect(await anzahlBeobachtungen()).toBe(0);
  });

  it("weist einen Preis von null ab, ohne etwas anzulegen", async () => {
    const ergebnis = await erfasse(undefined, formular({ ...gueltig, preis: "0" }));

    expect(ergebnis.art).toBe("fehler");
    expect(await anzahlBeobachtungen()).toBe(0);
  });

  it("verlangt eine Aktions-Gültigkeit, wenn Aktion gewählt ist", async () => {
    const ergebnis = await erfasse(undefined, formular({ ...gueltig, preisart: "PROMO" }));

    expect(ergebnis.art).toBe("fehler");
    expect(await anzahlBeobachtungen()).toBe(0);
  });

  it("nimmt eine Aktion mit Gültig-bis an", async () => {
    const ergebnis = await erfasse(
      undefined,
      formular({ ...gueltig, preisart: "PROMO", gueltigBis: "2099-12-31" }),
    );

    expect(ergebnis.art).toBe("erfolg");
    expect(await anzahlBeobachtungen()).toBe(1);
  });

  it("verlangt eine Anmeldung", async () => {
    // requireUser wird in diesem Test so ersetzt, dass es wirft — wie es das
    // bei fehlender Sitzung tut. Muster siehe tests/verwaltung-aktionen.test.ts:
    // das Modul vollständig spreaden und nur requireUser überschreiben.
    const fehler = await faengtFehler(() => erfasse(undefined, formular(gueltig)));

    expect(fehler).toBeDefined();
    expect(await anzahlBeobachtungen()).toBe(0);
  });
});
```
```

Jeder Fehlerfall muss zusätzlich belegen, dass **nichts** angelegt wurde — eine Fehlermeldung allein beweist nicht, dass die Datenbank unberührt blieb. Das ist dasselbe Muster, mit dem in Phase 1 die Wirksamkeit der Rollenprüfung belegt wurde.

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `bun test tests/erfassen-aktionen.test.ts`
Expected: FAIL — Modul fehlt

- [ ] **Step 3: Server-Aktion implementieren**

`src/app/erfassen/aktionen.ts` — `"use server"`, `requireUser()` als **erste** Anweisung, danach: Mengenangabe zerlegen (`null` → Fehler), Preis prüfen, Produkt anlegen oder finden, `storeProduct` sicherstellen, Grundpreis berechnen, Beobachtung schreiben, `revalidatePath` auf die Produktseite.

Bei `preisart === "PROMO"` ist `aktionGueltigBis` Pflicht — sonst greift die Datenbank-Bedingung aus Task 4 und der Nutzer bekommt einen technischen Fehler statt einer Erklärung.

- [ ] **Step 4: Formular implementieren**

Felder: Kette (Auswahl, bleibt nach dem Speichern stehen), Produktname, Marke (optional), Menge als Text (`"250 g"`), Preis, Preisart (Normal / Aktion / Treuekarte / Mengenrabatt), bei Aktion zusätzlich Gültig-bis.

Der Grundpreis wird **live** berechnet und angezeigt, sobald Menge und Preis gültig sind — nicht erst nach dem Speichern. Das ist die Information, wegen der man erfasst.

- [ ] **Step 5: Beide Tests grün, dann im Browser ansehen**

Handy- und Desktopbreite, Konsole auf Verstöße gegen die Sicherheitsrichtlinie prüfen. Aufnahmen nach `docs/bilder/`, vorher die alten löschen, danach jede einzeln ansehen.

- [ ] **Step 6: Commit**

```bash
git add src/app/erfassen tests/erfassen-aktionen.test.ts tests/erfassungs-formular.test.tsx docs/bilder
git commit -m "feat: manuelle Preiserfassung"
```

---

## Task 8: Produktsuche und Produktdetail

> **Gestaltungspflicht.** Skills `impeccable`, `ui-ux-pro-max`, `frontend-design` aufrufen.
>
> Hier wird die zweischichtige Richtung zum ersten Mal wörtlich: Die Suchergebnisse und der Kopf der Detailseite gehören zur ruhigen Ebene — großer Preis, ein Satz Kontext, eine Aktion. Die Tabelle darunter ist die dichte Ebene und darf Tabellenziffern, Datenalter und Beobachtungszahl zeigen. `--font-zahlen` (Martian Mono) ist dafür reserviert; **vor dem Festlegen ausprobieren** — es ist eine breite Schrift und frisst in schmalen Spalten Platz.
>
> Der wichtigste Zustand ist der leere: ein Produkt, zu dem es in einer Kette keine Daten gibt. „Keine Daten" ist eine Aussage, kein Fehler — und sie muss sich von „teuer" unterscheiden lassen. Ebenso ein veralteter Wert: Ein Referenzpreis aus einer 170 Tage alten Beobachtung ist etwas anderes als einer von gestern, und der Bildschirm muss das zeigen.

**Files:**
- Create: `src/app/produkte/page.tsx`, `src/app/produkte/[id]/page.tsx`, `src/app/produkte/[id]/preis-tabelle.tsx`
- Modify: `src/lib/katalog.ts` — `sucheProdukte(db, begriff): Promise<Produkt[]>`
- Test: `tests/katalog-suche.test.ts`, `tests/preis-tabelle.test.tsx`

**Interfaces:**
- Consumes: `holePreisMatrix`, `bestesAngebot` aus `@/lib/preise`; `formatiereGrundpreis` aus `@/lib/einheiten`
- Produces: `sucheProdukte(db, begriff)` — findet über Trigram-Ähnlichkeit auf `name` und `marke`, Schwelle 0.3, sortiert nach Ähnlichkeit

- [ ] **Step 1: Den fehlschlagenden Test für die Suche schreiben**

Fälle: exakter Treffer; Treffer trotz Tippfehler (`"Buter"` findet `"Butter"`); Treffer über die Marke; leerer Begriff liefert nichts statt alles; kein Treffer liefert leere Liste.

`pg_trgm` ist in `tests/helfer/db.ts` bereits aktiviert.

- [ ] **Step 2: Suche implementieren**

`similarity()` aus `pg_trgm`, Schwelle 0.3, `order by similarity desc`. Ein GIN-Index auf `name` gehört ins Schema, sobald der Katalog wächst — für Plan 2 mit wenigen hundert Produkten nicht nötig, aber im Code vermerken.

- [ ] **Step 3: Detailseite und Preistabelle**

Die Seite ruft `holePreisMatrix` und `bestesAngebot`. Oben: der Heute-Sieger groß, mit Ersparnis gegenüber der teuersten Kette und Gültig-bis bei Aktion. Darunter, eine Zeile: der Referenz-Sieger. Dahinter auf Tap die Tabelle mit allen fünf Ketten.

- [ ] **Step 4: Komponenten-Test der Tabelle**

Prüft: alle fünf Ketten erscheinen; eine Kette ohne Daten zeigt „keine Daten" statt einer Null; ein Wert älter als 90 Tage ist als veraltet gekennzeichnet; eine laufende Aktion nennt das Gültig-bis.

- [ ] **Step 5: Im Browser ansehen, Aufnahmen erzeugen**

- [ ] **Step 6: Commit**

```bash
git add src/app/produkte src/lib/katalog.ts tests/katalog-suche.test.ts tests/preis-tabelle.test.tsx docs/bilder
git commit -m "feat: Produktsuche und zweischichtiges Produktdetail"
```

---

## Task 9: Navigation und Gesamtverifikation

> **Gestaltungspflicht** für die Navigation. Skills aufrufen.

**Files:**
- Create: `src/components/app-navigation.tsx`
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`
- Test: `tests/app-navigation.test.tsx`

- [ ] **Step 1: Navigation**

Drei Ziele: Erfassen, Produkte, Zugriff (nur für die betreibende Person — `holeBerechtigung` aus `@/lib/sitzung` liefert `darfVerwalten`). Auf dem Handy unten, am Desktop oben. Der aktive Bereich ist erkennbar, und zwar nicht allein über Farbe.

- [ ] **Step 2: Startseite ersetzen**

`src/app/page.tsx` zeigt derzeit nur „Servus, {name}". Ersetzen durch den Einstieg: die zuletzt erfassten Preise und ein deutlicher Weg zum Erfassen.

- [ ] **Step 3: Gesamtverifikation**

```bash
docker compose up -d postgres-test
bun test
bunx tsc --noEmit
bun run build
```

Zusätzlich:
- Keine *Seite* ist in der Build-Ausgabe als `○` markiert (Asset-Routen dürfen).
- `git grep -nE "(GOCSPX-|sk-[A-Za-z0-9]{20,})" -- . ':!docs'` liefert nichts.
- Im Browser mit angemeldeter Sitzung: Erfassen, Suchen, Detail — Konsole ohne Verstöße gegen die Sicherheitsrichtlinie.

- [ ] **Step 4: Commit und Pull Request**

```bash
git add -A
git commit -m "feat: Navigation und Einstieg"
git push -u origin plan2/katalog-preis-engine
gh pr create --base main --title "Plan 2: Katalog und Preis-Engine" --body-file <beschreibung>
```

---

## Verifikation

**Plan 2 gilt als fertig, wenn:**

1. `bun test`, `bunx tsc --noEmit` und `bun run build` fehlerfrei durchlaufen
2. Das Butter-Szenario als Test existiert und besteht: Spar normal günstiger, Hofer heute per Aktion — beide Sieger werden getrennt ausgewiesen
3. Ein Tippfehler bei der Erfassung (299 statt 2,99) verschiebt den Referenzpreis nachweislich nicht
4. Eine Beobachtung älter als 180 Tage fließt nicht ein
5. Eine Aktion ohne Gültig-bis lässt sich nicht speichern — von der Datenbank verweigert, nicht nur vom Formular
6. Ein Produkt ohne Daten in einer Kette wird als „keine Daten" angezeigt, unterscheidbar von einem hohen Preis
7. Erfassen, Suchen und Detail sind auf einem Handy in der Hand bedienbar, im Browser geprüft, mit Aufnahmen belegt

## Offene Punkte

- **Aus Phase 1 mitgebracht:** `docs/offene-punkte.md`. Der erste Eintrag dort — der buchstabengenaue Vergleich beim Entzug — ist ein Einzeiler und kann in diesem Plan nebenbei mitlaufen.
- `ZugriffsDb` ist auf ein leeres Schema typisiert. Sobald Drizzle hier mit einem Schema-Objekt aufgerufen wird, muss der Typ mitziehen — als Übersetzungsfehler sichtbar, nicht stillschweigend.
- Der `pg_trgm`-Test aus Phase 1 prüft nur die Erweiterung. Task 8 benutzt sie erstmals wirklich; dort gehört ein Test hin, der eine Abfrage prüft.
- Produktbilder und Barcode-Scan sind **Plan 3**, Belegerkennung **Plan 4**. In Plan 2 gibt es weder Bilder noch Kamera.

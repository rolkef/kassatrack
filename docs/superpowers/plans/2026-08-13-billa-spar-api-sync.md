# Ketten-API-Sync (Billa/Spar und weitere) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein tägliches, eigenständiges Skript, das Billa-/Spar-/Hofer-Preise
aus dem aggregierten heisse-preise.io-Datensatz automatisch in den Katalog
einspeist — als Ergänzung zur manuellen Erfassung, nicht als Ersatz.

**Architecture:** Ein Sync-Skript (`scripts/synchronisiere-ketten.ts`, gebaut
wie `scripts/migrieren.ts`) ruft täglich `latest-canonical.json` ab, prüft je
Kette auf Aktualität, ordnet jeden Artikel zuerst über einen stabilen
Feed-Produktcode und sonst über Name+Menge+Einheit gegen den bestehenden
Katalog zu, schreibt Preisbeobachtungen (Grundpreis, nie Regalpreis direkt)
und legt nicht zuordenbare Artikel in eine Prüfliste, die eine neue Seite
(`/produkte/abgleich`) auflöst.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Drizzle ORM 0.45
(Postgres), Bun 1.3, TypeScript 7, Tailwind v4.

## Global Constraints

- Bun only — kein npm/yarn/pnpm, keine `npx`-artigen Aufrufe.
- Strikte, nonce-basierte CSP — kein `dangerouslySetInnerHTML`, kein
  Inline-`style={{}}`, kein Inline-Handler.
- Tailwind v4 CSS-first — keine `tailwind.config.*`-Datei.
- Kein Besitzmodell je Nutzer — alle Server-Aktionen beginnen mit
  `requireUser()`, keine zusätzliche Eigentumsprüfung.
- Deutsche Bezeichner und Kommentare, im Ton des bestehenden Codes.
- Nie `.resolves`/`.rejects` auf einem Promise, das echtes Postgres anfragt
  — `faengtFehler()` aus `tests/helfer/fehler.ts` verwenden und sein
  Ergebnis auswerten.
- `mock.module`-Doubles müssen immer das echte Modul spreaden.
- Component-Tests: zuerst `import "./dom"`, `screen` von dort beziehen.
- **Live-Migrations-Zeitstempel-Falle:** `drizzle/meta/_journal.json` trägt
  bei `0005_wandering_trgm`/`0006_famous_shinobi_shaw` absichtlich in die
  Zukunft gesetzte Zeitstempel (`1786646400000`/`1786646460000` =
  2026-08-13T18:40:00Z/18:41:00Z). Der Migrator
  (`node_modules/drizzle-orm/pg-core/dialect.cjs:64`) vergleicht eine neue
  Migration nur gegen den **einen** zuletzt verzeichneten Zeitstempel — eine
  vor 18:41:00Z generierte neue Migration würde auf jeder bereits
  migrierten Datenbank für immer stillschweigend übersprungen. Task 1
  dieses Plans erzeugt eine neue Migration und muss diese Falle explizit
  handhaben (siehe Task 1, Schritt 4).
- Money/Grundpreis-Disziplin (aus Plan 4s Fixrunde): Ein Regalpreis wird
  **immer** über `grundpreis()` aus `@/lib/einheiten` in einen Grundpreis
  umgerechnet, bevor er in `price_observation.grundpreis` landet. Niemals
  den rohen Feed-Preis direkt schreiben.

---

### Task 1: Schema — Prüflisten-Tabelle

**Files:**
- Create: `src/db/schema/chain-sync.ts`
- Create: `drizzle/000X_<generierter_name>.sql` (per `drizzle-kit generate`)
- Test: `tests/chain-sync-schema.test.ts`

**Interfaces:**
- Produziert: `chainSyncUngeklaert` (Drizzle-Tabelle), Spalten `id`,
  `chainId`, `feedId`, `rohname`, `menge`, `einheit`, `letzterPreis`,
  `zuerstGesehenAm`, `zuletztGesehenAm`. Unique-Index auf
  (`chainId`, `feedId`).

- [ ] **Step 1: Schema-Datei anlegen**

```ts
// src/db/schema/chain-sync.ts
import { sql } from "drizzle-orm";
import { check, integer, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { chain } from "@/db/schema/katalog";

/**
 * Artikel aus einem Ketten-Sync, die sich keinem Katalogprodukt eindeutig
 * zuordnen ließen. Kein Fremdschlüssel auf `product` — genau die fehlende
 * Zuordnung ist der Zweck dieser Tabelle.
 *
 * `feedId` (der ketteneigene, dauerhafte Produktcode aus dem Feed) statt
 * `rohname` ist der Schlüssel für „ist das derselbe offene Fall": Ein
 * Anzeigename kann sich ändern, der Produktcode bleibt.
 */
export const chainSyncUngeklaert = pgTable(
  "chain_sync_ungeklaert",
  {
    id: text("id").primaryKey(),
    chainId: text("chain_id")
      .notNull()
      .references(() => chain.id, { onDelete: "cascade" }),
    feedId: text("feed_id").notNull(),
    rohname: text("rohname").notNull(),
    /** In Gramm, Milliliter oder Stück — wie `product.menge`. */
    menge: integer("menge").notNull(),
    einheit: text("einheit").notNull(),
    /** Regalpreis zur Anzeige beim Zuordnen — keine Preis-Wahrheit. */
    letzterPreis: numeric("letzter_preis", { precision: 10, scale: 4 }).notNull(),
    zuerstGesehenAm: timestamp("zuerst_gesehen_am", { withTimezone: true }).notNull().defaultNow(),
    zuletztGesehenAm: timestamp("zuletzt_gesehen_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabelle) => [
    uniqueIndex("chain_sync_ungeklaert_kette_feed_id").on(tabelle.chainId, tabelle.feedId),
    check("chain_sync_ungeklaert_menge_positiv", sql`${tabelle.menge} > 0`),
    check("chain_sync_ungeklaert_einheit_bekannt", sql`${tabelle.einheit} in ('G','ML','STK')`),
    check("chain_sync_ungeklaert_preis_positiv", sql`${tabelle.letzterPreis} > 0`),
  ],
);
```

- [ ] **Step 2: Migration generieren**

Run: `bunx drizzle-kit generate`

Erwartet: eine neue Datei `drizzle/000X_<name>.sql` mit `CREATE TABLE
"chain_sync_ungeklaert" (...)`, dazu ein neuer Eintrag in
`drizzle/meta/_journal.json` und eine neue `drizzle/meta/000X_snapshot.json`.

- [ ] **Step 3: Zeitstempel-Falle prüfen (siehe Global Constraints)**

```bash
node -e "const j=require('./drizzle/meta/_journal.json'); console.log(j.entries.at(-1))"
node -e "console.log(Date.now())"
```

Ist der neue `when`-Wert **kleiner** als `1786646460000` (2026-08-13T18:41:00Z,
`0006`s Zeitstempel), von Hand in `drizzle/meta/_journal.json` auf
`1786646520000` setzen (eine Minute nach `0006`, exakt dieselbe Vorgehensweise
wie die Behebung von `0006`s eigenem Zeitstempel in Plan 4). Ist der neue Wert
bereits größer (weil die aktuelle Uhrzeit inzwischen nach 18:41:00Z UTC liegt),
nichts ändern.

Danach:

Run: `bun test tests/migrations-zeitstempel.test.ts`
Expected: PASS — die Ordnungs-Zusicherung (streng aufsteigende `when`-Werte,
`idx` entspricht der Feldreihenfolge) muss weiterhin halten.

- [ ] **Step 4: Test schreiben — Bedingungen der neuen Tabelle**

```ts
// tests/chain-sync-schema.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "bun:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { chainSyncUngeklaert } from "@/db/schema/chain-sync";
import { legeKettenAn, holeKetten } from "@/lib/katalog";
import { starteTestDatenbank } from "./helfer/db";
import { faengtFehler } from "./helfer/fehler";

const umgebung = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });
await legeKettenAn(umgebung.db);
afterAll(() => umgebung.stop());

describe("chain_sync_ungeklaert", () => {
  it("legt eine Zeile mit gültigen Werten an", async () => {
    const [kette] = await holeKetten(umgebung.db);
    const [zeile] = await umgebung.db
      .insert(chainSyncUngeklaert)
      .values({
        id: randomUUID(),
        chainId: kette.id,
        feedId: "00-123456",
        rohname: "Testprodukt",
        menge: 250,
        einheit: "G",
        letzterPreis: "2.49",
      })
      .returning();

    expect(zeile.rohname).toBe("Testprodukt");
  });

  it("weist eine negative Menge ab", async () => {
    const [kette] = await holeKetten(umgebung.db);
    const fehler = await faengtFehler(
      umgebung.db.insert(chainSyncUngeklaert).values({
        id: randomUUID(),
        chainId: kette.id,
        feedId: "00-999999",
        rohname: "Ungültig",
        menge: -1,
        einheit: "G",
        letzterPreis: "1.00",
      }),
    );
    expect(fehler).toBeDefined();
  });

  it("weist eine unbekannte Einheit ab", async () => {
    const [kette] = await holeKetten(umgebung.db);
    const fehler = await faengtFehler(
      umgebung.db.insert(chainSyncUngeklaert).values({
        id: randomUUID(),
        chainId: kette.id,
        feedId: "00-999998",
        rohname: "Ungültig",
        menge: 250,
        einheit: "KG",
        letzterPreis: "1.00",
      }),
    );
    expect(fehler).toBeDefined();
  });

  it("weist eine zweite Zeile mit derselben Kette+feedId ab", async () => {
    const [kette] = await holeKetten(umgebung.db);
    await umgebung.db.insert(chainSyncUngeklaert).values({
      id: randomUUID(),
      chainId: kette.id,
      feedId: "00-777777",
      rohname: "Erstes",
      menge: 100,
      einheit: "ML",
      letzterPreis: "1.99",
    });

    const fehler = await faengtFehler(
      umgebung.db.insert(chainSyncUngeklaert).values({
        id: randomUUID(),
        chainId: kette.id,
        feedId: "00-777777",
        rohname: "Zweites, gleiche feedId",
        menge: 100,
        einheit: "ML",
        letzterPreis: "2.99",
      }),
    );
    expect(fehler).toBeDefined();
  });

  it("löscht kaskadierend, wenn die Kette gelöscht wird", async () => {
    // Eigene Wegwerf-Kette, um chain nicht für andere Tests zu verändern.
    const kettenId = randomUUID();
    await umgebung.db.execute(
      sql`insert into chain (id, name, kuerzel, sortierung) values (${kettenId}, 'Wegwerf', 'wegwerf', 999)`,
    );
    await umgebung.db.insert(chainSyncUngeklaert).values({
      id: randomUUID(),
      chainId: kettenId,
      feedId: "00-555555",
      rohname: "Wird mitgelöscht",
      menge: 1,
      einheit: "STK",
      letzterPreis: "0.99",
    });

    await umgebung.db.execute(sql`delete from chain where id = ${kettenId}`);

    const rest = await umgebung.db
      .select()
      .from(chainSyncUngeklaert)
      .where(sql`${chainSyncUngeklaert.chainId} = ${kettenId}`);
    expect(rest).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Test ausführen**

Run: `bun test tests/chain-sync-schema.test.ts`
Expected: 5 pass, 0 fail

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/chain-sync.ts drizzle/ tests/chain-sync-schema.test.ts
git commit -m "feat: Schema fuer Pruefliste des Ketten-Syncs"
```

---

### Task 2: Feed-Client — Abrufen, Gruppieren, Aktualitätsprüfung, Einheiten-Zuordnung

**Files:**
- Create: `src/lib/ketten-feed.ts`
- Test: `tests/ketten-feed.test.ts`

**Interfaces:**
- Konsumiert: `Basiseinheit`, `Menge`, `MENGE_OBERGRENZE` aus `@/lib/einheiten`.
- Produziert: `FeedEintrag` (Typ), `holeFeed(abrufen: typeof fetch): Promise<FeedEintrag[]>`,
  `gruppiereNachKette(eintraege: FeedEintrag[]): Map<string, FeedEintrag[]>`,
  `AKTUALITAETS_TAGE`, `AKTUALITAETS_ANTEIL` (Konstanten),
  `istKetteAktuell(eintraege: FeedEintrag[], jetzt: Date): boolean`,
  `feedMengeZuBasiseinheit(quantity: number, unit: string): Menge | null`.
  Task 3 und Task 5 bauen darauf auf.

- [ ] **Step 1: Test für `feedMengeZuBasiseinheit` schreiben**

```ts
// tests/ketten-feed.test.ts
import { describe, expect, it, mock } from "bun:test";
import { feedMengeZuBasiseinheit, gruppiereNachKette, holeFeed, istKetteAktuell } from "@/lib/ketten-feed";

describe("feedMengeZuBasiseinheit", () => {
  it("wandelt Gramm unverändert um", () => {
    expect(feedMengeZuBasiseinheit(250, "g")).toEqual({ wert: 250, einheit: "G" });
  });

  it("wandelt Kilogramm in Gramm um", () => {
    expect(feedMengeZuBasiseinheit(1.5, "kg")).toEqual({ wert: 1500, einheit: "G" });
  });

  it("wandelt Liter in Milliliter um", () => {
    expect(feedMengeZuBasiseinheit(1, "l")).toEqual({ wert: 1000, einheit: "ML" });
  });

  it("wandelt Milliliter unverändert um", () => {
    expect(feedMengeZuBasiseinheit(330, "ml")).toEqual({ wert: 330, einheit: "ML" });
  });

  it("erkennt beide Stück-Schreibweisen", () => {
    expect(feedMengeZuBasiseinheit(6, "stk")).toEqual({ wert: 6, einheit: "STK" });
    expect(feedMengeZuBasiseinheit(6, "stück")).toEqual({ wert: 6, einheit: "STK" });
  });

  it("ist unempfindlich gegen Groß-/Kleinschreibung", () => {
    expect(feedMengeZuBasiseinheit(250, "G")).toEqual({ wert: 250, einheit: "G" });
  });

  it("liefert null für eine fachfremde Einheit", () => {
    expect(feedMengeZuBasiseinheit(5, "cm")).toBeNull();
    expect(feedMengeZuBasiseinheit(1, "Verpackungseinheit")).toBeNull();
    expect(feedMengeZuBasiseinheit(1, "")).toBeNull();
  });

  it("liefert null für eine Menge von null oder darunter", () => {
    expect(feedMengeZuBasiseinheit(0, "g")).toBeNull();
    expect(feedMengeZuBasiseinheit(-5, "g")).toBeNull();
  });
});

describe("gruppiereNachKette", () => {
  it("gruppiert Einträge nach store", () => {
    const gruppen = gruppiereNachKette([
      { store: "billa", id: "1", name: "A", price: 1, quantity: 1, unit: "stk", priceHistory: [] },
      { store: "spar", id: "2", name: "B", price: 1, quantity: 1, unit: "stk", priceHistory: [] },
      { store: "billa", id: "3", name: "C", price: 1, quantity: 1, unit: "stk", priceHistory: [] },
    ]);

    expect(gruppen.get("billa")).toHaveLength(2);
    expect(gruppen.get("spar")).toHaveLength(1);
    expect(gruppen.get("hofer")).toBeUndefined();
  });
});

describe("istKetteAktuell", () => {
  const jetzt = new Date("2026-08-13T12:00:00.000Z");

  function eintragMitDatum(datum: string) {
    return {
      store: "billa",
      id: "x",
      name: "X",
      price: 1,
      quantity: 1,
      unit: "stk",
      priceHistory: [{ date: datum, price: 1 }],
    };
  }

  it("gilt als aktuell, wenn die Hälfte der Einträge höchstens 3 Tage alt ist", () => {
    const eintraege = [
      eintragMitDatum("2026-08-12"),
      eintragMitDatum("2026-08-11"),
      eintragMitDatum("2020-01-01"),
      eintragMitDatum("2020-01-01"),
    ];
    expect(istKetteAktuell(eintraege, jetzt)).toBe(true);
  });

  it("gilt nicht als aktuell, wenn zu wenige Einträge frisch sind", () => {
    const eintraege = [
      eintragMitDatum("2026-08-12"),
      eintragMitDatum("2020-01-01"),
      eintragMitDatum("2020-01-01"),
      eintragMitDatum("2020-01-01"),
    ];
    expect(istKetteAktuell(eintraege, jetzt)).toBe(false);
  });

  it("gilt nicht als aktuell ohne jeden Eintrag", () => {
    expect(istKetteAktuell([], jetzt)).toBe(false);
  });
});

describe("holeFeed", () => {
  it("liefert das geparste Array bei einer erfolgreichen Antwort", async () => {
    const daten = [{ store: "billa", id: "1", name: "A", price: 1, quantity: 1, unit: "stk", priceHistory: [] }];
    const abrufen = mock(async () => new Response(JSON.stringify(daten), { status: 200})) as unknown as typeof fetch;

    expect(await holeFeed(abrufen)).toEqual(daten);
  });

  it("wirft bei einer fehlgeschlagenen Antwort", async () => {
    const abrufen = mock(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(holeFeed(abrufen)).rejects.toThrow();
  });

  it("wirft, wenn die Antwort kein Array ist", async () => {
    const abrufen = mock(
      async () => new Response(JSON.stringify({ nicht: "ein array" }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(holeFeed(abrufen)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `bun test tests/ketten-feed.test.ts`
Expected: FAIL — Modul `@/lib/ketten-feed` existiert nicht.

- [ ] **Step 3: Implementieren**

```ts
// src/lib/ketten-feed.ts
import type { Basiseinheit, Menge } from "@/lib/einheiten";
import { MENGE_OBERGRENZE } from "@/lib/einheiten";

const FEED_URL = "https://heisse-preise.io/data/latest-canonical.json";

export type FeedPreisPunkt = { date: string; price: number };

export type FeedEintrag = {
  store: string;
  id: string;
  name: string;
  price: number;
  quantity: number;
  unit: string;
  bio?: boolean;
  unavailable?: boolean;
  priceHistory: FeedPreisPunkt[];
};

/**
 * Ruft den aggregierten Tagesdatensatz von heisse-preise.io ab.
 *
 * `abrufen` ist injizierbar (wie bei `holeOffProdukt`), damit kein Test
 * echtes Internet braucht. Wirft statt `null` zu liefern — anders als
 * `holeOffProdukt`, das einen Benutzereingabefall behandelt, ist ein
 * kaputter oder unerreichbarer Feed hier ein Grund, den ganzen Sync-Lauf
 * abzubrechen, nicht ihn stillschweigend leer weiterlaufen zu lassen.
 */
export async function holeFeed(abrufen: typeof fetch): Promise<FeedEintrag[]> {
  const antwort = await abrufen(FEED_URL);
  if (!antwort.ok) {
    throw new Error(`Feed-Abruf fehlgeschlagen: HTTP ${antwort.status}`);
  }

  const daten = await antwort.json();
  if (!Array.isArray(daten)) {
    throw new Error("Feed-Antwort ist kein Array — Format hat sich vermutlich geändert.");
  }

  return daten as FeedEintrag[];
}

/** Gruppiert Feed-Einträge nach ihrem `store`-Feld (Kettenkürzel, klein). */
export function gruppiereNachKette(eintraege: FeedEintrag[]): Map<string, FeedEintrag[]> {
  const gruppen = new Map<string, FeedEintrag[]>();
  for (const eintrag of eintraege) {
    const liste = gruppen.get(eintrag.store);
    if (liste) {
      liste.push(eintrag);
    } else {
      gruppen.set(eintrag.store, [eintrag]);
    }
  }
  return gruppen;
}

/** Wie viele Tage ein Eintrag höchstens alt sein darf, um als „frisch" zu zählen. */
export const AKTUALITAETS_TAGE = 3;

/** Welcher Anteil der Einträge einer Kette frisch sein muss. */
export const AKTUALITAETS_ANTEIL = 0.5;

/**
 * Ob eine Kette im Feed noch aktuell beliefert wird.
 *
 * Kein hartcodierter Kettenname — eine Kette, die (wie MPreis 2024) ihren
 * Onlineshop schließt oder die der Feed (wie Lidl/Penny) gar nicht führt,
 * fällt hier automatisch heraus, ohne dass der Code sie kennen muss.
 */
export function istKetteAktuell(eintraege: FeedEintrag[], jetzt: Date): boolean {
  if (eintraege.length === 0) return false;

  const grenze = new Date(jetzt);
  grenze.setUTCDate(grenze.getUTCDate() - AKTUALITAETS_TAGE);

  const frische = eintraege.filter((eintrag) => {
    const datum = eintrag.priceHistory[0]?.date;
    if (!datum) return false;
    return new Date(`${datum}T00:00:00.000Z`) >= grenze;
  });

  return frische.length / eintraege.length >= AKTUALITAETS_ANTEIL;
}

const FEED_EINHEITEN: Record<string, { einheit: Basiseinheit; faktor: number }> = {
  g: { einheit: "G", faktor: 1 },
  kg: { einheit: "G", faktor: 1000 },
  ml: { einheit: "ML", faktor: 1 },
  l: { einheit: "ML", faktor: 1000 },
  stk: { einheit: "STK", faktor: 1 },
  stück: { einheit: "STK", faktor: 1 },
};

/**
 * Wandelt Feed-Menge/-Einheit in unsere Basiseinheit um.
 *
 * Der Feed führt neben Lebensmitteln auch Non-Food (Drogerie, Zubehör) mit
 * fachfremden Einheiten wie „cm", „km" oder „Verpackungseinheit" — dafür
 * liefert diese Funktion `null`, der Aufrufer verwirft den Eintrag dann,
 * statt eine bedeutungslose Menge in den Katalog zu schreiben.
 */
export function feedMengeZuBasiseinheit(quantity: number, unit: string): Menge | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const eintrag = FEED_EINHEITEN[unit.trim().toLowerCase()];
  if (!eintrag) return null;

  const wert = Math.round(quantity * eintrag.faktor);
  if (wert <= 0 || wert > MENGE_OBERGRENZE) return null;

  return { wert, einheit: eintrag.einheit };
}
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `bun test tests/ketten-feed.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/ketten-feed.ts tests/ketten-feed.test.ts
git commit -m "feat: Feed-Client fuer heisse-preise.io -- Abruf, Gruppierung, Aktualitaet, Einheiten"
```

---

### Task 3: Zuordnung gegen den Katalog und Prüfliste

**Files:**
- Create: `src/lib/ketten-abgleich.ts`
- Test: `tests/ketten-abgleich.test.ts`

**Interfaces:**
- Konsumiert: `chainSyncUngeklaert` (Task 1), `Basiseinheit`/`Menge` aus
  `@/lib/einheiten`, `sichereKettenProdukt` aus `@/lib/katalog`,
  `storeProduct`/`product` aus `@/db/schema/katalog`, `DbOderTransaktion`
  aus `@/lib/zugriff`.
- Produziert: `feedSchluessel(feedId: string): string`,
  `findeStoreProductPerFeedCode(db, chainId, feedId): Promise<string | null>`,
  `findeStoreProductPerName(db, chainId, eingabe: {rohname, menge, einheit}): Promise<string | null>`,
  `meldeUngeklaert(db, eingabe: {chainId, feedId, rohname, menge, einheit, preis}): Promise<void>`,
  `bestaetigeZuordnung(db, eingabe: {ungeklaertId, chainId, feedId, rohname, productId}): Promise<void>`,
  `holeUngeklaerte(db): Promise<UngeklaertZeile[]>`,
  `verwerfeUngeklaert(db, ungeklaertId: string): Promise<void>`.
  Task 5 (Sync-Skript) und Task 6 (Oberfläche) bauen darauf auf.

- [ ] **Step 1: Test schreiben**

```ts
// tests/ketten-abgleich.test.ts
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { chainSyncUngeklaert } from "@/db/schema/chain-sync";
import { holeKetten, legeKettenAn, legeProduktAn, sichereKettenProdukt } from "@/lib/katalog";
import {
  bestaetigeZuordnung,
  feedSchluessel,
  findeStoreProductPerFeedCode,
  findeStoreProductPerName,
  holeUngeklaerte,
  meldeUngeklaert,
  verwerfeUngeklaert,
} from "@/lib/ketten-abgleich";
import { storeProduct } from "@/db/schema/katalog";
import { eq } from "drizzle-orm";
import { starteTestDatenbank } from "./helfer/db";

const umgebung = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });
await legeKettenAn(umgebung.db);
afterAll(() => umgebung.stop());

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate chain_sync_ungeklaert, store_product, product cascade`);
});

describe("meldeUngeklaert / holeUngeklaerte / verwerfeUngeklaert", () => {
  it("legt einen neuen Prüflisten-Eintrag an und findet ihn wieder", async () => {
    const [kette] = await holeKetten(umgebung.db);
    await meldeUngeklaert(umgebung.db, {
      chainId: kette.id,
      feedId: "00-1",
      rohname: "Unbekanntes Ding",
      menge: 250,
      einheit: "G",
      preis: 2.49,
    });

    const liste = await holeUngeklaerte(umgebung.db);
    expect(liste).toHaveLength(1);
    expect(liste[0].rohname).toBe("Unbekanntes Ding");
  });

  it("aktualisiert Preis und Zeitpunkt statt eine zweite Zeile anzulegen", async () => {
    const [kette] = await holeKetten(umgebung.db);
    await meldeUngeklaert(umgebung.db, {
      chainId: kette.id, feedId: "00-1", rohname: "Ding", menge: 250, einheit: "G", preis: 2.49,
    });
    await meldeUngeklaert(umgebung.db, {
      chainId: kette.id, feedId: "00-1", rohname: "Ding, neuer Name", menge: 250, einheit: "G", preis: 2.99,
    });

    const liste = await holeUngeklaerte(umgebung.db);
    expect(liste).toHaveLength(1);
    expect(liste[0].rohname).toBe("Ding, neuer Name");
    expect(liste[0].letzterPreis).toBe(2.99);
  });

  it("löscht einen Eintrag beim Verwerfen", async () => {
    const [kette] = await holeKetten(umgebung.db);
    await meldeUngeklaert(umgebung.db, {
      chainId: kette.id, feedId: "00-1", rohname: "Ding", menge: 250, einheit: "G", preis: 2.49,
    });
    const [eintrag] = await holeUngeklaerte(umgebung.db);

    await verwerfeUngeklaert(umgebung.db, eintrag.id);

    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(0);
  });
});

describe("findeStoreProductPerFeedCode / findeStoreProductPerName", () => {
  it("findet nichts, solange keine Zuordnung besteht", async () => {
    const [kette] = await holeKetten(umgebung.db);
    expect(await findeStoreProductPerFeedCode(umgebung.db, kette.id, "00-1")).toBeNull();
    expect(
      await findeStoreProductPerName(umgebung.db, kette.id, { rohname: "Butter", menge: 250, einheit: "G" }),
    ).toBeNull();
  });

  it("findet über den Feed-Code, nachdem er bestätigt wurde", async () => {
    const [kette] = await holeKetten(umgebung.db);
    const produkt = await legeProduktAn(umgebung.db, { name: "Butter", menge: 250, einheit: "G" });
    await meldeUngeklaert(umgebung.db, {
      chainId: kette.id, feedId: "00-1", rohname: "BUTT.EXTRA 250", menge: 250, einheit: "G", preis: 2.49,
    });
    const [eintrag] = await holeUngeklaerte(umgebung.db);

    await bestaetigeZuordnung(umgebung.db, {
      ungeklaertId: eintrag.id,
      chainId: kette.id,
      feedId: "00-1",
      rohname: "BUTT.EXTRA 250",
      productId: produkt.id,
    });

    const gefunden = await findeStoreProductPerFeedCode(umgebung.db, kette.id, "00-1");
    expect(gefunden).not.toBeNull();

    const zuordnung = await umgebung.db
      .select({ productId: storeProduct.productId })
      .from(storeProduct)
      .where(eq(storeProduct.id, gefunden!));
    expect(zuordnung[0].productId).toBe(produkt.id);
  });

  it("löscht den Prüflisten-Eintrag beim Bestätigen", async () => {
    const [kette] = await holeKetten(umgebung.db);
    const produkt = await legeProduktAn(umgebung.db, { name: "Milch", menge: 1000, einheit: "ML" });
    await meldeUngeklaert(umgebung.db, {
      chainId: kette.id, feedId: "00-2", rohname: "Milch 1l", menge: 1000, einheit: "ML", preis: 1.19,
    });
    const [eintrag] = await holeUngeklaerte(umgebung.db);

    await bestaetigeZuordnung(umgebung.db, {
      ungeklaertId: eintrag.id, chainId: kette.id, feedId: "00-2", rohname: "Milch 1l", productId: produkt.id,
    });

    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(0);
  });

  it("findet über Name+Menge+Einheit, auch ohne bestätigten Feed-Code", async () => {
    const [kette] = await holeKetten(umgebung.db);
    const produkt = await legeProduktAn(umgebung.db, { name: "Zahnpasta", menge: 75, einheit: "ML" });
    const storeProductId = await sichereKettenProdukt(umgebung.db, { chainId: kette.id, productId: produkt.id });
    await umgebung.db.update(storeProduct).set({ rohNamen: ["Zahnpasta Frisch"] }).where(eq(storeProduct.id, storeProductId));

    const gefunden = await findeStoreProductPerName(umgebung.db, kette.id, {
      rohname: "  zahnpasta frisch  ",
      menge: 75,
      einheit: "ML",
    });
    expect(gefunden).toBe(storeProductId);
  });

  it("findet nicht über den Namen, wenn Menge oder Einheit abweichen", async () => {
    const [kette] = await holeKetten(umgebung.db);
    const produkt = await legeProduktAn(umgebung.db, { name: "Zahnpasta", menge: 75, einheit: "ML" });
    const storeProductId = await sichereKettenProdukt(umgebung.db, { chainId: kette.id, productId: produkt.id });
    await umgebung.db.update(storeProduct).set({ rohNamen: ["Zahnpasta Frisch"] }).where(eq(storeProduct.id, storeProductId));

    expect(
      await findeStoreProductPerName(umgebung.db, kette.id, { rohname: "zahnpasta frisch", menge: 100, einheit: "ML" }),
    ).toBeNull();
  });
});

describe("feedSchluessel", () => {
  it("erzeugt einen von echten Anzeigenamen unterscheidbaren Schlüssel", () => {
    expect(feedSchluessel("00-1")).toBe("feed:00-1");
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `bun test tests/ketten-abgleich.test.ts`
Expected: FAIL — Modul `@/lib/ketten-abgleich` existiert nicht.

- [ ] **Step 3: Implementieren**

```ts
// src/lib/ketten-abgleich.ts
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { chainSyncUngeklaert } from "@/db/schema/chain-sync";
import { product, storeProduct } from "@/db/schema/katalog";
import type { Basiseinheit } from "@/lib/einheiten";
import { sichereKettenProdukt } from "@/lib/katalog";
import type { DbOderTransaktion } from "@/lib/zugriff";

/**
 * Der Wert, der für einen Feed-Produktcode in `store_product.rohNamen`
 * abgelegt wird — mit Präfix, damit er nie zufällig mit einem echten
 * Anzeigenamen kollidiert.
 */
export function feedSchluessel(feedId: string): string {
  return `feed:${feedId}`;
}

/** Sucht eine Ketten-Zuordnung über den zuvor bestätigten Feed-Produktcode. */
export async function findeStoreProductPerFeedCode(
  db: DbOderTransaktion,
  chainId: string,
  feedId: string,
): Promise<string | null> {
  const schluessel = feedSchluessel(feedId);
  const [zeile] = await db
    .select({ id: storeProduct.id })
    .from(storeProduct)
    .where(and(eq(storeProduct.chainId, chainId), sql`${schluessel} = any(${storeProduct.rohNamen})`))
    .limit(1);

  return zeile?.id ?? null;
}

/**
 * Sucht eine Ketten-Zuordnung über exakten Namen (Groß-/Kleinschreibung und
 * Randleerzeichen bleiben außer Betracht) sowie exakte Menge und Einheit.
 *
 * Kein unscharfes Matching — eine Verwechslung hier schriebe einen Preis
 * unter dem falschen Produkt fest.
 */
export async function findeStoreProductPerName(
  db: DbOderTransaktion,
  chainId: string,
  eingabe: { rohname: string; menge: number; einheit: Basiseinheit },
): Promise<string | null> {
  const normalisiert = eingabe.rohname.trim().toLowerCase();

  const [zeile] = await db
    .select({ id: storeProduct.id })
    .from(storeProduct)
    .innerJoin(product, eq(product.id, storeProduct.productId))
    .where(
      and(
        eq(storeProduct.chainId, chainId),
        eq(product.menge, eingabe.menge),
        eq(product.einheit, eingabe.einheit),
        sql`exists (
          select 1 from unnest(${storeProduct.rohNamen}) as rn
          where lower(btrim(rn)) = ${normalisiert}
        )`,
      ),
    )
    .limit(1);

  return zeile?.id ?? null;
}

export type UngeklaertZeile = {
  id: string;
  chainId: string;
  feedId: string;
  rohname: string;
  menge: number;
  einheit: Basiseinheit;
  letzterPreis: number;
  zuerstGesehenAm: Date;
  zuletztGesehenAm: Date;
};

const UNGEKLAERT_SPALTEN = {
  id: chainSyncUngeklaert.id,
  chainId: chainSyncUngeklaert.chainId,
  feedId: chainSyncUngeklaert.feedId,
  rohname: chainSyncUngeklaert.rohname,
  menge: chainSyncUngeklaert.menge,
  einheit: chainSyncUngeklaert.einheit,
  letzterPreis: chainSyncUngeklaert.letzterPreis,
  zuerstGesehenAm: chainSyncUngeklaert.zuerstGesehenAm,
  zuletztGesehenAm: chainSyncUngeklaert.zuletztGesehenAm,
};

function alsUngeklaertZeile(zeile: Record<string, unknown>): UngeklaertZeile {
  return {
    ...(zeile as Omit<UngeklaertZeile, "letzterPreis" | "einheit">),
    einheit: zeile.einheit as Basiseinheit,
    letzterPreis: Number(zeile.letzterPreis),
  };
}

/**
 * Legt einen Prüflisten-Eintrag an oder frischt ihn auf, falls er (über
 * Kette + Feed-Produktcode) schon existiert. Aktualisiert dabei bewusst nur
 * Anzeigename, Preis und Zeitpunkt — Menge/Einheit ändern sich für denselben
 * Produktcode nicht.
 */
export async function meldeUngeklaert(
  db: DbOderTransaktion,
  eingabe: {
    chainId: string;
    feedId: string;
    rohname: string;
    menge: number;
    einheit: Basiseinheit;
    preis: number;
  },
): Promise<void> {
  await db
    .insert(chainSyncUngeklaert)
    .values({
      id: randomUUID(),
      chainId: eingabe.chainId,
      feedId: eingabe.feedId,
      rohname: eingabe.rohname,
      menge: eingabe.menge,
      einheit: eingabe.einheit,
      letzterPreis: eingabe.preis.toFixed(4),
    })
    .onConflictDoUpdate({
      target: [chainSyncUngeklaert.chainId, chainSyncUngeklaert.feedId],
      set: {
        rohname: eingabe.rohname,
        letzterPreis: eingabe.preis.toFixed(4),
        zuletztGesehenAm: new Date(),
      },
    });
}

export async function holeUngeklaerte(db: DbOderTransaktion): Promise<UngeklaertZeile[]> {
  const zeilen = await db.select(UNGEKLAERT_SPALTEN).from(chainSyncUngeklaert);
  return zeilen.map(alsUngeklaertZeile);
}

export async function verwerfeUngeklaert(db: DbOderTransaktion, ungeklaertId: string): Promise<void> {
  await db.delete(chainSyncUngeklaert).where(eq(chainSyncUngeklaert.id, ungeklaertId));
}

/**
 * Bestätigt eine Prüflisten-Zeile als ein bestehendes (oder eben erst
 * angelegtes) Katalogprodukt: legt/findet die Ketten-Zuordnung, trägt
 * Anzeigename **und** Feed-Produktcode in `rohNamen` nach (Lese-Ändere-
 * Schreibe in JS statt SQL-Array-Verkettung, damit keine Dubletten
 * entstehen und die Logik ohne rohes SQL lesbar bleibt), und löscht den
 * Prüflisten-Eintrag.
 */
export async function bestaetigeZuordnung(
  db: DbOderTransaktion,
  eingabe: { ungeklaertId: string; chainId: string; feedId: string; rohname: string; productId: string },
): Promise<void> {
  const storeProductId = await sichereKettenProdukt(db, {
    chainId: eingabe.chainId,
    productId: eingabe.productId,
  });

  const [zeile] = await db
    .select({ rohNamen: storeProduct.rohNamen })
    .from(storeProduct)
    .where(eq(storeProduct.id, storeProductId))
    .limit(1);

  const neueWerte = [eingabe.rohname, feedSchluessel(eingabe.feedId)];
  const vereinigt = Array.from(new Set([...(zeile?.rohNamen ?? []), ...neueWerte]));

  await db.update(storeProduct).set({ rohNamen: vereinigt }).where(eq(storeProduct.id, storeProductId));
  await verwerfeUngeklaert(db, eingabe.ungeklaertId);
}
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `bun test tests/ketten-abgleich.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/ketten-abgleich.ts tests/ketten-abgleich.test.ts
git commit -m "feat: Zuordnung von Feed-Artikeln zum Katalog samt Pruefliste"
```

---

### Task 4: `schreibeBeobachtung` um Zeitstempel erweitern, Preis-Synchronisierung

**Files:**
- Modify: `src/lib/preise.ts:51-110` (`schreibeBeobachtung`)
- Create: `src/lib/ketten-preise.ts`
- Test: `tests/ketten-preise.test.ts`

**Interfaces:**
- Konsumiert: `schreibeBeobachtung` (erweitert), `grundpreis`/`Menge` aus
  `@/lib/einheiten`, `priceObservation` aus `@/db/schema/preise`,
  `FeedPreisPunkt` aus `@/lib/ketten-feed` (Task 2 — nicht erneut definieren).
- Produziert: `schreibeBeobachtung`s neues optionales Feld `beobachtetAm?: Date`;
  `synchronisiereBeobachtungen(db, eingabe: {storeProductId, chainId, productId, menge: Menge, verlauf: FeedPreisPunkt[]}): Promise<number>`
  (liefert Anzahl neu geschriebener Beobachtungen). Task 5 (Sync-Skript)
  ruft diese Funktion pro zugeordnetem Artikel auf.

- [ ] **Step 1: `schreibeBeobachtung` erweitern**

In `src/lib/preise.ts`, die Eingabe-Typdefinition von `schreibeBeobachtung`
(Zeile ~53-65) um ein Feld ergänzen:

```ts
export async function schreibeBeobachtung(
  db: DbOderTransaktion,
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
    /** Historisches Beobachtungsdatum — Default `now()` wie bisher. */
    beobachtetAm?: Date;
  },
): Promise<void> {
```

Und im `db.insert(priceObservation).values({...})`-Aufruf (Zeile ~96-109) die
letzte Zeile vor der schließenden Klammer ergänzen:

```ts
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
    ...(eingabe.beobachtetAm ? { beobachtetAm: eingabe.beobachtetAm } : {}),
  });
```

Die bedingte Spread — nicht `beobachtetAm: eingabe.beobachtetAm ?? new Date()`
— ist Absicht: Ein explizit gesetztes `undefined` im Insert würde die
Spalte trotzdem in die Anweisung aufnehmen und den DB-Default `now()`
umgehen; ausgelassen bleibt die Spalte ganz weg, und Postgres setzt den
Default selbst.

- [ ] **Step 2: Bestehende Tests laufen lassen — dürfen sich nicht ändern**

Run: `bun test tests/erfassen-aktionen.test.ts`
Expected: PASS, unveränderte Anzahl — die Erweiterung ist rein additiv.

- [ ] **Step 3: Test für den neuen Parameter schreiben**

An `tests/optimierer.test.ts` (oder einer eigenen kleinen Testdatei — falls
eine eigene, dieselbe Fixture-Einrichtung wie in Task 3 verwenden) folgenden
Fall ergänzen:

```ts
it("schreibt beobachtetAm, wenn es mitgegeben wird", async () => {
  const produkt = await legeProduktAn(umgebung.db, { name: "Test", menge: 100, einheit: "G" });
  const [kette] = await holeKetten(umgebung.db);
  const storeProductId = await sichereKettenProdukt(umgebung.db, { chainId: kette.id, productId: produkt.id });
  const datum = new Date("2024-05-01T00:00:00.000Z");

  await schreibeBeobachtung(umgebung.db, {
    storeProductId,
    chainId: kette.id,
    productId: produkt.id,
    quelle: "CHAIN_API",
    preisart: "NORMAL",
    einzelpreis: 1.99,
    zeilensumme: 1.99,
    grundpreis: 1.99,
    beobachtetAm: datum,
  });

  const [zeile] = await umgebung.db
    .select({ beobachtetAm: priceObservation.beobachtetAm })
    .from(priceObservation)
    .where(eq(priceObservation.storeProductId, storeProductId));

  expect(zeile.beobachtetAm).toEqual(datum);
});
```

(`priceObservation` und `eq` entsprechend importieren, falls in der
gewählten Testdatei noch nicht vorhanden.)

Run: `bun test <gewählte Testdatei>`
Expected: PASS

- [ ] **Step 4: Test für `synchronisiereBeobachtungen` schreiben**

```ts
// tests/ketten-preise.test.ts
import { afterAll, describe, expect, it } from "bun:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { and, eq } from "drizzle-orm";
import { priceObservation } from "@/db/schema/preise";
import { holeKetten, legeKettenAn, legeProduktAn, sichereKettenProdukt } from "@/lib/katalog";
import { synchronisiereBeobachtungen } from "@/lib/ketten-preise";
import { starteTestDatenbank } from "./helfer/db";

const umgebung = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });
await legeKettenAn(umgebung.db);
afterAll(() => umgebung.stop());

async function holeBeobachtungen(storeProductId: string) {
  return umgebung.db
    .select({ beobachtetAm: priceObservation.beobachtetAm, grundpreis: priceObservation.grundpreis })
    .from(priceObservation)
    .where(and(eq(priceObservation.storeProductId, storeProductId), eq(priceObservation.quelle, "CHAIN_API")))
    .orderBy(priceObservation.beobachtetAm);
}

describe("synchronisiereBeobachtungen", () => {
  it("schreibt beim Erstimport nur die Tage mit echter Preisänderung", async () => {
    const produkt = await legeProduktAn(umgebung.db, { name: "Butter Sync", menge: 250, einheit: "G" });
    const [kette] = await holeKetten(umgebung.db);
    const storeProductId = await sichereKettenProdukt(umgebung.db, { chainId: kette.id, productId: produkt.id });

    const geschrieben = await synchronisiereBeobachtungen(umgebung.db, {
      storeProductId,
      chainId: kette.id,
      productId: produkt.id,
      menge: { wert: 250, einheit: "G" },
      verlauf: [
        { date: "2024-03-01", price: 2.49 },
        { date: "2024-02-15", price: 2.49 }, // gleicher Preis -- kein zweiter Eintrag
        { date: "2024-01-01", price: 2.29 },
      ],
    });

    expect(geschrieben).toBe(2);
    const beobachtungen = await holeBeobachtungen(storeProductId);
    expect(beobachtungen).toHaveLength(2);
    expect(beobachtungen[0].beobachtetAm.toISOString().slice(0, 10)).toBe("2024-01-01");
    expect(beobachtungen[1].beobachtetAm.toISOString().slice(0, 10)).toBe("2024-03-01");
  });

  it("schreibt bei einem Folgelauf nur, wenn sich der Preis geändert hat", async () => {
    const produkt = await legeProduktAn(umgebung.db, { name: "Milch Sync", menge: 1000, einheit: "ML" });
    const [kette] = await holeKetten(umgebung.db);
    const storeProductId = await sichereKettenProdukt(umgebung.db, { chainId: kette.id, productId: produkt.id });

    await synchronisiereBeobachtungen(umgebung.db, {
      storeProductId, chainId: kette.id, productId: produkt.id,
      menge: { wert: 1000, einheit: "ML" },
      verlauf: [{ date: "2024-03-01", price: 1.19 }],
    });

    const nochmalGleich = await synchronisiereBeobachtungen(umgebung.db, {
      storeProductId, chainId: kette.id, productId: produkt.id,
      menge: { wert: 1000, einheit: "ML" },
      verlauf: [{ date: "2024-03-02", price: 1.19 }],
    });
    expect(nochmalGleich).toBe(0);

    const mitAenderung = await synchronisiereBeobachtungen(umgebung.db, {
      storeProductId, chainId: kette.id, productId: produkt.id,
      menge: { wert: 1000, einheit: "ML" },
      verlauf: [{ date: "2024-03-03", price: 1.29 }],
    });
    expect(mitAenderung).toBe(1);

    expect(await holeBeobachtungen(storeProductId)).toHaveLength(2);
  });

  it("ist idempotent bei doppeltem Lauf mit identischem Verlauf", async () => {
    const produkt = await legeProduktAn(umgebung.db, { name: "Mehl Sync", menge: 1000, einheit: "G" });
    const [kette] = await holeKetten(umgebung.db);
    const storeProductId = await sichereKettenProdukt(umgebung.db, { chainId: kette.id, productId: produkt.id });

    const eingabe = {
      storeProductId, chainId: kette.id, productId: produkt.id,
      menge: { wert: 1000, einheit: "G" as const },
      verlauf: [{ date: "2024-03-01", price: 0.89 }],
    };

    await synchronisiereBeobachtungen(umgebung.db, eingabe);
    const zweitesMal = await synchronisiereBeobachtungen(umgebung.db, eingabe);

    expect(zweitesMal).toBe(0);
    expect(await holeBeobachtungen(storeProductId)).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Test ausführen — muss fehlschlagen**

Run: `bun test tests/ketten-preise.test.ts`
Expected: FAIL — Modul `@/lib/ketten-preise` existiert nicht.

- [ ] **Step 6: `synchronisiereBeobachtungen` implementieren**

```ts
// src/lib/ketten-preise.ts
import { and, desc, eq } from "drizzle-orm";
import { priceObservation } from "@/db/schema/preise";
import { grundpreis, type Menge } from "@/lib/einheiten";
import type { FeedPreisPunkt } from "@/lib/ketten-feed";
import { schreibeBeobachtung } from "@/lib/preise";
import type { DbOderTransaktion } from "@/lib/zugriff";

/**
 * Schreibt fehlende `CHAIN_API`-Beobachtungen für ein zugeordnetes Produkt
 * nach — beim Erstimport die ganze Preishistorie (aber nur an den Tagen mit
 * echter Preisänderung), bei jedem weiteren Lauf nur, was seit der letzten
 * bekannten Beobachtung neu und tatsächlich anders ist. Ein Lauf am selben
 * Tag mit unverändertem Verlauf schreibt nichts — das macht den Sync
 * idempotent, ohne eine eigene Sperre zu brauchen.
 *
 * Liefert die Anzahl neu geschriebener Beobachtungen, fürs Laufprotokoll.
 */
export async function synchronisiereBeobachtungen(
  db: DbOderTransaktion,
  eingabe: {
    storeProductId: string;
    chainId: string;
    productId: string;
    menge: Menge;
    verlauf: FeedPreisPunkt[];
  },
): Promise<number> {
  const [letzte] = await db
    .select({ beobachtetAm: priceObservation.beobachtetAm, grundpreis: priceObservation.grundpreis })
    .from(priceObservation)
    .where(
      and(eq(priceObservation.storeProductId, eingabe.storeProductId), eq(priceObservation.quelle, "CHAIN_API")),
    )
    .orderBy(desc(priceObservation.beobachtetAm))
    .limit(1);

  const letztesDatum = letzte ? letzte.beobachtetAm.toISOString().slice(0, 10) : null;

  // Chronologisch (älteste zuerst) -- der Feed liefert absteigend sortiert.
  const chronologisch = [...eingabe.verlauf].sort((a, b) => a.date.localeCompare(b.date));

  let vorherigerGrundpreis = letzte ? Number(letzte.grundpreis) : null;
  let geschrieben = 0;

  for (const punkt of chronologisch) {
    if (letztesDatum && punkt.date <= letztesDatum) continue;

    const grundpreisWert = grundpreis(punkt.price, eingabe.menge);
    if (grundpreisWert === null) continue;

    // Rundungstoleranz statt strikter Ungleichheit: Zwei Grundpreise, die
    // sich nur durch Gleitkomma-Rauschen unterscheiden, sind derselbe Preis.
    if (vorherigerGrundpreis !== null && Math.abs(grundpreisWert - vorherigerGrundpreis) < 0.00005) {
      continue;
    }

    await schreibeBeobachtung(db, {
      storeProductId: eingabe.storeProductId,
      chainId: eingabe.chainId,
      productId: eingabe.productId,
      quelle: "CHAIN_API",
      preisart: "NORMAL",
      einzelpreis: punkt.price,
      zeilensumme: punkt.price,
      grundpreis: grundpreisWert,
      beobachtetAm: new Date(`${punkt.date}T00:00:00.000Z`),
    });

    vorherigerGrundpreis = grundpreisWert;
    geschrieben++;
  }

  return geschrieben;
}
```

- [ ] **Step 7: Test ausführen — muss bestehen**

Run: `bun test tests/ketten-preise.test.ts`
Expected: PASS

- [ ] **Step 8: Volle Suite laufen lassen**

Run: `bun test`
Expected: alle Tests grün, keine Regression durch die Erweiterung von
`schreibeBeobachtung`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/preise.ts src/lib/ketten-preise.ts tests/ketten-preise.test.ts tests/optimierer.test.ts
git commit -m "feat: historische und laufende Preis-Synchronisierung aus dem Ketten-Feed"
```

---

### Task 5: Das Sync-Skript

**Files:**
- Create: `scripts/synchronisiere-ketten.ts`
- Modify: `Dockerfile` (Vorkompilierung wie `scripts/migrieren.ts`)
- Test: `tests/synchronisiere-ketten.test.ts`

**Interfaces:**
- Konsumiert: alles aus Task 2, 3, 4; `holeKetten`, `legeKettenAn` aus
  `@/lib/katalog`; `db` aus `@/db` (im Skript selbst über einen eigenen
  Pool, wie `scripts/migrieren.ts`).
- Produziert: `fuehreSyncAus(db, abrufen: typeof fetch, jetzt: Date): Promise<LaufBericht>`
  (die testbare Kernlogik, ohne Prozess-Exit); das Skript selbst ist nur
  eine dünne Hülle, die diese Funktion mit echten Abhängigkeiten aufruft.

- [ ] **Step 1: Test für `fuehreSyncAus` schreiben**

```ts
// tests/synchronisiere-ketten.test.ts
import { afterAll, describe, expect, it, mock } from "bun:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { holeKetten, legeKettenAn, legeProduktAn } from "@/lib/katalog";
import { bestaetigeZuordnung, holeUngeklaerte } from "@/lib/ketten-abgleich";
import { fuehreSyncAus } from "../scripts/synchronisiere-ketten";
import { starteTestDatenbank } from "./helfer/db";

const umgebung = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });
await legeKettenAn(umgebung.db);
afterAll(() => umgebung.stop());

function fakeFeed(eintraege: unknown[]) {
  return mock(async () => new Response(JSON.stringify(eintraege), { status: 200 })) as unknown as typeof fetch;
}

const JETZT = new Date("2026-08-13T12:00:00.000Z");

function frischerEintrag(overrides: Record<string, unknown> = {}) {
  return {
    store: "billa",
    id: "00-1",
    name: "Testartikel",
    price: 2.49,
    quantity: 250,
    unit: "g",
    unavailable: false,
    priceHistory: [{ date: "2026-08-12", price: 2.49 }],
    ...overrides,
  };
}

describe("fuehreSyncAus", () => {
  it("meldet einen unbekannten Artikel in der Prüfliste", async () => {
    const bericht = await fuehreSyncAus(umgebung.db, fakeFeed([frischerEintrag()]), JETZT);

    expect(bericht.neueUngeklaerte).toBe(1);
    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(1);
  });

  it("überspringt eine Kette ohne frische Daten (z. B. lidl/penny)", async () => {
    const bericht = await fuehreSyncAus(
      umgebung.db,
      fakeFeed([
        { ...frischerEintrag({ store: "lidl", id: "l-1" }), priceHistory: [{ date: "2020-01-01", price: 1 }] },
      ]),
      JETZT,
    );

    expect(bericht.uebersprungeneKetten).toContain("lidl");
    expect(bericht.neueUngeklaerte).toBe(0);
  });

  it("verwirft einen Artikel mit unbekannter Einheit, ohne ihn in die Prüfliste zu legen", async () => {
    const bericht = await fuehreSyncAus(
      umgebung.db,
      fakeFeed([frischerEintrag({ unit: "Verpackungseinheit" })]),
      JETZT,
    );

    expect(bericht.verworfeneEinheiten).toBe(1);
    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(0);
  });

  it("verwirft einen ausgelisteten Artikel", async () => {
    const bericht = await fuehreSyncAus(umgebung.db, fakeFeed([frischerEintrag({ unavailable: true })]), JETZT);

    expect(bericht.uebersprungenUnavailable).toBe(1);
    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(0);
  });

  it("ignoriert eine dem Katalog unbekannte Kette (z. B. dm)", async () => {
    const bericht = await fuehreSyncAus(umgebung.db, fakeFeed([frischerEintrag({ store: "dm" })]), JETZT);

    expect(bericht.neueUngeklaerte).toBe(0);
    expect(bericht.uebersprungeneKetten).not.toContain("dm");
    expect(bericht.ignorierteKetten).toContain("dm");
  });

  it("wirft, wenn der Feed nicht erreichbar ist, und schreibt nichts", async () => {
    const abrufen = mock(async () => new Response("", { status: 500 })) as unknown as typeof fetch;

    await expect(fuehreSyncAus(umgebung.db, abrufen, JETZT)).rejects.toThrow();
    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(0);
  });

  it("schreibt eine Beobachtung, sobald der Artikel per Feed-Code zugeordnet ist", async () => {
    // Erster Lauf: legt den Prüflisten-Eintrag an.
    await fuehreSyncAus(umgebung.db, fakeFeed([frischerEintrag()]), JETZT);
    const [eintrag] = await holeUngeklaerte(umgebung.db);
    const produkt = await legeProduktAn(umgebung.db, { name: "Testartikel", menge: 250, einheit: "G" });
    await bestaetigeZuordnung(umgebung.db, {
      ungeklaertId: eintrag.id,
      chainId: eintrag.chainId,
      feedId: eintrag.feedId,
      rohname: eintrag.rohname,
      productId: produkt.id,
    });

    // Zweiter Lauf: muss jetzt über den Feed-Code treffen und eine Beobachtung schreiben.
    const bericht = await fuehreSyncAus(umgebung.db, fakeFeed([frischerEintrag()]), JETZT);

    expect(bericht.geschriebeneBeobachtungen).toBeGreaterThan(0);
    expect(bericht.neueUngeklaerte).toBe(0);
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `bun test tests/synchronisiere-ketten.test.ts`
Expected: FAIL — Modul `../scripts/synchronisiere-ketten` existiert nicht.

- [ ] **Step 3: Skript implementieren**

```ts
// scripts/synchronisiere-ketten.ts
/**
 * Täglicher Preisabgleich gegen den aggregierten Datensatz von
 * heisse-preise.io. Läuft im Produktions-Image über
 * `scripts/synchronisiere-ketten.js` (siehe Dockerfile), gestartet von
 * einem Coolify Scheduled Task — kein HTTP-Endpunkt, kein Webhook.
 *
 * `fuehreSyncAus` ist die testbare Kernlogik (nimmt `db` und `abrufen` als
 * Parameter); `main` unten ist nur die dünne Hülle für den echten Lauf.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { holeKetten, legeKettenAn } from "@/lib/katalog";
import {
  feedMengeZuBasiseinheit,
  gruppiereNachKette,
  holeFeed,
  istKetteAktuell,
  type FeedEintrag,
} from "@/lib/ketten-feed";
import { findeStoreProductPerFeedCode, findeStoreProductPerName, meldeUngeklaert } from "@/lib/ketten-abgleich";
import { synchronisiereBeobachtungen } from "@/lib/ketten-preise";
import type { DbOderTransaktion } from "@/lib/zugriff";
import { storeProduct } from "@/db/schema/katalog";
import { eq } from "drizzle-orm";

export type LaufBericht = {
  verarbeiteteKetten: string[];
  uebersprungeneKetten: string[];
  ignorierteKetten: string[];
  neueUngeklaerte: number;
  verworfeneEinheiten: number;
  uebersprungenUnavailable: number;
  geschriebeneBeobachtungen: number;
};

export async function fuehreSyncAus(
  db: DbOderTransaktion,
  abrufen: typeof fetch,
  jetzt: Date,
): Promise<LaufBericht> {
  await legeKettenAn(db);
  const ketten = await holeKetten(db);
  const kettenNachKuerzel = new Map(ketten.map((k) => [k.kuerzel, k]));

  const feed = await holeFeed(abrufen);
  const gruppen = gruppiereNachKette(feed);

  const bericht: LaufBericht = {
    verarbeiteteKetten: [],
    uebersprungeneKetten: [],
    ignorierteKetten: [],
    neueUngeklaerte: 0,
    verworfeneEinheiten: 0,
    uebersprungenUnavailable: 0,
    geschriebeneBeobachtungen: 0,
  };

  for (const [feedStore, eintraege] of gruppen) {
    const kette = kettenNachKuerzel.get(feedStore);
    if (!kette) {
      bericht.ignorierteKetten.push(feedStore);
      continue;
    }

    if (!istKetteAktuell(eintraege, jetzt)) {
      bericht.uebersprungeneKetten.push(feedStore);
      continue;
    }

    bericht.verarbeiteteKetten.push(feedStore);

    for (const eintrag of eintraege) {
      if (eintrag.unavailable) {
        bericht.uebersprungenUnavailable++;
        continue;
      }

      const menge = feedMengeZuBasiseinheit(eintrag.quantity, eintrag.unit);
      if (!menge) {
        bericht.verworfeneEinheiten++;
        continue;
      }

      const perFeedCode = await findeStoreProductPerFeedCode(db, kette.id, eintrag.id);
      const storeProductId =
        perFeedCode ??
        (await findeStoreProductPerName(db, kette.id, { rohname: eintrag.name, menge: menge.wert, einheit: menge.einheit }));

      if (!storeProductId) {
        await meldeUngeklaert(db, {
          chainId: kette.id,
          feedId: eintrag.id,
          rohname: eintrag.name,
          menge: menge.wert,
          einheit: menge.einheit,
          preis: eintrag.price,
        });
        bericht.neueUngeklaerte++;
        continue;
      }

      const geschrieben = await synchronisiereBeobachtungen(db, {
        storeProductId,
        chainId: kette.id,
        productId: (await holeProductIdFuer(db, storeProductId))!,
        menge,
        verlauf: eintrag.priceHistory,
      });
      bericht.geschriebeneBeobachtungen += geschrieben;
    }
  }

  return bericht;
}

/**
 * `synchronisiereBeobachtungen` braucht `productId` zusätzlich zu
 * `storeProductId` (dieselbe Redundanz wie in `schreibeBeobachtung` selbst
 * — siehe dortigen Kommentar). Ein einzelner Nachschlag hier ist einfacher
 * als jede aufrufende Stelle das Tripel selbst mitführen zu lassen.
 */
async function holeProductIdFuer(db: DbOderTransaktion, storeProductId: string): Promise<string | null> {
  const [zeile] = await db
    .select({ productId: storeProduct.productId })
    .from(storeProduct)
    .where(eq(storeProduct.id, storeProductId))
    .limit(1);
  return zeile?.productId ?? null;
}

async function main() {
  const datenbankUrl = process.env.DATABASE_URL;
  if (!datenbankUrl) {
    console.error("DATABASE_URL ist nicht gesetzt — Abbruch.");
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: datenbankUrl, connectionTimeoutMillis: 10_000 });
  const db: NodePgDatabase<Record<string, never>> = drizzle(pool);

  try {
    const bericht = await fuehreSyncAus(db, fetch, new Date());
    console.log("Ketten-Sync abgeschlossen:", JSON.stringify(bericht, null, 2));
    if (bericht.uebersprungeneKetten.length === bericht.verarbeiteteKetten.length + bericht.uebersprungeneKetten.length) {
      console.warn("Achtung: keine einzige Kette hatte aktuelle Daten — Feed-Ausfall?");
    }
  } catch (fehler) {
    console.error("Ketten-Sync fehlgeschlagen:", fehler);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  void main();
}
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `bun test tests/synchronisiere-ketten.test.ts`
Expected: PASS

- [ ] **Step 5: Dockerfile ergänzen**

In `Dockerfile`, direkt nach der Zeile, die `scripts/migrieren.ts` baut
(`RUN bun build ./scripts/migrieren.ts --target=bun --external pg --outfile=./scripts/migrieren.js`),
eine zweite Zeile nach demselben Muster ergänzen:

```dockerfile
RUN bun build ./scripts/synchronisiere-ketten.ts --target=bun --external pg --outfile=./scripts/synchronisiere-ketten.js
```

Und bei der `COPY --from=builder`-Zeile für `migrieren.js` eine zweite Zeile
für die neue Datei ergänzen:

```dockerfile
COPY --from=builder --chown=nextjs:nodejs /app/scripts/synchronisiere-ketten.js ./scripts/synchronisiere-ketten.js
```

- [ ] **Step 6: Docker-Build lokal prüfen**

Run: `docker build -t kassatrack-test .`
Expected: Build erfolgreich, keine Fehler beim neuen `RUN bun build …`-Schritt.

- [ ] **Step 7: Commit**

```bash
git add scripts/synchronisiere-ketten.ts tests/synchronisiere-ketten.test.ts Dockerfile
git commit -m "feat: Sync-Skript fuer den taeglichen Ketten-Preisabgleich"
```

---

### Task 6: Prüflisten-Oberfläche `/produkte/abgleich`

**Files:**
- Create: `src/app/produkte/abgleich/page.tsx`
- Create: `src/app/produkte/abgleich/aktionen.ts`
- Create: `src/app/produkte/abgleich/ungeklaert-zeile.tsx`
- Create: `src/app/produkte/abgleich/zustand.ts`
- Test: `tests/produkte-abgleich-aktionen.test.ts`
- Test: `tests/ungeklaert-zeile.test.tsx`

**Interfaces:**
- Konsumiert: `holeUngeklaerte`, `bestaetigeZuordnung`, `verwerfeUngeklaert`
  aus `@/lib/ketten-abgleich`; `sucheProdukte`, `legeProduktAn` aus
  `@/lib/katalog`; `requireUser` aus `@/lib/sitzung`; `Schaltflaeche` aus
  `@/components/ui/schaltflaeche` (Props exakt gegen die Datei prüfen, wie
  bei jedem vorherigen Plan).
- Produziert: die fertige Seite. Letzte Task dieses Plans (Task 7) macht
  nur noch Deployment-Doku und Gesamtverifikation.

**Vor dem Schreiben von UI-Code:** die Skills `impeccable`, `ui-ux-pro-max`
und `frontend-design` aufrufen (Gestaltungspflicht dieses Projekts). Danach
`src/app/verwaltung/zugriff/{page.tsx,aktionen.ts,zustand.ts,zugangs-zeile.tsx}`
und `src/app/produkte/page.tsx` lesen — diese Seite übernimmt deren Layout
(dichte Ebene, `Abschnitt`/`Leer`-Muster), aber das Gate von `/produkte`
(`requireUser()`, kein `holeBerechtigung()`).

- [ ] **Step 1: Server-Aktionen — Test schreiben**

```ts
// tests/produkte-abgleich-aktionen.test.ts
import { afterAll, describe, expect, it, mock } from "bun:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { holeKetten, legeKettenAn, legeProduktAn } from "@/lib/katalog";
import { holeUngeklaerte, meldeUngeklaert } from "@/lib/ketten-abgleich";
import { starteTestDatenbank } from "./helfer/db";

mock.module("@/lib/sitzung", () => ({
  requireUser: mock(async () => ({ id: "u1", email: "test@example.com", name: "Test" })),
}));
mock.module("next/cache", () => ({ revalidatePath: mock(() => {}) }));

const umgebung = await starteTestDatenbank();
await migrate(umgebung.db, { migrationsFolder: "./drizzle" });
await legeKettenAn(umgebung.db);
mock.module("@/db", () => ({ db: umgebung.db }));
afterAll(() => umgebung.stop());

const { ordneBestehendemProduktZu, legeAlsNeuesProduktAn, verwerfe } = await import(
  "@/app/produkte/abgleich/aktionen"
);

describe("ordneBestehendemProduktZu", () => {
  it("verknüpft den Prüflisten-Eintrag mit einem bestehenden Produkt", async () => {
    const [kette] = await holeKetten(umgebung.db);
    const produkt = await legeProduktAn(umgebung.db, { name: "Butter Abgleich", menge: 250, einheit: "G" });
    await meldeUngeklaert(umgebung.db, {
      chainId: kette.id, feedId: "abg-1", rohname: "BUTT.EXTRA", menge: 250, einheit: "G", preis: 2.49,
    });
    const [eintrag] = await holeUngeklaerte(umgebung.db);

    const ergebnis = await ordneBestehendemProduktZu(eintrag.id, produkt.id);

    expect(ergebnis.erfolg).toBe(true);
    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(0);
  });

  it("meldet einen Fehler bei unbekannter ungeklaertId", async () => {
    const produkt = await legeProduktAn(umgebung.db, { name: "Egal", menge: 1, einheit: "STK" });
    const ergebnis = await ordneBestehendemProduktZu("existiert-nicht", produkt.id);
    expect(ergebnis.erfolg).toBe(false);
  });
});

describe("legeAlsNeuesProduktAn", () => {
  it("legt ein neues Produkt an und verknüpft es", async () => {
    const [kette] = await holeKetten(umgebung.db);
    await meldeUngeklaert(umgebung.db, {
      chainId: kette.id, feedId: "abg-2", rohname: "Neuer Artikel", menge: 500, einheit: "ML", preis: 1.99,
    });
    const [eintrag] = await holeUngeklaerte(umgebung.db);

    const ergebnis = await legeAlsNeuesProduktAn(eintrag.id, { name: "Neuer Artikel", marke: null });

    expect(ergebnis.erfolg).toBe(true);
    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(0);
  });
});

describe("verwerfe", () => {
  it("löscht den Eintrag ohne Zuordnung", async () => {
    const [kette] = await holeKetten(umgebung.db);
    await meldeUngeklaert(umgebung.db, {
      chainId: kette.id, feedId: "abg-3", rohname: "Wird verworfen", menge: 1, einheit: "STK", preis: 0.5,
    });
    const [eintrag] = await holeUngeklaerte(umgebung.db);

    await verwerfe(eintrag.id);

    expect(await holeUngeklaerte(umgebung.db)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `bun test tests/produkte-abgleich-aktionen.test.ts`
Expected: FAIL — `@/app/produkte/abgleich/aktionen` existiert nicht.

- [ ] **Step 3: Server-Aktionen implementieren**

```ts
// src/app/produkte/abgleich/aktionen.ts
"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import type { Basiseinheit } from "@/lib/einheiten";
import { legeProduktAn, sucheProdukte } from "@/lib/katalog";
import { bestaetigeZuordnung, holeUngeklaerte, verwerfeUngeklaert } from "@/lib/ketten-abgleich";
import { requireUser } from "@/lib/sitzung";

type Ergebnis = { erfolg: true } | { erfolg: false; meldung: string };

async function holeEintragOderNull(ungeklaertId: string) {
  const liste = await holeUngeklaerte(db);
  return liste.find((e) => e.id === ungeklaertId) ?? null;
}

export async function ordneBestehendemProduktZu(ungeklaertId: string, productId: string): Promise<Ergebnis> {
  await requireUser();

  const eintrag = await holeEintragOderNull(ungeklaertId);
  if (!eintrag) return { erfolg: false, meldung: "Dieser Prüflisten-Eintrag existiert nicht mehr." };

  await bestaetigeZuordnung(db, {
    ungeklaertId,
    chainId: eintrag.chainId,
    feedId: eintrag.feedId,
    rohname: eintrag.rohname,
    productId,
  });

  revalidatePath("/produkte/abgleich");
  return { erfolg: true };
}

export async function legeAlsNeuesProduktAn(
  ungeklaertId: string,
  eingabe: { name: string; marke: string | null },
): Promise<Ergebnis> {
  await requireUser();

  const eintrag = await holeEintragOderNull(ungeklaertId);
  if (!eintrag) return { erfolg: false, meldung: "Dieser Prüflisten-Eintrag existiert nicht mehr." };

  const produkt = await legeProduktAn(db, {
    name: eingabe.name,
    marke: eingabe.marke,
    menge: eintrag.menge,
    einheit: eintrag.einheit as Basiseinheit,
  });

  await bestaetigeZuordnung(db, {
    ungeklaertId,
    chainId: eintrag.chainId,
    feedId: eintrag.feedId,
    rohname: eintrag.rohname,
    productId: produkt.id,
  });

  revalidatePath("/produkte/abgleich");
  return { erfolg: true };
}

export async function verwerfe(ungeklaertId: string): Promise<void> {
  await requireUser();
  await verwerfeUngeklaert(db, ungeklaertId);
  revalidatePath("/produkte/abgleich");
}

export async function sucheKatalog(begriff: string) {
  await requireUser();
  return sucheProdukte(db, begriff);
}
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `bun test tests/produkte-abgleich-aktionen.test.ts`
Expected: PASS

- [ ] **Step 5: `zustand.ts` — Formatierung**

```ts
// src/app/produkte/abgleich/zustand.ts
import { formatierePackung, type Basiseinheit } from "@/lib/einheiten";

/** Kurzer Hinweis zur Gebindegröße neben dem Rohnamen, z. B. „250 g". */
export function formatiereGroesse(menge: number, einheit: Basiseinheit): string {
  return formatierePackung(menge, einheit);
}
```

- [ ] **Step 6: `ungeklaert-zeile.tsx` — Komponententest schreiben**

```tsx
// tests/ungeklaert-zeile.test.tsx
import "./dom";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { render } from "@testing-library/react";
import { describe, expect, it, mock } from "bun:test";
import { UngeklaertZeile } from "@/app/produkte/abgleich/ungeklaert-zeile";

const EINTRAG = {
  id: "u1",
  rohname: "BUTT.EXTRA 250",
  menge: 250,
  einheit: "G" as const,
  letzterPreis: 2.49,
  kettenName: "Billa",
};

describe("UngeklaertZeile", () => {
  it("zeigt Rohname, Größe und Preis", () => {
    render(
      <UngeklaertZeile
        eintrag={EINTRAG}
        sucheKatalog={async () => []}
        ordneZu={async () => ({ erfolg: true })}
        legeNeuAn={async () => ({ erfolg: true })}
        verwerfe={async () => {}}
      />,
    );

    expect(screen.getByText(/BUTT\.EXTRA 250/)).toBeTruthy();
    expect(screen.getByText(/250 g/)).toBeTruthy();
    expect(screen.getByText(/2,49/)).toBeTruthy();
  });

  it("sucht im Katalog und zeigt Treffer", async () => {
    const sucheKatalog = mock(async () => [
      { id: "p1", name: "Butter", marke: "Berglandmilch", menge: 250, einheit: "G" as const, bildSchluessel: null },
    ]);

    render(
      <UngeklaertZeile
        eintrag={EINTRAG}
        sucheKatalog={sucheKatalog}
        ordneZu={async () => ({ erfolg: true })}
        legeNeuAn={async () => ({ erfolg: true })}
        verwerfe={async () => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Bestehendem Produkt zuordnen/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /Produkt suchen/i }), { target: { value: "butter" } });

    await waitFor(() => expect(screen.getByText(/Berglandmilch/)).toBeTruthy());
  });

  it("ruft ordneZu mit der productId eines Treffers auf", async () => {
    const sucheKatalog = mock(async () => [
      { id: "p1", name: "Butter", marke: null, menge: 250, einheit: "G" as const, bildSchluessel: null },
    ]);
    const ordneZu = mock(async () => ({ erfolg: true as const }));

    render(
      <UngeklaertZeile
        eintrag={EINTRAG}
        sucheKatalog={sucheKatalog}
        ordneZu={ordneZu}
        legeNeuAn={async () => ({ erfolg: true })}
        verwerfe={async () => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Bestehendem Produkt zuordnen/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /Produkt suchen/i }), { target: { value: "butter" } });
    await waitFor(() => screen.getByText("Butter"));
    fireEvent.click(screen.getByRole("button", { name: /Diesem Produkt zuordnen/i }));

    await waitFor(() => expect(ordneZu).toHaveBeenCalledWith("u1", "p1"));
  });

  it("ruft legeNeuAn mit dem vorbefüllten Namen auf", async () => {
    const legeNeuAn = mock(async () => ({ erfolg: true as const }));

    render(
      <UngeklaertZeile
        eintrag={EINTRAG}
        sucheKatalog={async () => []}
        ordneZu={async () => ({ erfolg: true })}
        legeNeuAn={legeNeuAn}
        verwerfe={async () => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Als neues Produkt anlegen/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Anlegen$/i }));

    await waitFor(() => expect(legeNeuAn).toHaveBeenCalledWith("u1", { name: "BUTT.EXTRA 250", marke: null }));
  });

  it("ruft verwerfe auf", async () => {
    const verwerfe = mock(async () => {});

    render(
      <UngeklaertZeile
        eintrag={EINTRAG}
        sucheKatalog={async () => []}
        ordneZu={async () => ({ erfolg: true })}
        legeNeuAn={async () => ({ erfolg: true })}
        verwerfe={verwerfe}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Verwerfen$/i }));

    await waitFor(() => expect(verwerfe).toHaveBeenCalledWith("u1"));
  });
});
```

- [ ] **Step 7: Test ausführen — muss fehlschlagen**

Run: `bun test tests/ungeklaert-zeile.test.tsx`
Expected: FAIL — Modul existiert nicht.

- [ ] **Step 8: `ungeklaert-zeile.tsx` implementieren**

Vor dieser Implementierung `src/components/ui/schaltflaeche.tsx` lesen und
die echten Props (`Variante`, `type`-Vorgabe `"button"`, `disabled`/`laedt`)
gegenprüfen. Struktur: eine Zeile mit Rohname/Größe/Preis, darunter
klappbar entweder eine Katalogsuche (Debounced-Suche über `sucheKatalog`,
Trefferliste mit „Diesem Produkt zuordnen"-Knopf je Treffer) oder ein
Formular für „Als neues Produkt anlegen" (Name vorbefüllt aus `rohname`,
Markenfeld leer), dazu ein „Verwerfen"-Knopf. Zwei `useState`-Schalter
(`zeigeSuche`, `zeigeNeuAnlegen`), gegenseitig exklusiv. Kein Massen-Import,
jede Aktion einzeln bestätigt (Muster aus dem Design-Dokument).

```tsx
// src/app/produkte/abgleich/ungeklaert-zeile.tsx
"use client";

import { useState } from "react";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";
import { formatiereBetrag, type Basiseinheit } from "@/lib/einheiten";
import type { Produkt } from "@/lib/katalog";
import { formatiereGroesse } from "./zustand";

type Eintrag = {
  id: string;
  rohname: string;
  menge: number;
  einheit: Basiseinheit;
  letzterPreis: number;
  kettenName: string;
};

type Ergebnis = { erfolg: true } | { erfolg: false; meldung: string };

export function UngeklaertZeile({
  eintrag,
  sucheKatalog,
  ordneZu,
  legeNeuAn,
  verwerfe,
}: {
  eintrag: Eintrag;
  sucheKatalog: (begriff: string) => Promise<Produkt[]>;
  ordneZu: (ungeklaertId: string, productId: string) => Promise<Ergebnis>;
  legeNeuAn: (ungeklaertId: string, eingabe: { name: string; marke: string | null }) => Promise<Ergebnis>;
  verwerfe: (ungeklaertId: string) => Promise<void>;
}) {
  const [modus, setModus] = useState<"ruhig" | "suche" | "neu">("ruhig");
  const [suchbegriff, setSuchbegriff] = useState("");
  const [treffer, setTreffer] = useState<Produkt[]>([]);
  const [meldung, setMeldung] = useState<string | null>(null);

  async function beiSuchbegriff(wert: string) {
    setSuchbegriff(wert);
    if (wert.trim() === "") {
      setTreffer([]);
      return;
    }
    setTreffer(await sucheKatalog(wert));
  }

  async function beiZuordnung(productId: string) {
    const ergebnis = await ordneZu(eintrag.id, productId);
    if (!ergebnis.erfolg) setMeldung(ergebnis.meldung);
  }

  async function beiAnlegen() {
    const ergebnis = await legeNeuAn(eintrag.id, { name: eintrag.rohname, marke: null });
    if (!ergebnis.erfolg) setMeldung(ergebnis.meldung);
  }

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[0.9375rem] font-medium">{eintrag.rohname}</span>
        <span className="text-xs text-gedaempft">
          {eintrag.kettenName} · {formatiereGroesse(eintrag.menge, eintrag.einheit)} ·{" "}
          {formatiereBetrag(eintrag.letzterPreis)} €
        </span>
      </div>

      {meldung && (
        <p role="alert" className="text-xs text-auf-hinweis">
          {meldung}
        </p>
      )}

      {modus === "ruhig" && (
        <div className="flex flex-wrap gap-2">
          <Schaltflaeche variante="neben" onClick={() => setModus("suche")}>
            Bestehendem Produkt zuordnen
          </Schaltflaeche>
          <Schaltflaeche variante="neben" onClick={() => setModus("neu")}>
            Als neues Produkt anlegen
          </Schaltflaeche>
          <Schaltflaeche variante="gefahr" onClick={() => verwerfe(eintrag.id)}>
            Verwerfen
          </Schaltflaeche>
        </div>
      )}

      {modus === "suche" && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs">
            Produkt suchen
            <input
              className="min-h-[2.75rem] rounded-klein border border-linie px-3 text-[0.9375rem]"
              value={suchbegriff}
              onChange={(e) => beiSuchbegriff(e.target.value)}
            />
          </label>
          <ul className="flex flex-col gap-1">
            {treffer.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span className="text-sm">
                  {p.name}
                  {p.marke ? ` · ${p.marke}` : ""}
                </span>
                <Schaltflaeche variante="haupt" onClick={() => beiZuordnung(p.id)}>
                  Diesem Produkt zuordnen
                </Schaltflaeche>
              </li>
            ))}
          </ul>
          <Schaltflaeche variante="neben" onClick={() => setModus("ruhig")}>
            Abbrechen
          </Schaltflaeche>
        </div>
      )}

      {modus === "neu" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Neues Produkt „{eintrag.rohname}", {formatiereGroesse(eintrag.menge, eintrag.einheit)}
          </p>
          <div className="flex gap-2">
            <Schaltflaeche variante="haupt" onClick={beiAnlegen}>
              Anlegen
            </Schaltflaeche>
            <Schaltflaeche variante="neben" onClick={() => setModus("ruhig")}>
              Abbrechen
            </Schaltflaeche>
          </div>
        </div>
      )}
    </li>
  );
}
```

- [ ] **Step 9: Test ausführen — muss bestehen**

Run: `bun test tests/ungeklaert-zeile.test.tsx`
Expected: PASS (Selektoren im Test ggf. an die tatsächlichen ARIA-Namen
anpassen, die aus obiger Struktur entstehen — Text-Content der Knöpfe ist
maßgeblich).

- [ ] **Step 10: `page.tsx`**

```tsx
// src/app/produkte/abgleich/page.tsx
import type { Metadata } from "next";
import { db } from "@/db";
import { holeUngeklaerte } from "@/lib/ketten-abgleich";
import { holeKetten } from "@/lib/katalog";
import { requireUser } from "@/lib/sitzung";
import { legeAlsNeuesProduktAn, ordneBestehendemProduktZu, sucheKatalog, verwerfe } from "./aktionen";
import { UngeklaertZeile } from "./ungeklaert-zeile";

export const metadata: Metadata = { title: "Katalogabgleich — KassaTrack" };
export const dynamic = "force-dynamic";

export default async function AbgleichSeite() {
  await requireUser();

  const [eintraege, ketten] = await Promise.all([holeUngeklaerte(db), holeKetten(db)]);
  const kettenNamen = new Map(ketten.map((k) => [k.id, k.name]));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 pt-8 pb-12 sm:px-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-anzeige text-[1.75rem] leading-tight font-semibold tracking-[-0.03em]">
          Katalogabgleich
        </h1>
        <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-gedaempft">
          Artikel aus dem täglichen Ketten-Sync, die sich nicht von selbst zuordnen ließen.
        </p>
      </header>

      {eintraege.length === 0 ? (
        <p className="rounded-block bg-flaeche px-4 py-5 text-[0.9375rem] leading-relaxed text-gedaempft">
          Nichts offen — jeder Artikel aus dem letzten Sync fand sein Produkt.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-linie">
          {eintraege.map((eintrag) => (
            <UngeklaertZeile
              key={eintrag.id}
              eintrag={{ ...eintrag, kettenName: kettenNamen.get(eintrag.chainId) ?? eintrag.chainId }}
              sucheKatalog={sucheKatalog}
              ordneZu={ordneBestehendemProduktZu}
              legeNeuAn={legeAlsNeuesProduktAn}
              verwerfe={verwerfe}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 11: Volle Suite, Typecheck, Build**

```bash
bun test
bunx tsc --noEmit
bun run build
```

Expected: alle drei sauber.

- [ ] **Step 12: Browser-Verifikation**

Seite `/produkte/abgleich` in echter oder Wegwerf-Ausführung (je nachdem,
was in dieser Umgebung an echter Sitzung möglich ist — bei Bedarf dieselbe
Wegwerf-Route-Technik wie in Plan 4 verwenden, danach löschen) ansehen: mit
mehreren Prüflisten-Einträgen, Katalogsuche mit Treffern und ohne, neues
Produkt anlegen, verwerfen. Konsole auf CSP-Verstöße prüfen. Screenshots
nach `docs/bilder/`.

- [ ] **Step 13: Commit**

```bash
git add src/app/produkte/abgleich tests/produkte-abgleich-aktionen.test.ts tests/ungeklaert-zeile.test.tsx docs/bilder
git commit -m "feat: Oberflaeche zum Aufloesen der Ketten-Sync-Pruefliste"
```

---

### Task 7: Deployment-Dokumentation und Gesamtverifikation

**Files:**
- Modify: `docs/deployment-coolify.md`
- Modify: `docs/offene-punkte.md`

**Interfaces:**
- Konsumiert: alles aus Tasks 1–6.

- [ ] **Step 1: Deployment-Abschnitt ergänzen**

In `docs/deployment-coolify.md`, nach dem Abschnitt „6. Migrationen
ausführen", einen neuen Abschnitt „7. Ketten-Sync einrichten" ergänzen —
nach demselben Muster wie der Migrations-Abschnitt: was das Skript tut,
warum es vorkompiliert ist (kein Registry-Zugriff zur Laufzeit außer dem
einen Feed-Abruf), und die konkreten Schritte, einen Coolify Scheduled Task
anzulegen, der täglich `bun scripts/synchronisiere-ketten.js` im laufenden
Container ausführt. Erwähnen, dass ein Fehlschlag im Coolify-Task-Log
sichtbar wird (`console.error` vor `process.exitCode = 1`) und dass ein
einzelner Fehlschlag unkritisch ist — am nächsten Tag läuft der nächste
Sync unabhängig vom vorherigen.

- [ ] **Step 2: `docs/offene-punkte.md` — Abschnitt „Aus dem Ketten-API-Sync"**

Nach dem Muster der vorherigen Abschnitte (Erledigt / Warten / Bewusste
Entscheidungen). Mindestens:

- Bewusste Entscheidungen: kein unscharfes Matching (siehe Design-Spec);
  keine Aktions-/Loyalty-Preise aus dem Sync; keine automatische
  Ketten-Anlage; aggregierter Datensatz statt eigener Shop-Scraper.
- Warten: Lidl und Penny stehen aktuell nicht im Feed und werden von der
  Aktualitätsprüfung automatisch übersprungen — sollte heisse-preise.io sie
  je aufnehmen, greift der Sync ohne Codeänderung.
- Jede beim Implementieren tatsächlich aufgetretene Abweichung oder Lücke
  (durch den Implementierer beim Abschluss zu ergänzen).

- [ ] **Step 3: Gesamtverifikation**

```bash
docker compose up -d postgres-test
bun test
bunx tsc --noEmit
bun run build
git grep -nE "(GOCSPX-|sk-[A-Za-z0-9]{20,})" -- . ':!docs'
```

Erwartet: alles sauber, kein Treffer im Secret-Grep.

- [ ] **Step 4: Commit**

```bash
git add docs/deployment-coolify.md docs/offene-punkte.md
git commit -m "docs: Deployment-Anleitung und offene Punkte fuer den Ketten-Sync"
```

## Verifikation

**Dieser Plan gilt als fertig, wenn:**

1. `bun test`, `bunx tsc --noEmit`, `bun run build`, `docker build` fehlerfrei
2. Ein Testlauf von `fuehreSyncAus` gegen einen erfundenen Feed zeigt: ein
   zugeordneter Artikel schreibt eine Beobachtung mit korrektem Grundpreis
   (nicht dem rohen Feed-Preis), ein nicht zuordenbarer landet in der
   Prüfliste, eine Kette ohne frische Daten wird übersprungen, ein
   ausgelisteter oder einheitlich nicht deutbarer Artikel wird verworfen
3. `/produkte/abgleich` zeigt offene Fälle, erlaubt Zuordnung zu einem
   bestehenden oder neuen Produkt, und die Liste wird danach kürzer
4. Ein zweiter Sync-Lauf mit identischem Feed-Inhalt schreibt keine
   zusätzliche Beobachtung (Idempotenz)
5. Die Migrations-Zeitstempel-Falle wurde bei der neuen Migration
   ausdrücklich behandelt (siehe Task 1, Schritt 3), nicht stillschweigend
   riskiert

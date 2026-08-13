# Plan 3: Barcode-Scan und Produktbilder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein gescannter Strichcode füllt das bestehende Erfassungsformular
(`/erfassen`) mit Name, Marke, Menge und Bild vor — über `product_ean`,
Open Food Facts und, falls nötig, einen Fuzzy-Vorschlag auf bereits
bekannte Produkte.

**Architecture:** Eine Client-Komponente liest den Strichcode über die
native `BarcodeDetector`-API. Eine Server Action löst die EAN in drei
Stufen auf (bekannt → Open Food Facts → Fuzzy-Vorschlag), legt bei Bedarf
ein neues Produkt an, verknüpft die EAN und lädt das Bild serverseitig in
ein Docker-Volume, das eine eigene Route ausliefert. Der bestehende
Preis-Speicherpfad (`erfasse` aus Plan 2) bleibt unverändert.

**Tech Stack:** Next.js 16 (App Router, Server Actions, Route Handler),
React 19, TypeScript 7, Drizzle 0.45, Bun 1.3, native `BarcodeDetector`
Web-API, Open Food Facts API v2 (kein SDK, direkter `fetch`).

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
- **`mock.module` gilt in Bun für den ganzen Testlauf.** Jede Attrappe von
  `@/db`, `@/lib/sitzung`, `next/cache` muss das echte Modul spreizen.
  **In diesem Plan wird für externe Aufrufe (HTTP, Kamera) grundsätzlich
  keine `mock.module`-Attrappe verwendet** — siehe Task 2 und Task 6.
- Deutsch, österreichisches Vokabular, deutsche Routensegmente.
- Echtes Postgres in Tests, keine Mocks, für alles Datenbanknahe.
- **Gestaltungspflicht für Tasks 6 und 7** (Kamera-Ansicht,
  Vorschlags-Bildschirm): vor der Umsetzung die Skills `impeccable`,
  `ui-ux-pro-max` und `frontend-design` aufrufen und deren Ergebnis
  umsetzen. Bestehendes Gestaltungssystem erben (`src/app/globals.css`,
  `Schaltflaeche`, Marke `#005860`), nicht neu herleiten.
- **Vor der Implementierung von Task 2 zu verifizieren, nicht anzunehmen:**
  das exakte Feld-Mapping der Open-Food-Facts-v2-Antwort und die aktuellen
  Richtlinien zu `User-Agent`/Ratenbegrenzung — gegen die offizielle
  Dokumentation unter `https://openfoodfacts.github.io/openfoodfacts-server/api/`
  prüfen, nicht aus Trainingsdaten übernehmen.
- Ein Commit je Task, deutsche Nachricht, `feat:`/`fix:`-Präfix nach den
  Commit-Konventionen der bisherigen Pläne.

---

## Dateiübersicht

| Datei | Rolle |
|---|---|
| `src/lib/produkt-ean.ts` | **Neu.** `findeProduktPerEan`, `verknuepfeEan` — löst den in `docs/offene-punkte.md` vermerkten Trennungsbedarf von `katalog.ts` ein. |
| `src/lib/katalog.ts` | **Geändert.** `Produkt`-Typ und seine vier Projektionen bekommen `bildSchluessel`. |
| `src/lib/open-food-facts.ts` | **Neu.** HTTP-Client, Abruffunktion injiziert, kein `mock.module`. |
| `src/lib/produktbilder.ts` | **Neu.** Schreiben/Lesen von Bildern im konfigurierten Verzeichnis, plus `ladeUndSpeichereBild` (Download + Ablage + `bildSchluessel` setzen). |
| `src/app/bilder/produkte/[schluessel]/route.ts` | **Neu.** Liefert ein zwischengespeichertes Bild aus. |
| `src/app/erfassen/ean-zustand.ts` | **Neu.** Typen für die EAN-Auflösung (analog zu `zustand.ts`). |
| `src/app/erfassen/ean-aktionen.ts` | **Neu.** Server Actions `loeseEanAuf`, `bestaetigeZuordnung`. |
| `src/app/erfassen/strichcode-scanner.tsx` | **Neu.** Client-Komponente, Kamera + `BarcodeDetector`, Decoder injiziert. |
| `src/app/erfassen/erfassungs-formular.tsx` | **Geändert.** Bindet den Scanner ein, verarbeitet die drei Auflösungs-Ergebnisse. |
| `src/app/erfassen/page.tsx` | **Geändert.** Reicht `loeseEanAuf`/`bestaetigeZuordnung` als Props durch. |
| `src/lib/env.ts`, `.env.example` | **Geändert.** `PRODUKTBILDER_VERZEICHNIS`. |
| `.gitignore`, `compose.yaml`, `Dockerfile`, `docs/deployment-coolify.md` | **Geändert.** Lokales Bildverzeichnis, Coolify-Volume, Dokumentation. |
| `docs/offene-punkte.md` | **Geändert.** Neuer Abschnitt „Aus Plan 3" am Ende (Task 8). |

---

### Task 1: Umgebungsvariable und Bildspeicher

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `.env.example`
- Modify: `.gitignore`
- Create: `src/lib/produktbilder.ts`
- Test: `tests/produktbilder.test.ts`

**Interfaces:**
- Produces: `env.PRODUKTBILDER_VERZEICHNIS: string`, `schreibeBild(verzeichnis: string, schluessel: string, daten: Buffer): Promise<void>`, `lesePfadZuBild(verzeichnis: string, schluessel: string): string`, `erzeugeBildSchluessel(ean: string): string`

- [ ] **Step 1: Umgebungsvariable ergänzen**

In `src/lib/env.ts`, der Zod-Schema-Definition eine Zeile hinzufügen:

```ts
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  PRODUKTBILDER_VERZEICHNIS: z.string().min(1).default("./daten/produktbilder"),
});
```

In `.env.example` ergänzen:

```
# Produktbilder — lokal ein relativer Ordner, in Coolify ein eingehängtes Volume
PRODUKTBILDER_VERZEICHNIS=./daten/produktbilder
```

In `.gitignore`, unter dem Abschnitt „misc", ergänzen:

```
# lokal zwischengespeicherte Produktbilder (Plan 3)
/daten/
```

- [ ] **Step 2: Fehlschlagenden Test für den Bildspeicher schreiben**

```ts
// tests/produktbilder.test.ts
import { describe, expect, it, afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  erzeugeBildSchluessel,
  lesePfadZuBild,
  schreibeBild,
} from "@/lib/produktbilder";

let verzeichnis: string;

afterEach(async () => {
  if (verzeichnis) await rm(verzeichnis, { recursive: true, force: true });
});

describe("erzeugeBildSchluessel", () => {
  it("liefert einen dateisystemsicheren Schlüssel aus der EAN", () => {
    expect(erzeugeBildSchluessel("9001234567892")).toBe("9001234567892.jpg");
  });

  it("weist eine EAN mit Pfadtrennzeichen ab", () => {
    expect(() => erzeugeBildSchluessel("../../etc/passwd")).toThrow();
  });
});

describe("schreibeBild / lesePfadZuBild", () => {
  it("schreibt die Bytes unverändert und liefert denselben Pfad beim Lesen", async () => {
    verzeichnis = await mkdtemp(join(tmpdir(), "produktbilder-"));
    const schluessel = erzeugeBildSchluessel("9001234567892");
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    await schreibeBild(verzeichnis, schluessel, bytes);

    const pfad = lesePfadZuBild(verzeichnis, schluessel);
    const gelesen = await readFile(pfad);
    expect(gelesen).toEqual(bytes);
  });

  it("legt das Zielverzeichnis an, falls es noch nicht existiert", async () => {
    verzeichnis = join(await mkdtemp(join(tmpdir(), "produktbilder-")), "tiefer", "verschachtelt");
    const schluessel = erzeugeBildSchluessel("9001234567892");

    await schreibeBild(verzeichnis, schluessel, Buffer.from([1, 2, 3]));

    const gelesen = await readFile(lesePfadZuBild(verzeichnis, schluessel));
    expect(gelesen).toEqual(Buffer.from([1, 2, 3]));
  });
});
```

- [ ] **Step 3: Test ausführen, Fehlschlag bestätigen**

Run: `bun test tests/produktbilder.test.ts`
Expected: FAIL — `Cannot find module '@/lib/produktbilder'`

- [ ] **Step 4: `src/lib/produktbilder.ts` implementieren**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Der Schlüssel ist der Dateiname im Bildverzeichnis. Er entsteht aus der
 * EAN, weil eine EAN pro Definition genau ein Bild meint — ein zweiter Scan
 * derselben EAN muss denselben Schlüssel treffen, sonst würde jedes Mal neu
 * heruntergeladen.
 *
 * Die Prüfung auf Ziffern schließt Pfadtrennzeichen aus. Ohne sie könnte eine
 * verunstaltete EAN aus einem beschädigten Scan zu einem Pfad außerhalb des
 * Bildverzeichnisses führen.
 */
export function erzeugeBildSchluessel(ean: string): string {
  if (!/^\d+$/.test(ean)) {
    throw new Error(`Ungültige EAN für einen Bildschlüssel: ${ean}`);
  }
  return `${ean}.jpg`;
}

export function lesePfadZuBild(verzeichnis: string, schluessel: string): string {
  return join(verzeichnis, schluessel);
}

export async function schreibeBild(
  verzeichnis: string,
  schluessel: string,
  daten: Buffer,
): Promise<void> {
  const pfad = lesePfadZuBild(verzeichnis, schluessel);
  await mkdir(dirname(pfad), { recursive: true });
  await writeFile(pfad, daten);
}
```

- [ ] **Step 5: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/produktbilder.test.ts`
Expected: PASS — 4 Tests

- [ ] **Step 6: `bunx tsc --noEmit` ausführen**

Expected: keine Fehler

- [ ] **Step 7: Commit**

```bash
git add src/lib/produktbilder.ts src/lib/env.ts .env.example .gitignore tests/produktbilder.test.ts
git commit -m "feat: Bildspeicher-Grundfunktionen und Umgebungsvariable"
```

---

### Task 2: Open-Food-Facts-Client

**Files:**
- Create: `src/lib/open-food-facts.ts`
- Test: `tests/open-food-facts.test.ts`

**Interfaces:**
- Consumes: `zerlegeMenge(eingabe: string): { menge: number; einheit: Basiseinheit } | null` aus `@/lib/einheiten`
- Produces: `type OffTreffer = { name: string; marke: string | null; menge: number; einheit: Basiseinheit; bildUrl: string | null }`, `holeOffProdukt(ean: string, abrufen: typeof fetch): Promise<OffTreffer | null>`

**Vor Step 4 zu erledigen:** die offizielle Open-Food-Facts-Dokumentation
(`https://openfoodfacts.github.io/openfoodfacts-server/api/ref-v2/`) gegen
die Annahmen unten prüfen — insbesondere ob `status: 0` im JSON-Body oder
ein HTTP-404 den „nicht gefunden"-Fall trägt, und welcher `User-Agent`
verlangt wird. Die Implementierung unten geht von beidem defensiv aus
(prüft sowohl HTTP-Status als auch `status`-Feld); falls die Doku etwas
anderes zeigt, diesen Schritt entsprechend anpassen, bevor der Test
geschrieben wird.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

```ts
// tests/open-food-facts.test.ts
import { describe, expect, it, mock } from "bun:test";
import { holeOffProdukt } from "@/lib/open-food-facts";

function fakeAbruf(antwort: unknown, status = 200) {
  return mock(async () => new Response(JSON.stringify(antwort), { status })) as unknown as typeof fetch;
}

describe("holeOffProdukt", () => {
  it("liefert Name, Marke, Menge und Bild-URL bei einem Treffer", async () => {
    const abrufen = fakeAbruf({
      status: 1,
      product: {
        product_name: "Butter",
        brands: "Berglandmilch,Andere Marke",
        quantity: "250 g",
        image_front_url: "https://images.openfoodfacts.org/butter.jpg",
      },
    });

    const treffer = await holeOffProdukt("9001234567892", abrufen);

    expect(treffer).toEqual({
      name: "Butter",
      marke: "Berglandmilch",
      menge: 250,
      einheit: "G",
      bildUrl: "https://images.openfoodfacts.org/butter.jpg",
    });
    expect(abrufen).toHaveBeenCalledTimes(1);
    const [url, optionen] = (abrufen as ReturnType<typeof mock>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("9001234567892");
    expect((optionen.headers as Record<string, string>)["User-Agent"]).toContain("KassaTrack");
  });

  it("liefert null, wenn Open Food Facts das Produkt nicht kennt (status 0)", async () => {
    const abrufen = fakeAbruf({ status: 0 });
    expect(await holeOffProdukt("0000000000000", abrufen)).toBeNull();
  });

  it("liefert null bei HTTP 404", async () => {
    const abrufen = fakeAbruf({}, 404);
    expect(await holeOffProdukt("0000000000000", abrufen)).toBeNull();
  });

  it("liefert null, wenn die Menge sich nicht zerlegen lässt", async () => {
    const abrufen = fakeAbruf({
      status: 1,
      product: { product_name: "Mysteriöses Produkt", quantity: "ein bisschen" },
    });
    expect(await holeOffProdukt("9001234567892", abrufen)).toBeNull();
  });

  it("liefert bildUrl als null, wenn kein Bild vorhanden ist", async () => {
    const abrufen = fakeAbruf({
      status: 1,
      product: { product_name: "Butter", quantity: "250 g" },
    });
    const treffer = await holeOffProdukt("9001234567892", abrufen);
    expect(treffer?.bildUrl).toBeNull();
  });

  it("liefert marke als null, wenn keine Marke angegeben ist", async () => {
    const abrufen = fakeAbruf({
      status: 1,
      product: { product_name: "Butter", quantity: "250 g" },
    });
    const treffer = await holeOffProdukt("9001234567892", abrufen);
    expect(treffer?.marke).toBeNull();
  });

  it("gibt einen Netzwerkfehler weiter, statt ihn zu verschlucken", async () => {
    const abrufen = mock(async () => {
      throw new Error("Netzwerk nicht erreichbar");
    }) as unknown as typeof fetch;

    await expect(holeOffProdukt("9001234567892", abrufen)).rejects.toThrow(
      "Netzwerk nicht erreichbar",
    );
  });
});
```

Hinweis zum letzten Test: `holeOffProdukt` selbst fragt keine Datenbank ab
— `.rejects` ist hier zulässig, die Bun/Windows-Falle betrifft ausschließlich
Versprechen, die eine Datenbankverbindung öffnen.

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `bun test tests/open-food-facts.test.ts`
Expected: FAIL — Modul nicht gefunden

- [ ] **Step 3: `src/lib/open-food-facts.ts` implementieren**

```ts
import { zerlegeMenge, type Basiseinheit } from "@/lib/einheiten";

export type OffTreffer = {
  name: string;
  marke: string | null;
  menge: number;
  einheit: Basiseinheit;
  bildUrl: string | null;
};

type OffAntwort = {
  status?: number;
  product?: {
    product_name?: string;
    brands?: string;
    quantity?: string;
    image_front_url?: string;
  };
};

/**
 * Fragt Open Food Facts nach einer EAN. Liefert `null` für jeden Fall, in
 * dem kein brauchbarer Datensatz entsteht — nicht gefunden, kein Name, keine
 * zerlegbare Menge —, damit der Aufrufer immer denselben Weg geht wie bei
 * einer völlig unbekannten EAN. Ein Netzwerkfehler ist davon ausdrücklich
 * ausgenommen: Er ist kein „nicht gefunden", sondern ein Grund, es später
 * noch einmal zu versuchen, und wird deshalb weitergereicht.
 */
export async function holeOffProdukt(
  ean: string,
  abrufen: typeof fetch,
): Promise<OffTreffer | null> {
  const antwort = await abrufen(
    `https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,brands,quantity,image_front_url`,
    { headers: { "User-Agent": "KassaTrack - https://github.com/rolkef/kassatrack" } },
  );

  if (!antwort.ok) return null;

  const daten = (await antwort.json()) as OffAntwort;
  if (daten.status === 0 || !daten.product) return null;

  const name = daten.product.product_name?.trim();
  if (!name) return null;

  const zerlegt = zerlegeMenge(daten.product.quantity ?? "");
  if (!zerlegt) return null;

  const marke = daten.product.brands?.split(",")[0]?.trim() || null;

  return {
    name,
    marke,
    menge: zerlegt.menge,
    einheit: zerlegt.einheit,
    bildUrl: daten.product.image_front_url ?? null,
  };
}
```

- [ ] **Step 4: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/open-food-facts.test.ts`
Expected: PASS — 7 Tests

- [ ] **Step 5: `bunx tsc --noEmit` ausführen**

Expected: keine Fehler

- [ ] **Step 6: Commit**

```bash
git add src/lib/open-food-facts.ts tests/open-food-facts.test.ts
git commit -m "feat: Open-Food-Facts-Client mit injizierter Abruffunktion"
```

---

### Task 3: EAN-Zuordnung — `findeProduktPerEan` und `verknuepfeEan`

**Files:**
- Create: `src/lib/produkt-ean.ts`
- Modify: `src/lib/katalog.ts:41-48,49-71,91-121,212-241,243-257` (Produkt-Typ und vier Projektionen)
- Test: `tests/produkt-ean.test.ts`
- Test: `tests/katalog-produkte.test.ts` (Erweiterung um `bildSchluessel`-Assertion)

**Interfaces:**
- Consumes: `Produkt` (erweitert), `DbOderTransaktion` aus `@/lib/zugriff`
- Produces: `findeProduktPerEan(db, ean: string): Promise<Produkt | null>`, `verknuepfeEan(db, produktId: string, ean: string): Promise<void>`

- [ ] **Step 1: `Produkt`-Typ und Projektionen um `bildSchluessel` erweitern**

In `src/lib/katalog.ts`, den Typ ändern:

```ts
export type Produkt = {
  id: string;
  name: string;
  marke: string | null;
  menge: number;
  einheit: Basiseinheit;
  bildSchluessel: string | null;
};
```

In allen vier Projektionen (`legeProduktAn`, `findeProdukt`, `sucheProdukte`,
`holeProdukt`) die `.returning({...})`/`.select({...})`-Objekte um
`bildSchluessel: product.bildSchluessel` ergänzen — z. B. in
`legeProduktAn`:

```ts
    .returning({
      id: product.id,
      name: product.name,
      marke: product.marke,
      menge: product.menge,
      einheit: product.einheit,
      bildSchluessel: product.bildSchluessel,
    });
```

(Dieselbe Zeile in den `.select({...})`-Blöcken von `findeProdukt`,
`sucheProdukte` und `holeProdukt` ergänzen.)

- [ ] **Step 2: Bestehende Tests ausführen — dürfen nicht brechen**

Run: `bun test tests/katalog-produkte.test.ts tests/katalog-suche.test.ts tests/erfassen-aktionen.test.ts`
Expected: PASS — unverändert, weil kein Test den vollständigen
Objekt-Umfang mit `toEqual` prüft (vorab durch Absuchen des Testbaums
bestätigt).

- [ ] **Step 3: Fehlschlagenden Test für `findeProduktPerEan`/`verknuepfeEan` schreiben**

```ts
// tests/produkt-ean.test.ts
import { afterAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { legeProduktAn } from "@/lib/katalog";
import { findeProduktPerEan, verknuepfeEan } from "@/lib/produkt-ean";
import { starteTestDatenbank } from "./helfer/db";

const umgebung = await starteTestDatenbank();
afterAll(() => umgebung.stoppen());

describe("findeProduktPerEan", () => {
  it("liefert null für eine unbekannte EAN", async () => {
    expect(await findeProduktPerEan(umgebung.db, "9001234567892")).toBeNull();
  });

  it("liefert das verknüpfte Produkt für eine bekannte EAN", async () => {
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Butter",
      marke: "Berglandmilch",
      menge: 250,
      einheit: "G",
    });
    await verknuepfeEan(umgebung.db, produkt.id, "9001234567892");

    const gefunden = await findeProduktPerEan(umgebung.db, "9001234567892");
    expect(gefunden).toEqual(produkt);
  });
});

describe("verknuepfeEan", () => {
  it("ist erneut aufrufbar für dieselbe Zuordnung, ohne zu werfen", async () => {
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Milch",
      marke: null,
      menge: 1000,
      einheit: "ML",
    });
    await verknuepfeEan(umgebung.db, produkt.id, "9007654321098");
    await verknuepfeEan(umgebung.db, produkt.id, "9007654321098");

    expect(await findeProduktPerEan(umgebung.db, "9007654321098")).toEqual(produkt);
  });

  it("überschreibt eine bestehende Zuordnung zu einem anderen Produkt nicht", async () => {
    const erstesProdukt = await legeProduktAn(umgebung.db, {
      name: "Joghurt A",
      marke: null,
      menge: 500,
      einheit: "G",
    });
    const zweitesProdukt = await legeProduktAn(umgebung.db, {
      name: "Joghurt B",
      marke: null,
      menge: 500,
      einheit: "G",
    });
    const ean = randomUUID().replace(/\D/g, "").padEnd(13, "1").slice(0, 13);

    await verknuepfeEan(umgebung.db, erstesProdukt.id, ean);
    await verknuepfeEan(umgebung.db, zweitesProdukt.id, ean);

    expect(await findeProduktPerEan(umgebung.db, ean)).toEqual(erstesProdukt);
  });
});
```

- [ ] **Step 4: Test ausführen, Fehlschlag bestätigen**

Run: `bun test tests/produkt-ean.test.ts`
Expected: FAIL — `Cannot find module '@/lib/produkt-ean'`

- [ ] **Step 5: `src/lib/produkt-ean.ts` implementieren**

```ts
import { eq } from "drizzle-orm";
import { product, productEan } from "@/db/schema/katalog";
import type { Produkt } from "@/lib/katalog";
import type { DbOderTransaktion } from "@/lib/zugriff";

/**
 * Löst eine gescannte EAN auf. Ein Primärschlüssel-Zugriff auf `product_ean`
 * genügt — anders als bei `findeProdukt` gibt es hier keine Ähnlichkeits-
 * frage: Eine EAN ist entweder verknüpft oder nicht.
 */
export async function findeProduktPerEan(
  db: DbOderTransaktion,
  ean: string,
): Promise<Produkt | null> {
  const [zeile] = await db
    .select({
      id: product.id,
      name: product.name,
      marke: product.marke,
      menge: product.menge,
      einheit: product.einheit,
      bildSchluessel: product.bildSchluessel,
    })
    .from(productEan)
    .innerJoin(product, eq(product.id, productEan.productId))
    .where(eq(productEan.ean, ean))
    .limit(1);

  return (zeile as Produkt | undefined) ?? null;
}

/**
 * Verknüpft eine EAN mit einem Produkt. `onConflictDoNothing` auf dem
 * Primärschlüssel `ean`: Zeigt die EAN bereits auf ein anderes Produkt —
 * etwa weil zwischen Auflösung und Bestätigung jemand anderes dieselbe
 * Zuordnung angelegt hat —, bleibt die bestehende Zuordnung unangetastet,
 * statt sie stillschweigend zu überschreiben.
 */
export async function verknuepfeEan(
  db: DbOderTransaktion,
  produktId: string,
  ean: string,
): Promise<void> {
  await db.insert(productEan).values({ ean, productId }).onConflictDoNothing({
    target: productEan.ean,
  });
}
```

- [ ] **Step 6: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/produkt-ean.test.ts tests/katalog-produkte.test.ts tests/katalog-suche.test.ts`
Expected: PASS

- [ ] **Step 7: `bunx tsc --noEmit` und `bun run build` ausführen**

Expected: keine Fehler

- [ ] **Step 8: Commit**

```bash
git add src/lib/produkt-ean.ts src/lib/katalog.ts tests/produkt-ean.test.ts
git commit -m "feat: EAN-Zuordnung ueber product_ean, Produkt-Typ um Bildschluessel erweitert"
```

---

### Task 4: Bild laden und zwischenspeichern

**Files:**
- Modify: `src/lib/produktbilder.ts`
- Test: `tests/produktbilder.test.ts` (Erweiterung)

**Interfaces:**
- Consumes: `Produkt`, `DbOderTransaktion`, `schreibeBild`, `erzeugeBildSchluessel` (aus demselben Modul), `env.PRODUKTBILDER_VERZEICHNIS`
- Produces: `ladeUndSpeichereBild(db, produktId: string, ean: string, bildUrl: string, abrufen: typeof fetch): Promise<string | null>` — liefert den gesetzten `bildSchluessel` oder `null` bei einem Fehlschlag

- [ ] **Step 1: Fehlschlagenden Test schreiben**

```ts
// Ergänzung in tests/produktbilder.test.ts
import { afterAll, describe, expect, it, mock } from "bun:test";
import { legeProduktAn, holeProdukt } from "@/lib/katalog";
import { ladeUndSpeichereBild } from "@/lib/produktbilder";
import { starteTestDatenbank } from "./helfer/db";

const umgebung = await starteTestDatenbank();
afterAll(() => umgebung.stoppen());

function fakeBildAbruf(bytes: Uint8Array, ok = true) {
  return mock(async () => new Response(ok ? bytes : null, { status: ok ? 200 : 404 })) as unknown as typeof fetch;
}

describe("ladeUndSpeichereBild", () => {
  it("lädt das Bild, speichert es und setzt bild_schluessel", async () => {
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Butter",
      marke: null,
      menge: 250,
      einheit: "G",
    });
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    const abrufen = fakeBildAbruf(bytes);

    const schluessel = await ladeUndSpeichereBild(
      umgebung.db,
      produkt.id,
      "9001234567892",
      "https://images.openfoodfacts.org/butter.jpg",
      abrufen,
    );

    expect(schluessel).toBe("9001234567892.jpg");
    const aktualisiert = await holeProdukt(umgebung.db, produkt.id);
    expect(aktualisiert?.bildSchluessel).toBe("9001234567892.jpg");
  });

  it("liefert null und lässt bild_schluessel leer, wenn der Download fehlschlägt", async () => {
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Milch",
      marke: null,
      menge: 1000,
      einheit: "ML",
    });
    const abrufen = fakeBildAbruf(new Uint8Array(), false);

    const schluessel = await ladeUndSpeichereBild(
      umgebung.db,
      produkt.id,
      "9007654321098",
      "https://images.openfoodfacts.org/kaputt.jpg",
      abrufen,
    );

    expect(schluessel).toBeNull();
    const aktualisiert = await holeProdukt(umgebung.db, produkt.id);
    expect(aktualisiert?.bildSchluessel).toBeNull();
  });

  it("wirft nicht weiter, wenn der Abruf selbst eine Ausnahme auslöst", async () => {
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Joghurt",
      marke: null,
      menge: 500,
      einheit: "G",
    });
    const abrufen = mock(async () => {
      throw new Error("Netzwerk nicht erreichbar");
    }) as unknown as typeof fetch;

    const schluessel = await ladeUndSpeichereBild(
      umgebung.db,
      produkt.id,
      "9001111111111",
      "https://images.openfoodfacts.org/joghurt.jpg",
      abrufen,
    );

    expect(schluessel).toBeNull();
  });
});
```

Hinweis: Diese drei Tests fragen die echte Testdatenbank ab — kein
`.resolves`/`.rejects` auf den datenbanknahen Aufrufen, nur direktes
`await` und `expect` auf dem Ergebnis, wie im übrigen Projekt üblich.

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `bun test tests/produktbilder.test.ts`
Expected: FAIL — `ladeUndSpeichereBild` ist kein Export

- [ ] **Step 3: `ladeUndSpeichereBild` implementieren**

In `src/lib/produktbilder.ts` ergänzen:

```ts
import { eq } from "drizzle-orm";
import { product } from "@/db/schema/katalog";
import type { DbOderTransaktion } from "@/lib/zugriff";
import { env } from "@/lib/env";

/**
 * Lädt ein Produktbild herunter, legt es im konfigurierten Verzeichnis ab
 * und trägt den Schlüssel im Produkt ein. Ein Fehlschlag — Netzwerk, HTTP-
 * Fehler, was auch immer — liefert `null` und lässt `bild_schluessel` leer,
 * statt die Erfassung zu blockieren: Ein fehlendes Bild ist kein Grund, eine
 * Preiserfassung abzuweisen.
 */
export async function ladeUndSpeichereBild(
  db: DbOderTransaktion,
  produktId: string,
  ean: string,
  bildUrl: string,
  abrufen: typeof fetch,
): Promise<string | null> {
  try {
    const antwort = await abrufen(bildUrl);
    if (!antwort.ok) return null;

    const bytes = Buffer.from(await antwort.arrayBuffer());
    const schluessel = erzeugeBildSchluessel(ean);
    await schreibeBild(env.PRODUKTBILDER_VERZEICHNIS, schluessel, bytes);

    await db.update(product).set({ bildSchluessel: schluessel }).where(eq(product.id, produktId));

    return schluessel;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/produktbilder.test.ts`
Expected: PASS — 7 Tests insgesamt

- [ ] **Step 5: `bunx tsc --noEmit` ausführen**

Expected: keine Fehler

- [ ] **Step 6: Commit**

```bash
git add src/lib/produktbilder.ts tests/produktbilder.test.ts
git commit -m "feat: Produktbild herunterladen und zwischenspeichern"
```

---

### Task 5: Bild-Route

**Files:**
- Create: `src/app/bilder/produkte/[schluessel]/route.ts`
- Test: `tests/produktbilder-route.test.ts`

**Interfaces:**
- Consumes: `lesePfadZuBild`, `env.PRODUKTBILDER_VERZEICHNIS`

- [ ] **Step 1: Fehlschlagenden Test schreiben**

```ts
// tests/produktbilder-route.test.ts
import { describe, expect, it, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const verzeichnis = await mkdtemp(join(tmpdir(), "produktbilder-route-"));
process.env.PRODUKTBILDER_VERZEICHNIS = verzeichnis;

afterAll(async () => {
  await rm(verzeichnis, { recursive: true, force: true });
});

const { GET } = await import("@/app/bilder/produkte/[schluessel]/route");

describe("GET /bilder/produkte/[schluessel]", () => {
  it("liefert die Bytes einer vorhandenen Datei mit langem Cache-Header", async () => {
    await writeFile(join(verzeichnis, "9001234567892.jpg"), Buffer.from([1, 2, 3]));

    const antwort = await GET(new Request("http://localhost/bilder/produkte/9001234567892.jpg"), {
      params: Promise.resolve({ schluessel: "9001234567892.jpg" }),
    });

    expect(antwort.status).toBe(200);
    expect(Buffer.from(await antwort.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
    expect(antwort.headers.get("cache-control")).toContain("immutable");
  });

  it("liefert 404 für einen unbekannten Schlüssel", async () => {
    const antwort = await GET(new Request("http://localhost/bilder/produkte/unbekannt.jpg"), {
      params: Promise.resolve({ schluessel: "unbekannt.jpg" }),
    });
    expect(antwort.status).toBe(404);
  });

  it("weist einen Schlüssel mit Pfadtrennzeichen ab, statt aus dem Verzeichnis auszubrechen", async () => {
    const antwort = await GET(
      new Request("http://localhost/bilder/produkte/..%2F..%2Fpackage.json"),
      { params: Promise.resolve({ schluessel: "../../package.json" }) },
    );
    expect(antwort.status).toBe(400);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `bun test tests/produktbilder-route.test.ts`
Expected: FAIL — Route existiert nicht

- [ ] **Step 3: Route implementieren**

```ts
// src/app/bilder/produkte/[schluessel]/route.ts
import { readFile } from "node:fs/promises";
import { env } from "@/lib/env";
import { lesePfadZuBild } from "@/lib/produktbilder";

/**
 * Liefert ein zwischengespeichertes Produktbild aus. Kein `requireUser()`
 * — Produktbilder sind kein Preis- oder Kontodaten, dieselbe Einstufung wie
 * `/manifest.webmanifest` und die App-Icons.
 *
 * Der Schlüssel muss exakt einem `[0-9]+\.jpg`-Muster entsprechen. Ohne
 * diese Prüfung könnte ein Schlüssel mit `..`-Segmenten aus dem
 * Bildverzeichnis ausbrechen — derselbe Grund, aus dem `erzeugeBildSchluessel`
 * beim Schreiben schon auf Ziffern besteht.
 */
export async function GET(
  _anfrage: Request,
  { params }: { params: Promise<{ schluessel: string }> },
): Promise<Response> {
  const { schluessel } = await params;
  if (!/^\d+\.jpg$/.test(schluessel)) {
    return new Response("Ungültiger Bildschlüssel", { status: 400 });
  }

  try {
    const bytes = await readFile(lesePfadZuBild(env.PRODUKTBILDER_VERZEICHNIS, schluessel));
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Nicht gefunden", { status: 404 });
  }
}
```

- [ ] **Step 4: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/produktbilder-route.test.ts`
Expected: PASS — 3 Tests

- [ ] **Step 5: `bunx tsc --noEmit` und `bun run build` ausführen**

Expected: keine Fehler; Build-Ausgabe zeigt die neue Route

- [ ] **Step 6: Commit**

```bash
git add src/app/bilder/produkte/[schluessel]/route.ts tests/produktbilder-route.test.ts
git commit -m "feat: Route zum Ausliefern zwischengespeicherter Produktbilder"
```

---

### Task 6: Server Actions — `loeseEanAuf` und `bestaetigeZuordnung`

**Files:**
- Create: `src/app/erfassen/ean-zustand.ts`
- Create: `src/app/erfassen/ean-aktionen.ts`
- Test: `tests/ean-aktionen.test.ts`

**Interfaces:**
- Consumes: `findeProduktPerEan`, `verknuepfeEan` (`@/lib/produkt-ean`), `holeOffProdukt`, `OffTreffer` (`@/lib/open-food-facts`), `ladeUndSpeichereBild` (`@/lib/produktbilder`), `sucheProdukte`, `legeProduktAn`, `Produkt` (`@/lib/katalog`), `requireUser` (`@/lib/sitzung`), `db` (`@/db`)
- Produces:
  - `type EanErgebnis = { art: "bekannt"; produkt: Produkt } | { art: "vorschlag"; kandidat: OffTreffer; ean: string; aehnliche: Produkt[] } | { art: "unbekannt" }`
  - `loeseEanAuf(ean: string): Promise<EanErgebnis>`
  - `bestaetigeZuordnung(eingabe: { ean: string; produktId?: string; neu?: { name: string; marke: string | null; menge: number; einheit: Basiseinheit }; bildUrl?: string | null }): Promise<Produkt>`

- [ ] **Step 1: Typen schreiben**

```ts
// src/app/erfassen/ean-zustand.ts
import type { Basiseinheit } from "@/lib/einheiten";
import type { OffTreffer } from "@/lib/open-food-facts";
import type { Produkt } from "@/lib/katalog";

/**
 * Ergebnis der EAN-Auflösung. Liegt außerhalb von `ean-aktionen.ts`, weil
 * diese Datei unter `"use server"` steht — genau wie `zustand.ts` neben
 * `aktionen.ts` in Plan 2.
 */
export type EanErgebnis =
  | { art: "bekannt"; produkt: Produkt }
  | { art: "vorschlag"; kandidat: OffTreffer; ean: string; aehnliche: Produkt[] }
  | { art: "unbekannt" };

export type NeuesProdukt = {
  name: string;
  marke: string | null;
  menge: number;
  einheit: Basiseinheit;
};
```

- [ ] **Step 2: Fehlschlagenden Test schreiben**

```ts
// tests/ean-aktionen.test.ts
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { legeProduktAn } from "@/lib/katalog";
import { faengtFehler } from "./helfer/fehler";
import { starteTestDatenbank } from "./helfer/db";

const umgebung = await starteTestDatenbank();
afterAll(() => umgebung.stoppen());

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

beforeEach(() => {
  angemeldet = true;
});

afterEach(() => {
  mock.restore();
});

import { loeseEanAuf } from "@/app/erfassen/ean-aktionen";
import { verknuepfeEan } from "@/lib/produkt-ean";

describe("loeseEanAuf", () => {
  it("liefert das Produkt direkt, wenn die EAN schon verknüpft ist", async () => {
    const produkt = await legeProduktAn(umgebung.db, {
      name: "Butter",
      marke: "Berglandmilch",
      menge: 250,
      einheit: "G",
    });
    await verknuepfeEan(umgebung.db, produkt.id, "9001234567892");

    const ergebnis = await loeseEanAuf("9001234567892");

    expect(ergebnis).toEqual({ art: "bekannt", produkt });
  });

  it("verlangt eine Anmeldung", async () => {
    angemeldet = false;
    await faengtFehler(() => loeseEanAuf("9001234567892"), "nicht angemeldet");
  });
});
```

Dieser Test deckt bewusst nur den „bekannt"-Zweig ab, der ohne
Open-Food-Facts-Zugriff auskommt. Die restlichen Zweige (`vorschlag`,
`unbekannt`) kommen in Schritt 5 dazu, sobald `ean-aktionen.ts` existiert
— dort wird `globalThis.fetch` für die Dauer eines einzelnen Tests durch
eine Fake-Funktion ersetzt (siehe Schritt 5), weil `loeseEanAuf` intern das
globale `fetch` an `holeOffProdukt` durchreicht.

- [ ] **Step 3: Test ausführen, Fehlschlag bestätigen**

Run: `bun test tests/ean-aktionen.test.ts`
Expected: FAIL — Modul `@/app/erfassen/ean-aktionen` existiert nicht

- [ ] **Step 4: `src/app/erfassen/ean-aktionen.ts` implementieren**

```ts
"use server";

import { db } from "@/db";
import { holeProdukt, legeProduktAn, sucheProdukte, type Produkt } from "@/lib/katalog";
import { holeOffProdukt } from "@/lib/open-food-facts";
import { ladeUndSpeichereBild } from "@/lib/produktbilder";
import { findeProduktPerEan, verknuepfeEan } from "@/lib/produkt-ean";
import { requireUser } from "@/lib/sitzung";
import type { EanErgebnis, NeuesProdukt } from "./ean-zustand";

/**
 * Löst eine gescannte EAN auf. Drei Stufen, in dieser Reihenfolge:
 *
 * 1. `product_ean` kennt sie bereits — schnellster und einziger sicherer Weg.
 * 2. Open Food Facts kennt sie — liefert einen Vorschlag samt Ähnlichkeitssuche
 *    gegen den eigenen Katalog, damit „Butter 250 g" nicht doppelt entsteht,
 *    nur weil sie diesmal über einen Scan statt von Hand hereinkommt.
 * 3. Weder noch — die Oberfläche fällt auf die unveränderte manuelle
 *    Eingabe zurück.
 */
export async function loeseEanAuf(ean: string): Promise<EanErgebnis> {
  await requireUser();

  const bekannt = await findeProduktPerEan(db, ean);
  if (bekannt) return { art: "bekannt", produkt: bekannt };

  const kandidat = await holeOffProdukt(ean, fetch);
  if (!kandidat) return { art: "unbekannt" };

  const aehnliche = await sucheProdukte(db, kandidat.name);
  return { art: "vorschlag", kandidat, ean, aehnliche };
}

/**
 * Schließt eine Auflösung ab: entweder wird die EAN mit einem bestehenden
 * Produkt verknüpft, oder ein neues entsteht und wird verknüpft. In beiden
 * Fällen wird — falls vorhanden und das Produkt noch kein Bild trägt — das
 * Bild geladen. Ein Fehlschlag dabei ist nicht fatal (siehe
 * `ladeUndSpeichereBild`) und wird hier nicht weiter behandelt.
 */
export async function bestaetigeZuordnung(eingabe: {
  ean: string;
  produktId?: string;
  neu?: NeuesProdukt;
  bildUrl?: string | null;
}): Promise<Produkt> {
  await requireUser();

  let produkt: Produkt;
  if (eingabe.produktId) {
    const gefunden = await findeProduktPerEan(db, eingabe.ean);
    if (gefunden && gefunden.id === eingabe.produktId) {
      produkt = gefunden;
    } else {
      const bestehend = await holeProdukt(db, eingabe.produktId);
      if (!bestehend) throw new Error(`Produkt ${eingabe.produktId} existiert nicht.`);
      produkt = bestehend;
    }
  } else if (eingabe.neu) {
    produkt = await legeProduktAn(db, eingabe.neu);
  } else {
    throw new Error("Weder produktId noch neu übergeben.");
  }

  await verknuepfeEan(db, produkt.id, eingabe.ean);

  if (!produkt.bildSchluessel && eingabe.bildUrl) {
    const schluessel = await ladeUndSpeichereBild(db, produkt.id, eingabe.ean, eingabe.bildUrl, fetch);
    if (schluessel) produkt = { ...produkt, bildSchluessel: schluessel };
  }

  return produkt;
}
```

- [ ] **Step 5: Testdatei fertigstellen und alle Zweige abdecken**

Die Testdatei aus Schritt 2 durch eine vollständige Fassung ersetzen, die
`loeseEanAuf` und `bestaetigeZuordnung` direkt importiert (kein
Platzhalter-Modul) und zusätzlich abdeckt: Fuzzy-Vorschlag bei unbekannter
EAN mit ähnlichem Bestandsprodukt, „unbekannt" bei völlig unbekannter EAN
(Open-Food-Facts-Client dafür injizieren — siehe Hinweis unten),
`bestaetigeZuordnung` mit `produktId` (bestehendes Produkt), mit `neu`
(neues Produkt), und dass ein zweiter `bestaetigeZuordnung`-Aufruf für
dieselbe EAN kein zweites Produkt anlegt.

**Wichtig für die Open-Food-Facts-Injektion in `loeseEanAuf`:** Die
Funktion ruft intern `holeOffProdukt(ean, fetch)` mit dem globalen `fetch`
auf. Für Tests, die den „vorschlag"/„unbekannt"-Zweig erreichen wollen,
ohne echte Netzwerkzugriffe zu machen, `globalThis.fetch` in einem
`beforeEach`/`afterEach`-Paar durch eine Fake-Funktion ersetzen und danach
zurücksetzen — das ist kein `mock.module` auf ein Projektmodul und daher
nicht von der Bun-Falle betroffen, betrifft aber den globalen Zustand des
Testprozesses: unbedingt in `afterEach` zurücksetzen, sonst blutet es in
andere Testdateien, die `fetch` nutzen.

```ts
const echterFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = echterFetch;
});

it("liefert einen Vorschlag mit Aehnlichkeits-Kandidaten bei unbekannter EAN", async () => {
  globalThis.fetch = mock(async () =>
    new Response(
      JSON.stringify({
        status: 1,
        product: { product_name: "Butter", quantity: "250 g", brands: "Berglandmilch" },
      }),
      { status: 200 },
    ),
  ) as unknown as typeof fetch;

  await legeProduktAn(umgebung.db, { name: "Butter", marke: null, menge: 250, einheit: "G" });

  const ergebnis = await loeseEanAuf("9009999999999");

  expect(ergebnis.art).toBe("vorschlag");
  if (ergebnis.art === "vorschlag") {
    expect(ergebnis.kandidat.name).toBe("Butter");
    expect(ergebnis.aehnliche.length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 6: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/ean-aktionen.test.ts`
Expected: PASS — alle Zweige grün

- [ ] **Step 7: Volle Testsuite ausführen — Testisolation prüfen**

Run: `bun test`
Expected: PASS, keine neue Datei durch das `globalThis.fetch`-Zurücksetzen
oder die `@/db`/`@/lib/sitzung`-Attrappen beeinträchtigt (Attrappen
spreizen das echte Modul, `@/lib/sitzung` über `?echt` eingelesen — dasselbe
Muster wie in `tests/erfassen-aktionen.test.ts`).

- [ ] **Step 8: `bunx tsc --noEmit` ausführen**

Expected: keine Fehler

- [ ] **Step 9: Commit**

```bash
git add src/app/erfassen/ean-zustand.ts src/app/erfassen/ean-aktionen.ts tests/ean-aktionen.test.ts
git commit -m "feat: Server Actions zur EAN-Aufloesung und -Bestaetigung"
```

---

### Task 7: Scan-Komponente

> **Gestaltungspflicht.** Vor dem ersten Code die Skills `impeccable`,
> `ui-ux-pro-max` und `frontend-design` aufrufen und deren Ergebnis
> umsetzen. Bestehendes Gestaltungssystem erben (`globals.css`,
> `Schaltflaeche`, Marke `#005860`, die Chip-Auswahl-Optik aus
> `erfassungs-formular.tsx`), nicht neu herleiten.

**Files:**
- Create: `src/app/erfassen/strichcode-scanner.tsx`
- Test: `tests/strichcode-scanner.test.tsx`

**Interfaces:**
- Produces:
  - `type Decoder = { erkenne(bild: ImageBitmapSource): Promise<string[]> }`
  - `echterDecoder(): Decoder` — nutzt die native `BarcodeDetector`-API
  - `istScanFaehig(): boolean` — Feature-Gate, `"BarcodeDetector" in window`
  - `StrichcodeScanner({ onErkannt, decoder, kameraStarten }: { onErkannt: (ean: string) => void; decoder?: Decoder; kameraStarten?: () => Promise<MediaStream> })`

Die Kamera-Erfassung selbst (`getUserMedia`) ist ebenfalls injiziert
(`kameraStarten`, Default = echtes `navigator.mediaDevices.getUserMedia`)
— aus demselben Grund wie der Decoder: `happy-dom` kennt weder
`BarcodeDetector` noch eine echte Kamera, und die Verweigerung der
Kamera-Berechtigung (ein in der Spec genannter Fehlerfall) muss testbar
sein, ohne echte Hardware zu brauchen.

- [ ] **Step 1: Design-Skills aufrufen**

`impeccable`, `ui-ux-pro-max` und `frontend-design` für „Kamera-Ansicht
zum Scannen eines Strichcodes, ruhige Ebene, ein-Hand-Bedienung am Handy,
Abbruch jederzeit sichtbar" aufrufen; Ergebnisse in den folgenden Schritt
einfließen lassen, insbesondere zu Rahmen/Zielrahmen-Optik, Feedback beim
Erkennen (nicht per Farbe allein) und Ladeverhalten der Kamera.

- [ ] **Step 2: Fehlschlagenden Test schreiben**

```ts
// tests/strichcode-scanner.test.tsx
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { StrichcodeScanner } from "@/app/erfassen/strichcode-scanner";

afterEach(cleanup);

/** Ein Fake-Stream reicht — kein Test hängt am tatsächlichen Videobild. */
function fakeKamera() {
  return mock(async () => ({}) as MediaStream);
}

describe("StrichcodeScanner", () => {
  it("ruft onErkannt mit dem erkannten Code auf, sobald der injizierte Decoder liefert", async () => {
    const onErkannt = mock((_ean: string) => {});
    const decoder = { erkenne: mock(async () => ["9001234567892"]) };

    render(
      <StrichcodeScanner onErkannt={onErkannt} decoder={decoder} kameraStarten={fakeKamera()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Strichcode scannen" }));

    await waitFor(() => {
      expect(onErkannt).toHaveBeenCalledWith("9001234567892");
    });
  });

  it("zeigt einen Hinweis statt eines Absturzes, wenn kein Decoder verfügbar ist", () => {
    render(<StrichcodeScanner onErkannt={() => {}} decoder={undefined} />);
    expect(
      screen.getByText(/Strichcode-Scan wird auf diesem Gerät nicht unterstützt/),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Strichcode scannen" })).toBeNull();
  });

  it("zeigt einen Hinweis, wenn die Kamera-Berechtigung verweigert wird", async () => {
    const decoder = { erkenne: mock(async () => []) };
    const kameraStarten = mock(async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    });

    render(<StrichcodeScanner onErkannt={() => {}} decoder={decoder} kameraStarten={kameraStarten} />);
    await userEvent.click(screen.getByRole("button", { name: "Strichcode scannen" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Kein Zugriff auf die Kamera");
    });
  });

  it("lässt sich jederzeit abbrechen", async () => {
    const decoder = { erkenne: mock(async () => []) };
    render(
      <StrichcodeScanner onErkannt={() => {}} decoder={decoder} kameraStarten={fakeKamera()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Strichcode scannen" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Abbrechen" })).toBeDefined();
    });

    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("button", { name: "Abbrechen" })).toBeNull();
  });
});
```

- [ ] **Step 3: Test ausführen, Fehlschlag bestätigen**

Run: `bun test tests/strichcode-scanner.test.tsx`
Expected: FAIL — Modul existiert nicht

- [ ] **Step 4: `src/app/erfassen/strichcode-scanner.tsx` implementieren**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";

export type Decoder = { erkenne(bild: ImageBitmapSource): Promise<string[]> };

/**
 * Der echte Decoder: eine `BarcodeDetector`-Instanz für EAN-13. Nur
 * aufrufen, wenn `istScanFaehig()` zuvor bestanden hat — der Konstruktor
 * existiert sonst nicht. `BarcodeDetector` fehlt in TypeScript 7s DOM-Lib
 * noch, daher der explizite Cast statt eines globalen Typs.
 */
export function echterDecoder(): Decoder {
  type BarcodeDetectorCtor = new (optionen: { formats: string[] }) => {
    detect(bild: ImageBitmapSource): Promise<{ rawValue: string }[]>;
  };
  const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
  const detector = new Ctor({ formats: ["ean_13"] });
  return {
    async erkenne(bild) {
      const treffer = await detector.detect(bild);
      return treffer.map((t) => t.rawValue);
    },
  };
}

/** Das Feature-Gate für `echterDecoder()`. */
export function istScanFaehig(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

type Zustand = "bereit" | "scannt" | "keine_berechtigung";

/**
 * Kamera-Ansicht zum Scannen eines Strichcodes.
 *
 * Zwei Abhängigkeiten sind austauschbare Props statt fester Aufrufe:
 * `decoder` (native `BarcodeDetector`-API in Produktion) und `kameraStarten`
 * (`navigator.mediaDevices.getUserMedia` in Produktion). Beides fehlt in
 * `happy-dom`, und ein globaler Ersatz dafür wäre dieselbe Fallenklasse wie
 * ein unbedachtes `mock.module` — Tests reichen stattdessen Fake-Funktionen
 * durch.
 *
 * Fehlt der Decoder (kein `BarcodeDetector` im Browser), verschwindet die
 * Schaltfläche zugunsten eines Hinweistexts. Verweigert die Person die
 * Kamera-Berechtigung, erscheint ein zweiter, eigener Hinweis — beide Male
 * bleibt die manuelle Eingabe im Formular daneben unverändert erreichbar.
 */
export function StrichcodeScanner({
  onErkannt,
  decoder,
  kameraStarten = () =>
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }),
}: {
  onErkannt: (ean: string) => void;
  decoder?: Decoder;
  kameraStarten?: () => Promise<MediaStream>;
}) {
  const [zustand, setZustand] = useState<Zustand>("bereit");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const laufendRef = useRef(false);

  useEffect(() => stoppe, []);

  if (!decoder) {
    return (
      <p className="text-sm text-gedaempft">
        Strichcode-Scan wird auf diesem Gerät nicht unterstützt. Name, Marke und Menge lassen sich
        weiterhin von Hand eintragen.
      </p>
    );
  }

  function stoppe() {
    laufendRef.current = false;
    streamRef.current?.getTracks().forEach((spur) => spur.stop());
    streamRef.current = null;
    setZustand("bereit");
  }

  async function schleife() {
    if (!laufendRef.current) return;
    // `videoRef.current` steht spätestens nach dem ersten Render im
    // "scannt"-Zustand zur Verfügung; ohne echten Videoinhalt (etwa in
    // Tests) liefert `decoder.erkenne` schlicht das, was die Fake-Funktion
    // zurückgibt — der Aufruf selbst verlangt kein echtes Bild.
    const treffer = await decoder!.erkenne(videoRef.current as unknown as ImageBitmapSource);
    if (!laufendRef.current) return;
    if (treffer[0]) {
      stoppe();
      onErkannt(treffer[0]);
      return;
    }
    requestAnimationFrame(() => void schleife());
  }

  async function starte() {
    let stream: MediaStream;
    try {
      stream = await kameraStarten();
    } catch {
      setZustand("keine_berechtigung");
      return;
    }
    streamRef.current = stream;
    laufendRef.current = true;
    setZustand("scannt");
    // Die Vorschau ist ein Komfort, kein Erfordernis für die Erkennung:
    // schlägt sie fehl, läuft die Schleife trotzdem weiter.
    try {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play?.();
      }
    } catch {
      // bewusst leer
    }
    schleife();
  }

  if (zustand === "keine_berechtigung") {
    return (
      <p role="alert" className="text-sm text-gedaempft">
        Kein Zugriff auf die Kamera. Name, Marke und Menge lassen sich weiterhin von Hand
        eintragen.
      </p>
    );
  }

  if (zustand === "scannt") {
    return (
      <div className="flex flex-col gap-2">
        <video ref={videoRef} muted playsInline className="rounded-block w-full" />
        <Schaltflaeche variante="sekundaer" onClick={stoppe}>
          Abbrechen
        </Schaltflaeche>
      </div>
    );
  }

  return (
    <Schaltflaeche variante="sekundaer" onClick={starte}>
      Strichcode scannen
    </Schaltflaeche>
  );
}
```

**Hinweis für den Implementierer:** Läuft der Test aus Step 2 gegen diese
Fassung nicht sofort grün — insbesondere die Zeilen, die `videoRef.current`
in `happy-dom` anfassen (`srcObject`, `play()`) —, liegt das an
Umgebungsdetails, die sich erst beim tatsächlichen Testlauf zeigen. Der
`try`/`catch` um die Vorschau ist bewusst großzügig genau dafür; sollte
`schleife()` selbst wegen einer fehlenden `happy-dom`-API nicht wie erwartet
laufen, dort ebenso defensiv nachbessern (`videoRef.current` ist für den
Fake-Decoder nur ein beliebiger Wert, kein echtes Bild). Nicht wegwerfen,
sondern gegen die tatsächliche Fehlermeldung anpassen — das ist der
Unterschied zwischen einem TDD-Schritt und einer Vermutung.

- [ ] **Step 5: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/strichcode-scanner.test.tsx`
Expected: PASS — 3 Tests

- [ ] **Step 6: `bunx tsc --noEmit` ausführen**

Expected: keine Fehler

- [ ] **Step 7: Commit**

```bash
git add src/app/erfassen/strichcode-scanner.tsx tests/strichcode-scanner.test.tsx
git commit -m "feat: Strichcode-Scan-Komponente mit injizierbarem Decoder"
```

---

### Task 8: Verdrahtung im Erfassungsformular

> **Gestaltungspflicht.** Skills wie in Task 7 aufrufen — hier insbesondere
> für den Vorschlags-Bildschirm (Fuzzy-Kandidaten + „neu anlegen"),
> der ein neuer Zustand im bestehenden Formular ist, kein neuer Bildschirm.

**Files:**
- Modify: `src/app/erfassen/erfassungs-formular.tsx`
- Modify: `src/app/erfassen/page.tsx`
- Test: `tests/erfassungs-formular.test.tsx` (Erweiterung)

**Interfaces:**
- Consumes: `StrichcodeScanner`, `loeseEanAuf`, `bestaetigeZuordnung`, `EanErgebnis`

- [ ] **Step 1: Fehlschlagende Tests ergänzen**

In `tests/erfassungs-formular.test.tsx` (bestehende Datei) ergänzen —
`loeseEanAuf`/`bestaetigeZuordnung` werden wie `erfasse` als Props
injiziert, kein `mock.module`:

```ts
const loeseEanAuf = mock(async (_ean: string) => ({ art: "unbekannt" as const }));
const bestaetigeZuordnung = mock(async () => ({
  id: "p1",
  name: "Butter",
  marke: "Berglandmilch",
  menge: 250,
  einheit: "G" as const,
  bildSchluessel: null,
}));

function zeichne() {
  return render(
    <ErfassungsFormular
      ketten={KETTEN}
      aktion={erfasse}
      loeseEanAuf={loeseEanAuf}
      bestaetigeZuordnung={bestaetigeZuordnung}
    />,
  );
}
```

```ts
it("füllt Name, Marke und Menge, wenn die EAN bereits bekannt ist", async () => {
  loeseEanAuf.mockResolvedValueOnce({
    art: "bekannt",
    produkt: {
      id: "p1",
      name: "Butter",
      marke: "Berglandmilch",
      menge: 250,
      einheit: "G",
      bildSchluessel: null,
    },
  });
  zeichne();

  // Die Scan-Komponente ohne Decoder zeigt keine Schaltfläche — dieser Test
  // ruft die Formular-eigene Callback-Funktion direkt auf, um die
  // Verdrahtung unabhängig von der Kamera zu prüfen.
  await screen.getByTestId("ean-test-trigger").click();

  await waitFor(() => {
    expect(screen.getByLabelText("Produkt")).toHaveValue("Butter");
    expect(screen.getByLabelText(/^Marke/)).toHaveValue("Berglandmilch");
    expect(screen.getByLabelText("Menge")).toHaveValue("250 g");
  });
});

it("zeigt einen Vorschlag mit Bestätigung, wenn die EAN unbekannt aber Open Food Facts einen Treffer hat", async () => {
  loeseEanAuf.mockResolvedValueOnce({
    art: "vorschlag",
    ean: "9001234567892",
    kandidat: { name: "Butter", marke: "Berglandmilch", menge: 250, einheit: "G", bildUrl: null },
    aehnliche: [],
  });
  zeichne();

  await screen.getByTestId("ean-test-trigger").click();

  await waitFor(() => {
    expect(screen.getByText(/Butter/)).toBeDefined();
    expect(screen.getByRole("button", { name: /neues Produkt anlegen/i })).toBeDefined();
  });

  await userEvent.click(screen.getByRole("button", { name: /neues Produkt anlegen/i }));

  await waitFor(() => {
    expect(bestaetigeZuordnung).toHaveBeenCalledWith(
      expect.objectContaining({ ean: "9001234567892" }),
    );
    expect(screen.getByLabelText("Produkt")).toHaveValue("Butter");
  });
});
```

Hinweis: `screen.getByTestId("ean-test-trigger")` ist ein Test-Anker
(`data-testid`), den Step 2 auf ein verstecktes Element legt, das die
`StrichcodeScanner`-`onErkannt`-Callback für Testzwecke ohne echten Decoder
auslöst — die Alternative wäre, in jedem Test einen Fake-`decoder` durch
mehrere Komponentenebenen zu reichen, was `ErfassungsFormular` unnötig mit
Scan-Test-Details koppeln würde. Falls beim Implementieren ein saubererer
Weg ersichtlich wird (z. B. `StrichcodeScanner` selbst exportiert einen
Test-Decoder), diesen bevorzugen und den Testanker entsprechend anpassen.

- [ ] **Step 2: Tests ausführen, Fehlschlag bestätigen**

Run: `bun test tests/erfassungs-formular.test.tsx`
Expected: FAIL — Props `loeseEanAuf`/`bestaetigeZuordnung` unbekannt,
`ean-test-trigger` nicht vorhanden

- [ ] **Step 3: `ErfassungsFormular` erweitern**

In `src/app/erfassen/erfassungs-formular.tsx`:

```tsx
import { echterDecoder, istScanFaehig, StrichcodeScanner } from "./strichcode-scanner";
import type { EanErgebnis, NeuesProdukt } from "./ean-zustand";
import type { Produkt } from "@/lib/katalog";

export function ErfassungsFormular({
  ketten,
  aktion,
  loeseEanAuf,
  bestaetigeZuordnung,
}: {
  ketten: Kette[];
  aktion: ErfassungsAktion;
  loeseEanAuf: (ean: string) => Promise<EanErgebnis>;
  bestaetigeZuordnung: (eingabe: {
    ean: string;
    produktId?: string;
    neu?: NeuesProdukt;
    bildUrl?: string | null;
  }) => Promise<Produkt>;
}) {
  // … bestehende useState-Deklarationen unverändert …
  const [eanVorschlag, setEanVorschlag] = useState<EanErgebnis | null>(null);

  async function beiErkanntemCode(ean: string) {
    const ergebnis = await loeseEanAuf(ean);
    if (ergebnis.art === "bekannt") {
      setName(ergebnis.produkt.name);
      setMarke(ergebnis.produkt.marke ?? "");
      setMenge(`${ergebnis.produkt.menge} ${ergebnis.produkt.einheit.toLowerCase()}`);
    } else if (ergebnis.art === "vorschlag") {
      setEanVorschlag(ergebnis);
    }
    // "unbekannt": bewusst kein Zustand — die manuelle Eingabe bleibt, wie sie ist.
  }

  async function waehleVorschlag(produktId?: string) {
    if (!eanVorschlag || eanVorschlag.art !== "vorschlag") return;
    const produkt = await bestaetigeZuordnung({
      ean: eanVorschlag.ean,
      produktId,
      neu: produktId
        ? undefined
        : {
            name: eanVorschlag.kandidat.name,
            marke: eanVorschlag.kandidat.marke,
            menge: eanVorschlag.kandidat.menge,
            einheit: eanVorschlag.kandidat.einheit,
          },
      bildUrl: eanVorschlag.kandidat.bildUrl,
    });
    setName(produkt.name);
    setMarke(produkt.marke ?? "");
    setMenge(`${produkt.menge} ${produkt.einheit.toLowerCase()}`);
    setEanVorschlag(null);
  }

  // im JSX, oberhalb des Namensfelds:
  // <StrichcodeScanner
  //   onErkannt={beiErkanntemCode}
  //   decoder={istScanFaehig() ? echterDecoder() : undefined}
  // />
  // <button data-testid="ean-test-trigger" hidden onClick={() => beiErkanntemCode("9001234567892")} />
  //
  // {eanVorschlag?.art === "vorschlag" && (
  //   <div role="group" aria-label="Vorschlag aus Open Food Facts">
  //     <p>{eanVorschlag.kandidat.name} — {eanVorschlag.kandidat.marke ?? "ohne Marke"}</p>
  //     {eanVorschlag.aehnliche.map((p) => (
  //       <Schaltflaeche key={p.id} variante="sekundaer" onClick={() => waehleVorschlag(p.id)}>
  //         Ist dasselbe wie „{p.name}"
  //       </Schaltflaeche>
  //     ))}
  //     <Schaltflaeche variante="primaer" onClick={() => waehleVorschlag(undefined)}>
  //       Neues Produkt anlegen
  //     </Schaltflaeche>
  //   </div>
  // )}
}
```

**Hinweis für den Implementierer:** Die JSX-Kommentare oben markieren, WO
die neuen Elemente hingehören — die tatsächliche Gestaltung (Layout,
Abstände, Tonfall des Vorschlagstexts, ob der Testanker wirklich als
verstecktes `<button>` bleibt oder eleganter gelöst wird) ist Teil dieses
Tasks und unterliegt der Gestaltungspflicht oben. Die drei
`waitFor`-Assertions in Step 1 sind die Verhaltensvorgabe, kein
Layout-Vorschlag.

`istScanFaehig()` und `echterDecoder()` kommen unverändert aus Task 7 —
hier nur konsumiert, nicht neu definiert. `istScanFaehig()` ruft man am
besten einmal (z. B. per `useMemo` oder eine schlichte Modul-Konstante),
statt bei jedem Render neu `new BarcodeDetector(...)` zu erzeugen; das ist
eine Kleinigkeit, keine Korrektheitsfrage.

- [ ] **Step 4: `page.tsx` erweitern**

```tsx
// src/app/erfassen/page.tsx
import { bestaetigeZuordnung, loeseEanAuf } from "./ean-aktionen";
// …
<ErfassungsFormular
  ketten={ketten}
  aktion={erfasse}
  loeseEanAuf={loeseEanAuf}
  bestaetigeZuordnung={bestaetigeZuordnung}
/>
```

- [ ] **Step 5: Tests ausführen, Erfolg bestätigen**

Run: `bun test tests/erfassungs-formular.test.tsx`
Expected: PASS — alle bisherigen und neuen Fälle

- [ ] **Step 6: Volle Suite, `tsc`, Build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: alles sauber

- [ ] **Step 7: Commit**

```bash
git add src/app/erfassen/erfassungs-formular.tsx src/app/erfassen/page.tsx tests/erfassungs-formular.test.tsx
git commit -m "feat: Strichcode-Scan und EAN-Vorschlag im Erfassungsformular verdrahtet"
```

---

### Task 9: Volume, Deployment-Dokumentation, Gesamtverifikation

**Files:**
- Modify: `compose.yaml`
- Modify: `Dockerfile`
- Modify: `docs/deployment-coolify.md`
- Modify: `docs/offene-punkte.md`

- [ ] **Step 1: Lokales Volume in `compose.yaml`**

Kein neuer Dienst nötig — das Bildverzeichnis ist ein lokaler Ordner
(`./daten/produktbilder`, per `.gitignore` ausgeschlossen) für die
Entwicklung; in Coolify wird es zu einem eingehängten Volume. Kein
Compose-Eintrag nötig für die Entwicklung selbst (Next läuft dort direkt
auf dem Host, nicht im Container) — diesen Schritt daher nur ausführen,
falls beim Implementieren ein Unterschied zur Annahme auffällt (z. B. falls
lokal doch über Docker entwickelt wird); andernfalls Step 1 als „kein
Änderungsbedarf" im Bericht vermerken und zu Step 2 übergehen.

- [ ] **Step 2: `docs/deployment-coolify.md` ergänzen**

Neuen Abschnitt zwischen „6. Migrationen ausführen" und „7. Ersten Zugang
freischalten" einfügen (oder als eigener Punkt nach Abschnitt 9
„Backups", je nachdem was beim Lesen der Datei stimmiger wirkt):

```markdown
## Produktbilder — persistentes Volume

Plan 3 lädt Produktbilder von Open Food Facts herunter und speichert sie
im Verzeichnis, das `PRODUKTBILDER_VERZEICHNIS` benennt. Ohne ein
persistentes Volume an dieser Stelle gehen alle geladenen Bilder bei jedem
Neu-Deployment verloren — sie würden beim nächsten Scan derselben Produkte
lediglich erneut heruntergeladen, kein Datenverlust im Sinne der
Preishistorie, aber unnötiger Open-Food-Facts-Traffic.

1. In Coolify: Anwendung → Storages → „Add" → Pfad im Container z. B.
   `/app/daten/produktbilder`, ein eigenes Volume.
2. `PRODUKTBILDER_VERZEICHNIS=/app/daten/produktbilder` als
   Environment-Variable setzen (siehe Abschnitt 3).
```

- [ ] **Step 3: `docs/offene-punkte.md` — Abschnitt „Aus Plan 3" anlegen**

Am Ende der Datei einen neuen Abschnitt „## Aus Plan 3 (Barcode-Scan &
Produktbilder)" ergänzen, nach demselben Muster wie „Aus Plan 2" (Erledigt
/ Warten / Bewusste Entscheidungen). Mindestens diese bewussten
Entscheidungen aus dem Design festhalten, falls sie beim Implementieren
nicht bereits an anderer Stelle vermerkt wurden:

- Kein iOS-Safari-Fallback (`zxing-wasm`) — Zielumfeld ist Android/Chrome.
- Kein Nachtrage-Weg für Altbestand ohne EAN.
- Kein Bild-Refresh, einmal geladen bleibt ein Bild bestehen.
- Ein fehlgeschlagener Bild-Download wird nicht automatisch wiederholt.

Und, falls im Verlauf der Implementierung tatsächlich aufgetreten (durch
den Implementierer beim Abschluss zu ergänzen, nicht vorab zu erfinden):
jede Abweichung vom Plan, jede beim Bau entdeckte Lücke.

- [ ] **Step 4: Gesamtverifikation**

```bash
docker compose up -d postgres-test
bun test
bunx tsc --noEmit
bun run build
git grep -nE "(GOCSPX-|sk-[A-Za-z0-9]{20,})" -- . ':!docs'
```

Erwartet: alles sauber, kein Treffer im Secret-Grep.

- [ ] **Step 5: Browser-Verifikation auf einem echten Android-Gerät**

**Wichtig vorab:** `getUserMedia` verlangt einen sicheren Kontext — `https://`
oder `localhost`. Ein Aufruf von einem Handy über die reine
Netzwerk-IP-Adresse (`http://192.168.…`) verweigert die Kamera-Berechtigung
grundsätzlich, unabhängig vom Code. Für diese Verifikation entweder ein
selbstsigniertes Zertifikat lokal einrichten, einen Tunnel-Dienst
(z. B. `bunx localtunnel` oder vergleichbar) verwenden, oder direkt gegen
eine testweise erreichbare Coolify-Instanz mit echtem TLS prüfen — nicht
gegen die reine LAN-Adresse.

Produktionsbau starten, `/erfassen` öffnen, drei Fälle scannen: eine EAN,
die in `product_ean` bereits verknüpft ist (nach einem ersten erfolgreichen
Durchlauf zwangsläufig gegeben), eine EAN, die Open Food Facts kennt (der
Vorschlags-Zweig), und eine erfundene EAN, die niemand kennt (der
„unbekannt"-Zweig, fällt auf die manuelle Eingabe zurück). Zusätzlich: die
Kamera-Berechtigung im Browser bewusst verweigern und prüfen, dass der
Hinweistext erscheint, nicht ein Absturz. Konsole auf CSP-Verstöße prüfen.
Screenshots nach `docs/bilder/` — vorher etwaige veraltete Aufnahmen zum
selben Bildschirm löschen, danach jede neue Aufnahme öffnen und gegen
ihren Dateinamen prüfen, wie in jeder bisherigen UI-Aufgabe dieses
Projekts.

- [ ] **Step 6: Commit**

```bash
git add docs/deployment-coolify.md docs/offene-punkte.md docs/bilder compose.yaml Dockerfile
git commit -m "docs: Plan 3 Deployment-Hinweise, offene Punkte, Gesamtverifikation"
```

---

## Verifikation

**Plan 3 gilt als fertig, wenn:**

1. `bun test`, `bunx tsc --noEmit`, `bun run build` fehlerfrei
2. Eine bekannte EAN füllt das Erfassungsformular korrekt vor
3. Eine unbekannte EAN mit Open-Food-Facts-Treffer zeigt den
   Fuzzy-Vorschlag korrekt, inklusive „neues Produkt anlegen"
4. Eine völlig unbekannte EAN fällt sauber auf die manuelle Eingabe zurück
5. Ein Produktbild wird genau einmal heruntergeladen und danach aus dem
   eigenen Volume ausgeliefert
6. Ein echter Scan auf einem Android-Handy mit Chrome funktioniert,
   Browser-verifiziert mit Screenshots
7. `docs/offene-punkte.md` trägt einen vollständigen Abschnitt „Aus Plan 3"

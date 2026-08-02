# KassaTrack Phase 1 — Fundament & Auth: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine auf Coolify deployte, installierbare Next.js-16-PWA mit Postgres, in die sich ausschließlich Personen einloggen können, deren E-Mail-Adresse auf einer Allowlist steht — per Passkey oder Google.

**Architecture:** Ein einzelner Next.js-16-Container (standalone output) mit Postgres 18 als Coolify-Service. Better Auth 1.6 übernimmt Sessions, Passkeys und Google-OAuth; der Zugriffsschutz sitzt bewusst **nicht** im UI, sondern in einem `databaseHooks.user.create.before`-Hook, der jeden Registrierungspfad abfängt. Die Allowlist-Logik liegt als reine, testbare Funktion getrennt von der Auth-Konfiguration.

**Tech Stack:** Next.js 16.2.12, React 19.2.8, TypeScript 7.0.2, Tailwind CSS 4.3.3, Drizzle ORM 0.45.2, Better Auth 1.6.25, PostgreSQL 18, Bun 1.3.14, Serwist 9.5.12 (PWA), Testcontainers 12.0.4.

## Global Constraints

Diese gelten für **jede** Task, ohne dass sie dort wiederholt werden.

- Paketmanager ist ausschließlich **Bun 1.3.14**. Niemals `npm`, `yarn`, `pnpm`, `npx`. Stattdessen `bun add`, `bun run`, `bunx`, `bun test`.
- Exakte Versionsuntergrenzen: `next@16.2.12`, `react@19.2.8`, `typescript@7.0.2`, `tailwindcss@4.3.3`, `drizzle-orm@0.45.2`, `better-auth@1.6.25`, `@better-auth/passkey@1.6.25`, `@better-auth/drizzle-adapter@1.6.25`, `zod@4.4.3`.
- **Tailwind v4 ist CSS-first.** Es gibt keine `tailwind.config.js` und es darf keine angelegt werden. Konfiguration erfolgt über `@theme` in `src/app/globals.css`, PostCSS-Plugin ist `@tailwindcss/postcss`.
- **Passkey und Drizzle-Adapter sind eigene Pakete** (`@better-auth/passkey`, `@better-auth/drizzle-adapter`). Importe aus `better-auth/plugins/passkey` existieren in 1.6 nicht mehr.
- Alle nutzersichtbaren Texte sind **deutsch, österreichisches Vokabular** („Kassabeleg", „Aktion", „Einkaufszettel", „anmelden"). Routen-Segmente ebenfalls deutsch (`/anmelden`, `/einladung`). Code, Bezeichner und Commits bleiben englisch bzw. gemischt wie in den Beispielen unten.
- Es wird **niemals auf `main`** gearbeitet. Der Branch für diesen Plan ist `design/kassatrack-foundation` (existiert bereits).
- Secrets ausschließlich über Environment-Variablen. Keine Keys, Passwörter oder Client-Secrets im Repo, auch nicht in Beispielen — dort stehen Platzhalter.
- Jede Task endet mit einem Commit. Commit-Nachrichten auf Deutsch, Conventional-Commits-Präfix englisch (`feat:`, `chore:`, `test:`, `docs:`, `fix:`).
- Node 24 LTS ist der Fallback-Runtime, Bun der Standard. Der Produktions-Container nutzt Bun.

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `Dockerfile` | Multi-Stage Build, Bun, Next standalone |
| `compose.yaml` | Lokale Entwicklung: Postgres |
| `.env.example` | Dokumentierte Env-Variablen mit Platzhaltern |
| `next.config.ts` | `output: "standalone"`, Serwist-Wrapper |
| `drizzle.config.ts` | Migrationskonfiguration |
| `src/lib/env.ts` | Zod-validierte Environment-Variablen, fail-fast beim Start |
| `src/db/index.ts` | Drizzle-Client-Singleton |
| `src/db/schema/auth.ts` | Von Better-Auth-CLI generiertes Auth-Schema |
| `src/db/schema/zugriff.ts` | `allowedEmail`, `invite` — Zugriffssteuerung |
| `src/lib/zugriff.ts` | **Reine, testbare Allowlist-Logik.** Kennt Better Auth nicht. |
| `src/lib/auth.ts` | Better-Auth-Serverinstanz, verdrahtet `zugriff.ts` als Hook |
| `src/lib/auth-client.ts` | Better-Auth-Clientinstanz |
| `src/lib/sitzung.ts` | `requireUser()` für Server Components |
| `src/middleware.ts` | Sicherheits-Header + Routen-Schutz |
| `src/app/api/auth/[...all]/route.ts` | Better-Auth-Handler |
| `src/app/api/health/route.ts` | Healthcheck für Coolify |
| `src/app/anmelden/page.tsx` | Anmeldeseite (Passkey + Google) |
| `src/app/einladung/[token]/page.tsx` | Einladung einlösen |
| `src/app/verwaltung/zugriff/page.tsx` | Allowlist verwalten, Einladungen erzeugen |
| `src/app/manifest.ts` | PWA-Manifest |
| `src/app/sw.ts` | Serwist Service Worker |
| `tests/helfer/db.ts` | Testcontainer-Postgres-Lifecycle |

Bewusste Trennung: `src/lib/zugriff.ts` enthält die gesamte Zugriffsentscheidung als reine Funktionen über einem schmalen DB-Interface. `src/lib/auth.ts` verdrahtet sie nur. Dadurch ist die sicherheitskritischste Logik der App ohne laufenden Auth-Stack testbar.

---

## Task 1: Projekt-Setup, Testrunner und Healthcheck

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `bunfig.toml`, `postcss.config.mjs`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `src/app/api/health/route.ts`
- Test: `tests/health.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces: `GET /api/health` → `Response` mit JSON `{ status: "ok", zeit: string }`, HTTP 200

- [ ] **Step 1: Projekt erzeugen**

Im Repo-Wurzelverzeichnis `D:\Christopher\Github\KassaTrack` ausführen. Das bestehende `docs/`-Verzeichnis kollidiert nicht.

```bash
bunx create-next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*" --use-bun --eslint --turbopack --yes
```

- [ ] **Step 2: Versionen auf die Vorgaben heben und Testwerkzeuge ergänzen**

```bash
bun add next@16.2.12 react@19.2.8 react-dom@19.2.8
bun add -d typescript@7.0.2 tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3
bun add -d @testing-library/react@16.3.2 happy-dom@20.11.1 @types/bun
```

- [ ] **Step 3: Testrunner konfigurieren**

**Wichtig:** Die DOM-Umgebung wird bewusst **nicht** global vorgeladen. `GlobalRegistrator.register()` überschreibt `Response`, `Request` und `Headers` durch happy-doms Nachbauten. Server-Tests — Route Handler, Middleware, Auth — würden dann gegen den Nachbau statt gegen Buns echte Runtime laufen und könnten grün sein, obwohl der Container etwas anderes tut. Der Vorlader setzt daher nur Umgebungsvariablen; das DOM importieren ausschließlich Komponenten-Tests.

```bash
bun add -d @happy-dom/global-registrator@20.11.1
```

`bunfig.toml`:

```toml
[test]
preload = ["./tests/setup.ts"]
```

`tests/setup.ts` — läuft vor jedem Test, richtet **kein** DOM ein:

```ts
process.env.DATABASE_URL ??= "postgres://kassatrack:kassatrack@localhost:5432/kassatrack_test";
process.env.BETTER_AUTH_SECRET ??= "t".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID ??= "test-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-secret";
```

`tests/dom.ts` — wird **nur** von Komponenten-Tests importiert:

```ts
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
```

- [ ] **Step 4: Den fehlschlagenden Test schreiben**

`tests/health.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("antwortet mit Status 200 und ok", async () => {
    const antwort = await GET();

    expect(antwort.status).toBe(200);
    const daten = (await antwort.json()) as { status: string; zeit: string };
    expect(daten.status).toBe("ok");
    expect(Number.isNaN(Date.parse(daten.zeit))).toBe(false);
  });
});
```

- [ ] **Step 5: Test laufen lassen und Fehlschlag bestätigen**

Run: `bun test tests/health.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/health/route'`

- [ ] **Step 6: Minimale Implementierung**

`src/app/api/health/route.ts`:

```ts
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "ok", zeit: new Date().toISOString() });
}
```

- [ ] **Step 7: Test laufen lassen und Erfolg bestätigen**

Run: `bun test tests/health.test.ts`
Expected: PASS, 1 pass 0 fail

- [ ] **Step 8: Tailwind v4 prüfen und Altlasten entfernen**

`src/app/globals.css` muss genau so beginnen. Falls `create-next-app` eine `tailwind.config.ts` oder `tailwind.config.js` angelegt hat, wird sie **gelöscht**.

```css
@import "tailwindcss";

@theme {
  --color-hintergrund: oklch(0.99 0 0);
  --color-vordergrund: oklch(0.15 0 0);
  --font-sans: ui-sans-serif, system-ui, sans-serif;
  --font-zahlen: ui-monospace, "SF Mono", monospace;
}
```

`postcss.config.mjs`:

```js
export default {
  plugins: { "@tailwindcss/postcss": {} },
};
```

- [ ] **Step 9: Build und Typecheck verifizieren**

Run: `bunx tsc --noEmit && bun run build`
Expected: beide ohne Fehler. Die Ausgabe von `bun run build` muss `next@16.2.12` bestätigen.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: Next.js 16 Projektgerüst mit Tailwind v4 und Healthcheck"
```

---

## Task 2: Environment-Validierung

**Files:**
- Create: `src/lib/env.ts`, `.env.example`
- Test: `tests/env.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces: `parseEnv(quelle: Record<string, string | undefined>): Env` — wirft `Error` bei fehlenden Variablen. `Env` hat die Felder `DATABASE_URL: string`, `BETTER_AUTH_SECRET: string`, `BETTER_AUTH_URL: string`, `GOOGLE_CLIENT_ID: string`, `GOOGLE_CLIENT_SECRET: string`. Zusätzlich der Default-Export `env: Env` aus `process.env`.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/env.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { parseEnv } from "@/lib/env";

const vollstaendig = {
  DATABASE_URL: "postgres://u:p@localhost:5432/kassatrack",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://kassatrack.example.at",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
};

describe("parseEnv", () => {
  it("akzeptiert eine vollständige Konfiguration", () => {
    expect(parseEnv(vollstaendig).DATABASE_URL).toBe(vollstaendig.DATABASE_URL);
  });

  it("wirft, wenn DATABASE_URL fehlt", () => {
    const { DATABASE_URL, ...ohne } = vollstaendig;
    expect(() => parseEnv(ohne)).toThrow(/DATABASE_URL/);
  });

  it("wirft, wenn das Secret zu kurz ist", () => {
    expect(() => parseEnv({ ...vollstaendig, BETTER_AUTH_SECRET: "kurz" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("wirft, wenn BETTER_AUTH_URL keine URL ist", () => {
    expect(() => parseEnv({ ...vollstaendig, BETTER_AUTH_URL: "keine-url" })).toThrow(
      /BETTER_AUTH_URL/,
    );
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `bun test tests/env.test.ts`
Expected: FAIL — `Cannot find module '@/lib/env'`

- [ ] **Step 3: Implementierung**

```bash
bun add zod@4.4.3
```

`src/lib/env.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(quelle: Record<string, string | undefined>): Env {
  const ergebnis = schema.safeParse(quelle);
  if (!ergebnis.success) {
    const felder = ergebnis.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Ungültige Environment-Konfiguration — ${felder}`);
  }
  return ergebnis.data;
}

export const env: Env = parseEnv(process.env);
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `bun test tests/env.test.ts`
Expected: PASS, 4 pass 0 fail

Der Modul-Top-Level-Export `env` wirft bei fehlenden Variablen — das ist für die App gewollt. Die Testvariablen setzt bereits `tests/setup.ts` aus Task 1, Step 3; hier ist nichts zu ergänzen.

- [ ] **Step 5: `.env.example` anlegen**

`.gitignore` enthält aus dem `create-next-app`-Template die Zeile `.env*`, die auch `.env.example` erfasst. Vor dem Anlegen der Datei muss deshalb eine Ausnahme ergänzt werden, sonst lässt sich die Datei nicht committen:

```gitignore
.env*
!.env.example
```

```bash
# Postgres
DATABASE_URL=postgres://kassatrack:BITTE_AENDERN@localhost:5432/kassatrack

# Better Auth — Secret erzeugen mit: bunx @better-auth/cli secret
BETTER_AUTH_SECRET=BITTE_AENDERN_MINDESTENS_32_ZEICHEN
BETTER_AUTH_URL=http://localhost:3000

# Google OAuth — aus der Google Cloud Console
GOOGLE_CLIENT_ID=BITTE_AENDERN
GOOGLE_CLIENT_SECRET=BITTE_AENDERN
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/env.ts tests/env.test.ts tests/setup.ts .env.example
git commit -m "feat: fail-fast Validierung der Environment-Variablen"
```

---

## Task 3: Postgres, Drizzle und Test-Infrastruktur

**Files:**
- Create: `compose.yaml`, `drizzle.config.ts`, `src/db/index.ts`, `tests/helfer/db.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Consumes: `env` aus `@/lib/env` (Task 2)
- Produces:
  - `db` aus `@/db` — Drizzle-Instanz vom Typ `NodePgDatabase<typeof schema>`
  - `starteTestDatenbank(): Promise<TestDatenbank>` aus `tests/helfer/db.ts`, wobei `TestDatenbank = { db: NodePgDatabase<any>; url: string; stop: () => Promise<void> }`

- [ ] **Step 1: Abhängigkeiten und lokale Datenbank**

```bash
bun add drizzle-orm@0.45.2 pg
bun add -d drizzle-kit@0.31.10 @types/pg @testcontainers/postgresql@12.0.4
```

`compose.yaml`:

```yaml
services:
  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: kassatrack
      POSTGRES_PASSWORD: kassatrack
      POSTGRES_DB: kassatrack
    ports:
      - "5432:5432"
    volumes:
      - postgres-daten:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kassatrack"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  postgres-daten:
```

- [ ] **Step 2: Den fehlschlagenden Test schreiben**

`tests/db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { starteTestDatenbank, type TestDatenbank } from "./helfer/db";

let umgebung: TestDatenbank;

beforeAll(async () => {
  umgebung = await starteTestDatenbank();
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

describe("Testdatenbank", () => {
  it("ist erreichbar", async () => {
    const zeilen = await umgebung.db.execute(sql`select 1 as eins`);
    expect(zeilen.rows[0]).toEqual({ eins: 1 });
  });

  it("hat die Erweiterung pg_trgm aktiviert", async () => {
    const zeilen = await umgebung.db.execute(
      sql`select extname from pg_extension where extname = 'pg_trgm'`,
    );
    expect(zeilen.rows).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Test laufen lassen und Fehlschlag bestätigen**

Run: `bun test tests/db.test.ts`
Expected: FAIL — `Cannot find module './helfer/db'`

- [ ] **Step 4: Implementierung**

`tests/helfer/db.ts`:

```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

export type TestDatenbank = {
  db: NodePgDatabase<Record<string, never>>;
  url: string;
  stop: () => Promise<void>;
};

export async function starteTestDatenbank(): Promise<TestDatenbank> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "postgres:18-alpine",
  ).start();

  const url = container.getConnectionUri();
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  await db.execute(sql`create extension if not exists pg_trgm`);

  return {
    db,
    url,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}
```

`src/db/index.ts`:

```ts
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";

const global_ = globalThis as unknown as { kassatrackPool?: Pool };

const pool = global_.kassatrackPool ?? new Pool({ connectionString: env.DATABASE_URL });
if (process.env.NODE_ENV !== "production") global_.kassatrackPool = pool;

export const db: NodePgDatabase<Record<string, never>> = drizzle(pool);
export { pool };
```

`drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/*.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 5: Test laufen lassen und Erfolg bestätigen**

Docker Desktop muss laufen.

Run: `bun test tests/db.test.ts`
Expected: PASS, 2 pass 0 fail. Der erste Lauf dauert länger, weil das Postgres-Image gezogen wird.

- [ ] **Step 6: Commit**

```bash
git add compose.yaml drizzle.config.ts src/db tests/db.test.ts tests/helfer
git commit -m "feat: Postgres 18 mit Drizzle und Testcontainer-Testumgebung"
```

---

## Task 4: Zugriffs-Schema und reine Allowlist-Logik

Das ist die sicherheitskritischste Task des Plans. Die Logik wird deshalb vollständig von Better Auth entkoppelt und isoliert getestet.

**Files:**
- Create: `src/db/schema/zugriff.ts`, `src/lib/zugriff.ts`
- Test: `tests/zugriff.test.ts`

**Interfaces:**
- Consumes: Drizzle aus Task 3
- Produces:
  - Tabellen `allowedEmail` (Spalten `id`, `email`, `hinzugefuegtVon`, `erstelltAm`) und `invite` (Spalten `id`, `token`, `email`, `erstelltVon`, `erstelltAm`, `gueltigBis`, `eingeloestAm`)
  - `normalisiereEmail(email: string): string`
  - `istEmailZugelassen(db: ZugriffsDb, email: string): Promise<boolean>`
  - `pruefeZugang(db: ZugriffsDb, email: string | undefined | null): Promise<void>` — wirft `ZugriffVerweigert` (Subklasse von `Error`) bei fehlender Berechtigung
  - `ZugriffVerweigert` als exportierte Fehlerklasse
  - `type ZugriffsDb = NodePgDatabase<Record<string, never>>`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/zugriff.test.ts`:

```ts
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
    await expect(pruefeZugang(umgebung.db, "christopher@example.at")).resolves.toBeUndefined();
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
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `bun test tests/zugriff.test.ts`
Expected: FAIL — `Cannot find module '@/lib/zugriff'`

- [ ] **Step 3: Schema implementieren**

`src/db/schema/zugriff.ts`:

```ts
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const allowedEmail = pgTable("allowed_email", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  hinzugefuegtVon: text("hinzugefuegt_von"),
  erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
});

export const invite = pgTable("invite", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  erstelltVon: text("erstellt_von").notNull(),
  erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  gueltigBis: timestamp("gueltig_bis", { withTimezone: true }).notNull(),
  eingeloestAm: timestamp("eingeloest_am", { withTimezone: true }),
});
```

- [ ] **Step 4: Logik implementieren**

`src/lib/zugriff.ts`:

```ts
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { allowedEmail } from "@/db/schema/zugriff";

export type ZugriffsDb = NodePgDatabase<Record<string, never>>;

export class ZugriffVerweigert extends Error {
  constructor(email?: string | null) {
    super(
      email
        ? `Die Adresse ${email} ist für KassaTrack nicht freigeschaltet.`
        : "Ohne freigeschaltete E-Mail-Adresse ist keine Anmeldung möglich.",
    );
    this.name = "ZugriffVerweigert";
  }
}

export function normalisiereEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function istEmailZugelassen(db: ZugriffsDb, email: string): Promise<boolean> {
  const normalisiert = normalisiereEmail(email);
  if (normalisiert === "") return false;

  const treffer = await db
    .select({ id: allowedEmail.id })
    .from(allowedEmail)
    .where(eq(allowedEmail.email, normalisiert))
    .limit(1);

  return treffer.length > 0;
}

export async function pruefeZugang(db: ZugriffsDb, email: string | undefined | null): Promise<void> {
  if (!email || !(await istEmailZugelassen(db, email))) {
    throw new ZugriffVerweigert(email);
  }
}
```

- [ ] **Step 5: Test laufen lassen und Erfolg bestätigen**

Run: `bun test tests/zugriff.test.ts`
Expected: PASS, 9 pass 0 fail

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/zugriff.ts src/lib/zugriff.ts tests/zugriff.test.ts
git commit -m "feat: Allowlist-Logik mit vollständiger Testabdeckung"
```

---

## Task 5: Better Auth mit Drizzle-Adapter und Allowlist-Gate

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/app/api/auth/[...all]/route.ts`
- Create (generiert): `src/db/schema/auth.ts`
- Test: `tests/auth-gate.test.ts`

**Interfaces:**
- Consumes: `pruefeZugang`, `ZugriffVerweigert` aus `@/lib/zugriff` (Task 4); `db` aus `@/db` (Task 3); `env` (Task 2)
- Produces:
  - `auth` aus `@/lib/auth` — Better-Auth-Serverinstanz
  - `authClient` aus `@/lib/auth-client` mit den Methoden `signIn.social`, `signIn.passkey`, `passkey.addPasskey`, `signOut`, `useSession`
  - Route `GET|POST /api/auth/*`

**Kernpunkt dieser Task:** Das Gate sitzt in `databaseHooks.user.create.before`, **nicht** in `hooks.before` auf `/sign-up/email`. Grund: `hooks.before` mit Pfadprüfung deckt nur den E-Mail-Registrierungspfad ab. Google-OAuth und Passkey-Registrierung laufen daran vorbei und würden ungeprüft Accounts anlegen. `databaseHooks.user.create.before` ist der einzige Punkt, durch den **jeder** Registrierungspfad muss.

- [ ] **Step 1: Abhängigkeiten**

```bash
bun add better-auth@1.6.25 @better-auth/passkey@1.6.25 @better-auth/drizzle-adapter@1.6.25
```

- [ ] **Step 2: Den fehlschlagenden Test schreiben**

`tests/auth-gate.test.ts`:

**Reihenfolge ist hier entscheidend.** `src/lib/auth.ts` importiert `db` aus `@/db`, und `@/db` liest `env.DATABASE_URL` beim Modul-Import — also einmalig und unveränderlich. Ein `beforeAll` läuft zu spät. Deshalb wird der Container per Top-Level-`await` gestartet, `process.env.DATABASE_URL` gesetzt, und `auth` erst **danach** dynamisch importiert. Bun unterstützt Top-Level-`await` in Testdateien.

```ts
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { starteTestDatenbank } from "./helfer/db";

// Top-Level: läuft VOR jedem dynamischen Import weiter unten.
const umgebung = await starteTestDatenbank();
process.env.DATABASE_URL = umgebung.url;

await umgebung.db.execute(sql`
  create table allowed_email (
    id text primary key,
    email text not null unique,
    hinzugefuegt_von text,
    erstellt_am timestamptz not null default now()
  )
`);

// Erst jetzt importieren — @/db liest DATABASE_URL beim Import.
const { auth } = await import("@/lib/auth");
const { allowedEmail } = await import("@/db/schema/zugriff");

/** Greift genau den Hook ab, den Better Auth vor jedem Nutzer-Insert ausführt. */
function holeGate() {
  const hook = auth.options.databaseHooks?.user?.create?.before;
  if (!hook) throw new Error("databaseHooks.user.create.before ist nicht verdrahtet");
  return hook;
}

afterAll(async () => {
  await umgebung.stop();
});

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table allowed_email`);
});

describe("Registrierungs-Gate", () => {
  it("ist als databaseHooks.user.create.before verdrahtet", () => {
    expect(typeof holeGate()).toBe("function");
  });

  it("weist eine nicht freigeschaltete Adresse ab", async () => {
    const gate = holeGate();
    await expect(
      gate({ email: "fremd@example.at", name: "Fremd" } as never, {} as never),
    ).rejects.toThrow();
  });

  it("lässt eine freigeschaltete Adresse durch", async () => {
    await umgebung.db.insert(allowedEmail).values({ id: "1", email: "christopher@example.at" });
    const gate = holeGate();
    await expect(
      gate({ email: "christopher@example.at", name: "Christopher" } as never, {} as never),
    ).resolves.not.toThrow();
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
```

- [ ] **Step 3: Test laufen lassen und Fehlschlag bestätigen**

Run: `bun test tests/auth-gate.test.ts`
Expected: FAIL — `Cannot find module '@/lib/auth'`

- [ ] **Step 4: Auth-Server implementieren**

`src/lib/auth.ts`:

```ts
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { db } from "@/db";
import { env } from "@/lib/env";
import { pruefeZugang, ZugriffVerweigert } from "@/lib/zugriff";

const rpID = new URL(env.BETTER_AUTH_URL).hostname;

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  // Bewusst aus: kein Passwort-Pfad, damit es kein schwächstes Glied gibt.
  emailAndPassword: { enabled: false },

  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },

  databaseHooks: {
    user: {
      create: {
        // Einziger Punkt, durch den JEDER Registrierungspfad muss —
        // Google, Passkey, alles. Kein Weg daran vorbei.
        before: async (user) => {
          try {
            await pruefeZugang(db, user.email);
          } catch (fehler) {
            if (fehler instanceof ZugriffVerweigert) {
              throw new APIError("FORBIDDEN", { message: fehler.message });
            }
            throw fehler;
          }
        },
      },
    },
  },

  plugins: [
    passkey({ rpID, rpName: "KassaTrack" }),
    nextCookies(), // muss letzter Eintrag bleiben
  ],
});
```

- [ ] **Step 5: Auth-Schema generieren und Migration anlegen**

```bash
bunx @better-auth/cli generate --output src/db/schema/auth.ts
bunx drizzle-kit generate
docker compose up -d postgres
bunx drizzle-kit migrate
```

Die generierte Datei `src/db/schema/auth.ts` wird unverändert übernommen und committet. Sie enthält `user`, `session`, `account`, `verification` und `passkey`.

- [ ] **Step 6: Client und Route-Handler**

`src/lib/auth-client.ts`:

```ts
"use client";

import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";

export const authClient = createAuthClient({
  plugins: [passkeyClient()],
});

export const { signIn, signOut, useSession, passkey } = authClient;
```

`src/app/api/auth/[...all]/route.ts`:

```ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { POST, GET } = toNextJsHandler(auth);
```

- [ ] **Step 7: Test laufen lassen und Erfolg bestätigen**

Run: `bun test tests/auth-gate.test.ts`
Expected: PASS, 5 pass 0 fail

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth.ts src/lib/auth-client.ts src/db/schema/auth.ts src/app/api/auth drizzle compose.yaml tests/auth-gate.test.ts
git commit -m "feat: Better Auth mit Passkey, Google und Allowlist-Gate im Datenbank-Hook"
```

---

## Task 6: Sitzungshilfe und Routen-Schutz

**Files:**
- Create: `src/lib/sitzung.ts`, `src/middleware.ts`
- Modify: `src/app/page.tsx`
- Test: `tests/middleware.test.ts`

**Interfaces:**
- Consumes: `auth` aus `@/lib/auth` (Task 5)
- Produces:
  - `requireUser(): Promise<Benutzer>` aus `@/lib/sitzung` — leitet auf `/anmelden` um, wenn keine Sitzung besteht. `Benutzer = { id: string; email: string; name: string; image?: string | null }`
  - `holeSitzung(): Promise<Sitzung | null>` — ohne Umleitung
  - `middleware(request: NextRequest): NextResponse` — setzt Sicherheits-Header auf allen Antworten

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/middleware.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

function anfrage(pfad: string): NextRequest {
  return new NextRequest(new URL(pfad, "https://kassatrack.example.at"));
}

describe("Sicherheits-Header", () => {
  it("setzt eine Content-Security-Policy", () => {
    const kopf = middleware(anfrage("/")).headers.get("content-security-policy");
    expect(kopf).toContain("default-src 'self'");
    expect(kopf).toContain("frame-ancestors 'none'");
  });

  it("setzt HSTS", () => {
    const kopf = middleware(anfrage("/")).headers.get("strict-transport-security");
    expect(kopf).toContain("max-age=");
  });

  it("verbietet das Einbetten in Frames", () => {
    expect(middleware(anfrage("/")).headers.get("x-frame-options")).toBe("DENY");
  });

  it("unterdrückt Referrer an fremde Ziele", () => {
    expect(middleware(anfrage("/")).headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("setzt die Header auch auf der Anmeldeseite", () => {
    expect(middleware(anfrage("/anmelden")).headers.get("x-frame-options")).toBe("DENY");
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `bun test tests/middleware.test.ts`
Expected: FAIL — `Cannot find module '@/middleware'`

- [ ] **Step 3: Implementierung**

`src/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function middleware(_request: NextRequest): NextResponse {
  const antwort = NextResponse.next();

  antwort.headers.set("content-security-policy", CSP);
  antwort.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  antwort.headers.set("x-frame-options", "DENY");
  antwort.headers.set("x-content-type-options", "nosniff");
  antwort.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  antwort.headers.set("permissions-policy", "geolocation=(), microphone=(), camera=(self)");

  return antwort;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

`src/lib/sitzung.ts`:

```ts
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export type Benutzer = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
};

export async function holeSitzung() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUser(): Promise<Benutzer> {
  const sitzung = await holeSitzung();
  if (!sitzung) redirect("/anmelden");

  return {
    id: sitzung.user.id,
    email: sitzung.user.email,
    name: sitzung.user.name,
    image: sitzung.user.image,
  };
}
```

`src/app/page.tsx`:

```tsx
import { requireUser } from "@/lib/sitzung";

export default async function StartSeite() {
  const benutzer = await requireUser();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-semibold">Servus, {benutzer.name}</h1>
      <p className="text-balance opacity-70">
        KassaTrack ist bereit. Die Preiserfassung kommt im nächsten Schritt.
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `bun test tests/middleware.test.ts`
Expected: PASS, 5 pass 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts src/lib/sitzung.ts src/app/page.tsx tests/middleware.test.ts
git commit -m "feat: Routen-Schutz und Sicherheits-Header"
```

---

## Task 7: Anmeldeseite mit Passkey und Google

**Files:**
- Create: `src/app/anmelden/page.tsx`, `src/components/anmelde-formular.tsx`
- Test: `tests/anmelde-formular.test.tsx`

**Interfaces:**
- Consumes: `authClient` aus `@/lib/auth-client` (Task 5)
- Produces: Client-Komponente `AnmeldeFormular` — rendert zwei Schaltflächen mit den zugänglichen Namen „Mit Passkey anmelden" und „Mit Google anmelden" sowie einen Fehlerbereich mit `role="alert"`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/anmelde-formular.test.tsx`:

Diese Datei ist ein Komponenten-Test und braucht daher als **erste Zeile** den DOM-Import aus Task 1, Step 3.

```tsx
import "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

const signInPasskey = mock(async () => ({ error: null }));
const signInSocial = mock(async () => ({ error: null }));

mock.module("@/lib/auth-client", () => ({
  authClient: { signIn: { passkey: signInPasskey, social: signInSocial } },
}));

const { AnmeldeFormular } = await import("@/components/anmelde-formular");

afterEach(() => {
  cleanup();
  signInPasskey.mockClear();
  signInSocial.mockClear();
});

describe("AnmeldeFormular", () => {
  it("zeigt beide Anmeldewege", () => {
    render(<AnmeldeFormular />);
    expect(screen.getByRole("button", { name: /Mit Passkey anmelden/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Mit Google anmelden/i })).toBeDefined();
  });

  it("startet die Passkey-Anmeldung", async () => {
    render(<AnmeldeFormular />);
    await userEvent.click(screen.getByRole("button", { name: /Mit Passkey anmelden/i }));
    expect(signInPasskey).toHaveBeenCalledTimes(1);
  });

  it("startet die Google-Anmeldung mit dem Provider google", async () => {
    render(<AnmeldeFormular />);
    await userEvent.click(screen.getByRole("button", { name: /Mit Google anmelden/i }));
    expect(signInSocial).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google" }),
    );
  });

  it("zeigt eine verständliche Meldung, wenn der Zugriff verweigert wird", async () => {
    signInSocial.mockImplementationOnce(async () => ({
      error: { message: "Die Adresse fremd@example.at ist für KassaTrack nicht freigeschaltet." },
    }));

    render(<AnmeldeFormular />);
    await userEvent.click(screen.getByRole("button", { name: /Mit Google anmelden/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("nicht freigeschaltet");
    });
  });
});
```

```bash
bun add -d @testing-library/user-event
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `bun test tests/anmelde-formular.test.tsx`
Expected: FAIL — `Cannot find module '@/components/anmelde-formular'`

- [ ] **Step 3: Implementierung**

`src/components/anmelde-formular.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { authClient } from "@/lib/auth-client";

export function AnmeldeFormular() {
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starte] = useTransition();

  function behandle(ergebnis: { error?: { message?: string } | null }) {
    setFehler(ergebnis.error?.message ?? null);
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <button
        type="button"
        disabled={laeuft}
        onClick={() =>
          starte(async () => {
            behandle(await authClient.signIn.passkey());
          })
        }
        className="rounded-xl bg-vordergrund px-5 py-4 text-lg font-medium text-hintergrund disabled:opacity-50"
      >
        Mit Passkey anmelden
      </button>

      <button
        type="button"
        disabled={laeuft}
        onClick={() =>
          starte(async () => {
            behandle(
              await authClient.signIn.social({ provider: "google", callbackURL: "/" }),
            );
          })
        }
        className="rounded-xl border border-vordergrund/20 px-5 py-4 text-lg font-medium disabled:opacity-50"
      >
        Mit Google anmelden
      </button>

      {fehler ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {fehler}
        </p>
      ) : null}
    </div>
  );
}
```

`src/app/anmelden/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { AnmeldeFormular } from "@/components/anmelde-formular";
import { holeSitzung } from "@/lib/sitzung";

export default async function AnmeldeSeite() {
  if (await holeSitzung()) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-semibold tracking-tight">KassaTrack</h1>
        <p className="opacity-70">Preise vergleichen, statt sie zu schätzen.</p>
      </div>
      <AnmeldeFormular />
      <p className="text-sm opacity-60">
        Die Anmeldung ist nur für freigeschaltete Adressen möglich.
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `bun test tests/anmelde-formular.test.tsx`
Expected: PASS, 4 pass 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/app/anmelden src/components/anmelde-formular.tsx tests/anmelde-formular.test.tsx
git commit -m "feat: Anmeldeseite mit Passkey und Google"
```

---

## Task 8: Einladungs-Flow und Zugriffsverwaltung

**Files:**
- Create: `src/lib/einladung.ts`, `src/app/verwaltung/zugriff/page.tsx`, `src/app/verwaltung/zugriff/aktionen.ts`
- Test: `tests/einladung.test.ts`

**Interfaces:**
- Consumes: Tabellen `allowedEmail`, `invite` (Task 4); `requireUser` (Task 6)
- Produces:
  - `erzeugeEinladung(db, { email, erstelltVon, gueltigkeitTage? }): Promise<{ token: string; gueltigBis: Date }>` — legt zugleich den `allowedEmail`-Eintrag an
  - `loeseEinladungEin(db, token): Promise<{ email: string }>` — wirft `EinladungUngueltig` bei unbekanntem, abgelaufenem oder bereits eingelöstem Token
  - `EinladungUngueltig` als exportierte Fehlerklasse
  - `entzieheZugang(db, email): Promise<void>`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/einladung.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import {
  EinladungUngueltig,
  entzieheZugang,
  erzeugeEinladung,
  loeseEinladungEin,
} from "@/lib/einladung";
import { istEmailZugelassen } from "@/lib/zugriff";
import { invite } from "@/db/schema/zugriff";
import { eq } from "drizzle-orm";
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
    );
    create table invite (
      id text primary key,
      token text not null unique,
      email text not null,
      erstellt_von text not null,
      erstellt_am timestamptz not null default now(),
      gueltig_bis timestamptz not null,
      eingeloest_am timestamptz
    );
  `);
}, 120_000);

afterAll(async () => {
  await umgebung.stop();
});

beforeEach(async () => {
  await umgebung.db.execute(sql`truncate table allowed_email, invite`);
});

describe("erzeugeEinladung", () => {
  it("liefert einen Token mit mindestens 32 Zeichen", async () => {
    const { token } = await erzeugeEinladung(umgebung.db, {
      email: "neu@example.at",
      erstelltVon: "chris",
    });
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("schaltet die Adresse sofort frei", async () => {
    await erzeugeEinladung(umgebung.db, { email: "Neu@Example.AT", erstelltVon: "chris" });
    expect(await istEmailZugelassen(umgebung.db, "neu@example.at")).toBe(true);
  });

  it("ist bei doppeltem Aufruf für dieselbe Adresse unkritisch", async () => {
    await erzeugeEinladung(umgebung.db, { email: "neu@example.at", erstelltVon: "chris" });
    await expect(
      erzeugeEinladung(umgebung.db, { email: "neu@example.at", erstelltVon: "chris" }),
    ).resolves.toBeDefined();
  });
});

describe("loeseEinladungEin", () => {
  it("liefert die Adresse zurück", async () => {
    const { token } = await erzeugeEinladung(umgebung.db, {
      email: "neu@example.at",
      erstelltVon: "chris",
    });
    expect((await loeseEinladungEin(umgebung.db, token)).email).toBe("neu@example.at");
  });

  it("lässt sich kein zweites Mal einlösen", async () => {
    const { token } = await erzeugeEinladung(umgebung.db, {
      email: "neu@example.at",
      erstelltVon: "chris",
    });
    await loeseEinladungEin(umgebung.db, token);
    await expect(loeseEinladungEin(umgebung.db, token)).rejects.toBeInstanceOf(EinladungUngueltig);
  });

  it("weist einen unbekannten Token ab", async () => {
    await expect(loeseEinladungEin(umgebung.db, "gibtesnicht")).rejects.toBeInstanceOf(
      EinladungUngueltig,
    );
  });

  it("weist einen abgelaufenen Token ab", async () => {
    const { token } = await erzeugeEinladung(umgebung.db, {
      email: "neu@example.at",
      erstelltVon: "chris",
    });
    await umgebung.db
      .update(invite)
      .set({ gueltigBis: new Date(Date.now() - 1000) })
      .where(eq(invite.token, token));

    await expect(loeseEinladungEin(umgebung.db, token)).rejects.toBeInstanceOf(EinladungUngueltig);
  });
});

describe("entzieheZugang", () => {
  it("entfernt die Adresse aus der Allowlist", async () => {
    await erzeugeEinladung(umgebung.db, { email: "neu@example.at", erstelltVon: "chris" });
    await entzieheZugang(umgebung.db, "neu@example.at");
    expect(await istEmailZugelassen(umgebung.db, "neu@example.at")).toBe(false);
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `bun test tests/einladung.test.ts`
Expected: FAIL — `Cannot find module '@/lib/einladung'`

- [ ] **Step 3: Implementierung**

`src/lib/einladung.ts`:

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { allowedEmail, invite } from "@/db/schema/zugriff";
import { normalisiereEmail, type ZugriffsDb } from "@/lib/zugriff";

export class EinladungUngueltig extends Error {
  constructor() {
    super("Diese Einladung ist ungültig, abgelaufen oder bereits eingelöst.");
    this.name = "EinladungUngueltig";
  }
}

export async function erzeugeEinladung(
  db: ZugriffsDb,
  eingabe: { email: string; erstelltVon: string; gueltigkeitTage?: number },
): Promise<{ token: string; gueltigBis: Date }> {
  const email = normalisiereEmail(eingabe.email);
  const token = randomBytes(32).toString("base64url");
  const gueltigBis = new Date(Date.now() + (eingabe.gueltigkeitTage ?? 14) * 86_400_000);

  await db
    .insert(allowedEmail)
    .values({ id: randomUUID(), email, hinzugefuegtVon: eingabe.erstelltVon })
    .onConflictDoNothing({ target: allowedEmail.email });

  await db.insert(invite).values({
    id: randomUUID(),
    token,
    email,
    erstelltVon: eingabe.erstelltVon,
    gueltigBis,
  });

  return { token, gueltigBis };
}

export async function loeseEinladungEin(
  db: ZugriffsDb,
  token: string,
): Promise<{ email: string }> {
  const [eintrag] = await db
    .update(invite)
    .set({ eingeloestAm: new Date() })
    .where(
      and(eq(invite.token, token), isNull(invite.eingeloestAm), gt(invite.gueltigBis, new Date())),
    )
    .returning({ email: invite.email });

  if (!eintrag) throw new EinladungUngueltig();
  return { email: eintrag.email };
}

export async function entzieheZugang(db: ZugriffsDb, email: string): Promise<void> {
  await db.delete(allowedEmail).where(eq(allowedEmail.email, normalisiereEmail(email)));
}
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `bun test tests/einladung.test.ts`
Expected: PASS, 9 pass 0 fail

- [ ] **Step 5: Verwaltungsseite bauen**

`src/app/verwaltung/zugriff/aktionen.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireUser } from "@/lib/sitzung";
import { entzieheZugang, erzeugeEinladung } from "@/lib/einladung";

export async function ladeEin(formular: FormData): Promise<{ link: string }> {
  const benutzer = await requireUser();
  const email = String(formular.get("email") ?? "");

  const { token } = await erzeugeEinladung(db, { email, erstelltVon: benutzer.id });
  revalidatePath("/verwaltung/zugriff");

  return { link: `/einladung/${token}` };
}

export async function entziehe(formular: FormData): Promise<void> {
  await requireUser();
  await entzieheZugang(db, String(formular.get("email") ?? ""));
  revalidatePath("/verwaltung/zugriff");
}
```

`src/app/verwaltung/zugriff/page.tsx`:

```tsx
import { db } from "@/db";
import { allowedEmail } from "@/db/schema/zugriff";
import { requireUser } from "@/lib/sitzung";
import { entziehe, ladeEin } from "./aktionen";

export default async function ZugriffSeite() {
  await requireUser();
  const eintraege = await db.select().from(allowedEmail).orderBy(allowedEmail.erstelltAm);

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Zugriff verwalten</h1>

      <form action={ladeEin} className="flex gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="adresse@example.at"
          className="flex-1 rounded-lg border px-3 py-3"
        />
        <button type="submit" className="rounded-lg bg-vordergrund px-4 py-3 text-hintergrund">
          Einladen
        </button>
      </form>

      <ul className="flex flex-col divide-y">
        {eintraege.map((eintrag) => (
          <li key={eintrag.id} className="flex items-center justify-between py-3">
            <span>{eintrag.email}</span>
            <form action={entziehe}>
              <input type="hidden" name="email" value={eintrag.email} />
              <button type="submit" className="text-sm text-red-700 underline">
                Entziehen
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

`src/app/einladung/[token]/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { db } from "@/db";
import { EinladungUngueltig, loeseEinladungEin } from "@/lib/einladung";
import { AnmeldeFormular } from "@/components/anmelde-formular";

export default async function EinladungSeite({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let email: string;
  try {
    ({ email } = await loeseEinladungEin(db, token));
  } catch (fehler) {
    if (fehler instanceof EinladungUngueltig) redirect("/anmelden?fehler=einladung");
    throw fehler;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Willkommen bei KassaTrack</h1>
        <p className="opacity-70">
          <strong>{email}</strong> ist jetzt freigeschaltet. Melde dich an, um loszulegen.
        </p>
      </div>
      <AnmeldeFormular />
    </main>
  );
}
```

- [ ] **Step 6: Alle Tests laufen lassen**

Run: `bun test && bunx tsc --noEmit`
Expected: alle Tests grün, kein Typfehler

- [ ] **Step 7: Commit**

```bash
git add src/lib/einladung.ts src/app/verwaltung src/app/einladung tests/einladung.test.ts
git commit -m "feat: Einladungs-Flow und Zugriffsverwaltung"
```

---

## Task 9: PWA-Grundgerüst

**Files:**
- Create: `src/app/manifest.ts`, `src/app/sw.ts`, `public/icon-192.png`, `public/icon-512.png`
- Modify: `next.config.ts`, `src/app/layout.tsx`
- Test: `tests/manifest.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces: `manifest(): MetadataRoute.Manifest` — liefert `name: "KassaTrack"`, `display: "standalone"`, `start_url: "/"` und mindestens zwei Icons

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`tests/manifest.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import manifest from "@/app/manifest";

describe("PWA-Manifest", () => {
  it("heißt KassaTrack", () => {
    expect(manifest().name).toBe("KassaTrack");
  });

  it("startet eigenständig ohne Browserleiste", () => {
    expect(manifest().display).toBe("standalone");
  });

  it("startet auf der Wurzel", () => {
    expect(manifest().start_url).toBe("/");
  });

  it("liefert Icons in 192 und 512 Pixel", () => {
    const groessen = (manifest().icons ?? []).map((i) => i.sizes);
    expect(groessen).toContain("192x192");
    expect(groessen).toContain("512x512");
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `bun test tests/manifest.test.ts`
Expected: FAIL — `Cannot find module '@/app/manifest'`

- [ ] **Step 3: Implementierung**

```bash
bun add -d @serwist/next@9.5.12
bun add serwist@9.5.12
```

`src/app/manifest.ts`:

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KassaTrack",
    short_name: "KassaTrack",
    description: "Lebensmittelpreise vergleichen und den günstigsten Markt finden.",
    lang: "de-AT",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#111111",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

`src/app/sw.ts`:

```ts
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
}).addEventListeners();
```

`next.config.ts`:

```ts
import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const config: NextConfig = {
  output: "standalone",
  // Aus Task 1: Next muss den TypeScript-CLI für den Typecheck verwenden,
  // weil der eingebaute Checker mit TypeScript 7 nicht zurechtkommt.
  // Dieses Flag darf beim Überschreiben der Datei NICHT verloren gehen.
  experimental: {
    useTypeScriptCli: true,
  },
};

export default withSerwist(config);
```

Icons erzeugen: ein schlichtes quadratisches PNG mit dunklem Grund und weißem „K" in 192×192 und 512×512 nach `public/` legen. Solange kein Logo existiert, reicht eine einfarbige Fläche mit Buchstabe — es blockiert nichts und wird in Plan 2 ersetzt.

`src/app/layout.tsx` — im `metadata`-Export ergänzen:

```ts
export const metadata: Metadata = {
  title: "KassaTrack",
  description: "Lebensmittelpreise vergleichen und den günstigsten Markt finden.",
  appleWebApp: { capable: true, title: "KassaTrack", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#111111",
  viewportFit: "cover",
};
```

Und `<html lang="de-AT">` setzen.

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `bun test tests/manifest.test.ts`
Expected: PASS, 4 pass 0 fail

- [ ] **Step 5: Build verifizieren**

Run: `bun run build`
Expected: erfolgreich, `public/sw.js` wurde erzeugt

- [ ] **Step 6: Commit**

```bash
git add next.config.ts src/app/manifest.ts src/app/sw.ts src/app/layout.tsx public tests/manifest.test.ts
git commit -m "feat: PWA-Grundgerüst mit Serwist"
```

---

## Task 10: Docker-Image und Coolify-Deployment

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docs/deployment-coolify.md`
- Test: manuelle Verifikation, dokumentiert in `docs/deployment-coolify.md`

**Interfaces:**
- Consumes: alles Vorherige
- Produces: lauffähiges Container-Image, das auf Port 3000 hört und `/api/health` bedient

- [ ] **Step 1: `.dockerignore`**

```
node_modules
.next
.git
docs
tests
*.md
.env*
compose*.yaml
```

- [ ] **Step 2: `Dockerfile`**

```dockerfile
FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.14-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Platzhalter nur für den Build — zur Laufzeit kommen die echten Werte aus Coolify.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=bauzeit-platzhalter-mindestens-32-zeichen \
    BETTER_AUTH_URL=http://localhost:3000 \
    GOOGLE_CLIENT_ID=bauzeit \
    GOOGLE_CLIENT_SECRET=bauzeit
RUN bun run build

FROM oven/bun:1.3.14-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "server.js"]
```

- [ ] **Step 3: Image lokal bauen und prüfen**

```bash
docker build -t kassatrack:test .
docker run --rm -p 3001:3000 \
  -e DATABASE_URL="postgres://kassatrack:kassatrack@host.docker.internal:5432/kassatrack" \
  -e BETTER_AUTH_SECRET="$(bunx @better-auth/cli secret)" \
  -e BETTER_AUTH_URL="http://localhost:3001" \
  -e GOOGLE_CLIENT_ID="test" -e GOOGLE_CLIENT_SECRET="test" \
  kassatrack:test
```

In einem zweiten Terminal:

```bash
curl -sf http://localhost:3001/api/health
```

Expected: `{"status":"ok","zeit":"..."}` mit Exit-Code 0

- [ ] **Step 4: Coolify-Anleitung schreiben**

`docs/deployment-coolify.md`:

```markdown
# KassaTrack auf Coolify deployen

## 1. Postgres anlegen
Neuer Service → PostgreSQL 18. Interne Verbindungs-URL notieren.

## 2. Anwendung anlegen
Neue Ressource → Application → Git-Repository, Build Pack **Dockerfile**,
Branch `main`, Port `3000`.

## 3. Environment-Variablen setzen
| Variable | Wert |
|---|---|
| `DATABASE_URL` | interne Postgres-URL aus Schritt 1 |
| `BETTER_AUTH_SECRET` | Ausgabe von `bunx @better-auth/cli secret` |
| `BETTER_AUTH_URL` | die öffentliche Domain, z.B. `https://kassatrack.example.at` |
| `GOOGLE_CLIENT_ID` | aus der Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | aus der Google Cloud Console |

## 4. Google OAuth einrichten
Google Cloud Console → APIs & Services → Credentials → OAuth-Client (Web).
Autorisierter Redirect-URI: `https://<domain>/api/auth/callback/google`

## 5. Domain und TLS
Domain in Coolify eintragen. Traefik stellt das Zertifikat automatisch aus.
**Wichtig:** `BETTER_AUTH_URL` muss exakt der Domain entsprechen — der
Passkey-`rpID` wird daraus abgeleitet. Eine Abweichung macht alle
registrierten Passkeys unbrauchbar.

## 6. Migration ausführen
Einmalig im Container-Terminal:
`bunx drizzle-kit migrate`

## 7. Ersten Zugang freischalten
Da die Allowlist leer ist, kommt niemand herein — auch der Betreiber nicht.
Einmalig im Postgres-Terminal:

    insert into allowed_email (id, email)
    values (gen_random_uuid()::text, 'deine.adresse@example.at');

Danach über `/verwaltung/zugriff` alle weiteren Personen einladen.

## 8. Backups
Coolify → Postgres-Service → Backups aktivieren, Ziel S3, täglich.
```

- [ ] **Step 5: Live verifizieren**

Nach dem Deployment auf dem **Handy** durchspielen:

1. Domain öffnen → Weiterleitung auf `/anmelden`
2. Mit Google anmelden, mit einer Adresse, die **nicht** freigeschaltet ist → es erscheint die Fehlermeldung, es entsteht **kein** Account. In der Datenbank prüfen: `select count(*) from "user";` bleibt unverändert.
3. Adresse per SQL freischalten, erneut anmelden → Zugang funktioniert
4. Passkey registrieren, abmelden, mit Passkey anmelden
5. „Zum Startbildschirm hinzufügen" → App startet ohne Browserleiste
6. Lighthouse (Mobil) laufen lassen → Performance ≥ 90, PWA installierbar

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore docs/deployment-coolify.md
git commit -m "feat: Docker-Image und Coolify-Deployment-Anleitung"
```

---

## Task 11: Gesamtverifikation und Pull Request

- [ ] **Step 1: Vollständigen Testlauf**

Run: `bun test`
Expected: alle Tests grün, 0 fail

- [ ] **Step 2: Typecheck und Build**

Run: `bunx tsc --noEmit && bun run build`
Expected: keine Fehler

- [ ] **Step 3: Versionen gegen die Vorgaben prüfen**

Run: `bun pm ls | grep -E "next|react|typescript|tailwindcss|better-auth|drizzle-orm"`
Expected: `next@16.2.12`, `react@19.2.8`, `typescript@7.0.2`, `tailwindcss@4.3.3`, `better-auth@1.6.25`, `drizzle-orm@0.45.2`

- [ ] **Step 4: Prüfen, dass keine Tailwind-v3-Altlast existiert**

Run: `ls tailwind.config.* 2>/dev/null; echo "exit=$?"`
Expected: keine Datei gefunden

- [ ] **Step 5: Prüfen, dass keine Secrets im Repo liegen**

Run: `git grep -nE "(GOCSPX-|sk-[A-Za-z0-9]{20,})" -- . ':!docs' || echo "sauber"`
Expected: `sauber`

- [ ] **Step 6: Basis-Branch auf dem Remote herstellen**

Das Repository `https://github.com/rolkef/kassatrack.git` ist angelegt, aber **leer** — es hat noch keine einzige Ref. Ohne `main` auf dem Remote gibt es kein Ziel für den Pull Request.

```bash
git ls-remote --heads origin
```

Wenn die Ausgabe leer ist oder kein `refs/heads/main` enthält, den lokalen `main` einmalig hochschieben. `main` enthält nur den Initial Commit, es geht dabei nichts verloren:

```bash
git push -u origin main
```

- [ ] **Step 7: Pull Request eröffnen**

```bash
git push -u origin design/kassatrack-foundation
gh pr create --base main --title "Phase 1: Fundament und Auth" --body "$(cat <<'ENDE'
## Was drin ist

Deploybare KassaTrack-PWA auf Next.js 16 mit Postgres 18 und Better Auth.
Anmeldung ausschließlich per Passkey oder Google, in beiden Fällen gegen
eine E-Mail-Allowlist.

## Der wichtigste Punkt

Das Zugriffs-Gate sitzt in `databaseHooks.user.create.before`, nicht in
einem pfadgebundenen `hooks.before`. Damit ist es unmöglich, es über
Google-OAuth oder Passkey-Registrierung zu umgehen — jeder
Registrierungspfad muss durch diesen einen Punkt.

## Verifiziert

- `bun test` grün
- `bunx tsc --noEmit` und `bun run build` fehlerfrei
- Nicht freigeschaltete Google-Adresse wird abgewiesen, ohne dass ein
  Account entsteht
- PWA auf dem Handy installiert, Passkey-Anmeldung durchgespielt

## Noch nicht drin

Preisdatenmodell, Erfassung und Vergleich — das ist Plan 2.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
ENDE
)"
```

---

## Self-Review

**Spec-Abdeckung.** Gegen `docs/superpowers/specs/2026-08-02-kassatrack-design.md` geprüft — dieser Plan deckt aus Phase 1 ab: Projekt-Setup, Docker/Coolify-Deployment, Auth mit Passkey + Google + Allowlist, Sicherheits-Header, PWA-Grundgerüst. **Bewusst nicht abgedeckt und an Plan 2–4 verwiesen:** Datenmodell für Preise, Beleg-Pipeline, Barcode-Scan, manuelle Eingabe, Produkt-Matching, Referenzpreis-Engine, Produktsuche, Produktdetail, Beleg-Archiv, Open-Food-Facts-Bilder, MinIO. Das ist die im Scope-Check begründete Aufteilung, keine Lücke.

**Typ-Konsistenz.** `ZugriffsDb` wird in Task 4 definiert und in Task 8 unverändert weiterverwendet. `normalisiereEmail` aus Task 4 wird in Task 8 importiert statt neu implementiert. `requireUser` aus Task 6 wird in Task 8 genutzt. `AnmeldeFormular` aus Task 7 wird in Task 8 auf der Einladungsseite wiederverwendet.

**Offene Abhängigkeit.** Die exakte Signatur von `databaseHooks.user.create.before` in Better Auth 1.6.25 ist aus der Dokumentation als `(user, ctx) => Promise<void>` belegt. Der Test in Task 5 ruft den Hook direkt auf und würde bei einer abweichenden Signatur sofort fehlschlagen — das ist gewollt und die Absicherung gegen eine falsche Annahme.

**Bekannte Reibungsstelle.** `src/lib/auth.ts` importiert `db` als Modul-Singleton, dessen Verbindung beim Import feststeht. `tests/auth-gate.test.ts` löst das über Top-Level-`await` plus dynamischen Import (Task 5, Step 2) — korrekt, aber subtil. Sollte sich das im weiteren Verlauf als sperrig erweisen, ist der saubere Umbau eine Factory `erzeugeAuth(db)`; für Phase 1 wäre das vorgezogener Aufwand ohne aktuellen Nutzen.

import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/** Verbindung zur Wartungsdatenbank des Test-Postgres aus compose.yaml. */
const VERWALTUNGS_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://kassatrack:kassatrack@localhost:5433/postgres";

export type TestDatenbank = {
  db: NodePgDatabase<Record<string, never>>;
  url: string;
  stop: () => Promise<void>;
};

function urlFuer(datenbank: string): string {
  const url = new URL(VERWALTUNGS_URL);
  url.pathname = `/${datenbank}`;
  return url.toString();
}

async function datenbankLoeschen(name: string): Promise<void> {
  const aufraeumen = new Pool({ connectionString: VERWALTUNGS_URL });
  try {
    // "with (force)" trennt noch offene Verbindungen, sonst schlaegt das
    // Loeschen fehl, wenn ein Test seinen Pool nicht sauber geschlossen hat.
    await aufraeumen.query(`drop database if exists "${name}" with (force)`);
  } finally {
    await aufraeumen.end();
  }
}

/**
 * Legt eine frische Wegwerf-Datenbank an. Jeder Aufruf bekommt eine eigene,
 * dadurch beeinflussen sich Testdateien nicht gegenseitig.
 */
export async function starteTestDatenbank(): Promise<TestDatenbank> {
  const name = `kassatrack_test_${randomBytes(6).toString("hex")}`;

  const verwaltung = new Pool({ connectionString: VERWALTUNGS_URL });
  try {
    await verwaltung.query(`create database "${name}"`);
  } catch (fehler) {
    throw new Error(
      `Testdatenbank konnte nicht angelegt werden. Läuft der Test-Postgres? ` +
        `Starte ihn mit "docker compose up -d postgres-test". ` +
        `Ursache: ${(fehler as Error).message}`,
    );
  } finally {
    await verwaltung.end();
  }

  const url = urlFuer(name);
  const pool = new Pool({ connectionString: url });
  try {
    const db = drizzle(pool);
    await db.execute(sql`create extension if not exists pg_trgm`);

    return {
      db,
      url,
      stop: async () => {
        await pool.end();
        await datenbankLoeschen(name);
      },
    };
  } catch (fehler) {
    // Aufraeumen darf den urspruenglichen Fehler niemals verdecken — schlaegt
    // pool.end() oder das Loeschen selbst fehl, waere sonst die eigentliche
    // Fehlerursache (fehler) unwiederbringlich verloren.
    await pool.end().catch(() => {});
    await datenbankLoeschen(name).catch(() => {});
    throw new Error(
      `Testdatenbank "${name}" konnte nicht eingerichtet werden und wurde ` +
        `wieder entfernt. Läuft der Test-Postgres mit der Erweiterung pg_trgm? ` +
        `Ursache: ${(fehler as Error).message}`,
      { cause: fehler },
    );
  }
}

/**
 * Wendet alle noch ausstehenden Migrationen aus `drizzle/` auf die über
 * `DATABASE_URL` erreichbare Datenbank an.
 *
 * Läuft im Produktions-Image über den vorgebauten `scripts/migrieren.js`
 * (siehe Dockerfile) — bewusst **ohne** `drizzle-kit`. Der ursprüngliche Plan
 * sah `bunx drizzle-kit migrate` im laufenden Container vor; das würde
 * `drizzle-kit` bei jedem Aufruf einmalig aus der npm-Registry nachladen und
 * hätte die Datenbank-Migration eines Erst-Deployments von der
 * Netzwerk-Erreichbarkeit der Registry abhängig gemacht — eine restriktive
 * Egress-Regel, ein Registry-Ausfall oder ein Proxy hätten diesen Schritt
 * dann mitten im Deployment scheitern lassen, ohne dass die Ursache aus der
 * Fehlermeldung ersichtlich gewesen wäre (siehe `docs/deployment-coolify.md`,
 * Abschnitt zur TLS-Interception, wo genau dieser Fehlertyp auftrat).
 *
 * `drizzle-orm/node-postgres/migrator` braucht dagegen nichts weiter als die
 * SQL-Dateien unter `drizzle/` und eine Verbindung — kein Netzwerkzugriff auf
 * eine Paket-Registry zur Laufzeit.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const datenbankUrl = process.env.DATABASE_URL;
  if (!datenbankUrl) {
    console.error("DATABASE_URL ist nicht gesetzt — Abbruch.");
    process.exitCode = 1;
    return;
  }

  // Derselbe Zeitgrenzwert wie in `src/db/index.ts`: node-postgres wartet
  // ohne `connectionTimeoutMillis` unbegrenzt auf eine Verbindung. Ein
  // Postgres, das schweigt statt abzulehnen, soll auch hier zu einem
  // sichtbaren Fehler führen, nicht zu einem hängenden Prozess.
  const pool = new Pool({ connectionString: datenbankUrl, connectionTimeoutMillis: 10_000 });
  const db = drizzle(pool);

  console.log("Wende Migrationen aus drizzle/ an …");
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("Migrationen erfolgreich angewendet.");
  } catch (fehler) {
    console.error("Migration fehlgeschlagen:", fehler);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();

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

  /*
   * Ziel klar benennen, bevor irgendetwas ausgeführt wird — nie die
   * Zugangsdaten. Grund: Bun lädt `.env`-Dateien automatisch, auch außerhalb
   * des Containers. Ein Aufruf dieses Skripts auf der eigenen Maschine (die
   * Anleitung in docs/deployment-coolify.md erwähnt genau das als Option für
   * andere Schritte) würde ohne diese Zeile still die lokale
   * Entwicklungs-Datenbank aus `.env` treffen, dieselbe Erfolgsmeldung
   * ausgeben, und den Eindruck hinterlassen, die Produktionsdatenbank sei
   * migriert — bis Schritt 7 der Anleitung gegen eine leere Produktions-Tabelle
   * scheitert. `URL` statt einer eigenen Parser-Logik: wirft von selbst bei
   * einem kaputten Verbindungsstring, statt später mit einer irreführenden
   * Fehlermeldung aus `pg`.
   */
  let ziel: URL;
  try {
    ziel = new URL(datenbankUrl);
  } catch {
    console.error("DATABASE_URL ist kein gültiger Verbindungsstring — Abbruch.");
    process.exitCode = 1;
    return;
  }
  console.log(`Wende Migrationen aus drizzle/ an — Ziel: ${ziel.host}${ziel.pathname} …`);

  // Derselbe Zeitgrenzwert wie in `src/db/index.ts`: node-postgres wartet
  // ohne `connectionTimeoutMillis` unbegrenzt auf eine Verbindung. Ein
  // Postgres, das schweigt statt abzulehnen, soll auch hier zu einem
  // sichtbaren Fehler führen, nicht zu einem hängenden Prozess.
  const pool = new Pool({ connectionString: datenbankUrl, connectionTimeoutMillis: 10_000 });
  const db = drizzle(pool);

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

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";

const global_ = globalThis as unknown as { kassatrackPool?: Pool };

/*
 * `connectionTimeoutMillis` ausdrücklich gesetzt: node-postgres wartet ohne
 * diese Angabe **unbegrenzt** auf eine Verbindung. Ein Postgres, das nicht
 * ablehnt, sondern schweigt — beim Hochfahren, bei einer Netztrennung, bei
 * erschöpftem Verbindungslimit —, ließe jede Abfrage für immer hängen: keine
 * Fehlermeldung, keine Zeitüberschreitung, nur eine Anfrage, die nie antwortet.
 * Zehn Sekunden sind großzügig für ein Postgres im selben Netz und machen aus
 * einem Hänger einen Fehler, den man sehen und behandeln kann.
 */
const pool =
  global_.kassatrackPool ??
  new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
if (process.env.NODE_ENV !== "production") global_.kassatrackPool = pool;

/*
 * Im Testlauf darf über dieses Handle nichts abgefragt werden.
 *
 * `tests/setup.ts` setzt `DATABASE_URL` auf den Postgres, an dem entwickelt
 * wird (Port 5432) — nicht auf den Wegwerf-Postgres der Tests (5433). Ein Test,
 * der `@/db` nicht durch seine eigene Datenbank ersetzt, träfe damit **still**
 * die Entwicklungsdaten: das `truncate` in einem `beforeEach` löschte sie, und
 * eine Abfrage läse fremde Zeilen und würde womöglich trotzdem grün. Deshalb
 * bricht hier jede Abfrage mit einer Ansage ab, die auch gleich sagt, was zu
 * tun ist.
 *
 * Der Riegel sitzt an der Abfrage und nicht am Laden des Moduls: `src/lib/auth.ts`
 * importiert `db` auf oberster Ebene und legt damit `auth` an, und
 * `tests/auth-gate.test.ts` importiert dieses Modul, um an `erzeugeAuth` zu
 * kommen. Ein Wurf beim Laden nähme dieser Datei die Grundlage, obwohl sie über
 * dieses Handle nie etwas abfragt.
 */
if (process.env.NODE_ENV === "test") {
  const riegel = (): never => {
    throw new Error(
      "Im Test wurde über @/db abgefragt, ohne das Modul zu ersetzen. Dieses " +
        "Handle zeigt auf die Entwicklungsdatenbank. Ersetze es mit " +
        'mock.module("@/db", …) und der Wegwerf-Datenbank aus tests/helfer/db.ts.',
    );
  };
  pool.query = riegel as typeof pool.query;
  pool.connect = riegel as typeof pool.connect;
}

export const db: NodePgDatabase<Record<string, never>> = drizzle(pool);

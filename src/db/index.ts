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

export const db: NodePgDatabase<Record<string, never>> = drizzle(pool);
export { pool };

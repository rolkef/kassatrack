import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";

const global_ = globalThis as unknown as { kassatrackPool?: Pool };

const pool = global_.kassatrackPool ?? new Pool({ connectionString: env.DATABASE_URL });
if (process.env.NODE_ENV !== "production") global_.kassatrackPool = pool;

export const db: NodePgDatabase<Record<string, never>> = drizzle(pool);
export { pool };

import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  PRODUKTBILDER_VERZEICHNIS: z.string().min(1).default("./daten/produktbilder"),
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

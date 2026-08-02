import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { db } from "@/db";
import * as authSchema from "@/db/schema/auth";
import { env } from "@/lib/env";
import { pruefeZugang, ZugriffVerweigert, type ZugriffsDb } from "@/lib/zugriff";

const rpID = new URL(env.BETTER_AUTH_URL).hostname;

/**
 * Baut eine Better-Auth-Instanz über der übergebenen Datenbank.
 * Die Datenbank ist ein Parameter, damit Tests ihre eigene Wegwerf-Datenbank
 * hineinreichen können, ohne von der Import-Reihenfolge abzuhängen.
 */
export function erzeugeAuth(datenbank: ZugriffsDb) {
  return betterAuth({
    database: drizzleAdapter(datenbank, { provider: "pg", schema: authSchema }),
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
          before: async (user, _context) => {
            try {
              await pruefeZugang(datenbank, user.email);
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
}

/** Die Instanz, die die Anwendung benutzt. */
export const auth = erzeugeAuth(db);

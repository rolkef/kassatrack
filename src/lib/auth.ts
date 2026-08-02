import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { db } from "@/db";
import * as authSchema from "@/db/schema/auth";
import { env } from "@/lib/env";
import { ABWEISUNG, ZUGANG_NICHT_FREIGESCHALTET } from "@/lib/anmeldung";
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
                /*
                 * `code` ist hier keine Zierde, sondern die Bedingung dafür,
                 * dass die Abweisung überhaupt sichtbar wird: Der OAuth-Callback
                 * von Better Auth prüft `e.body?.code` und macht nur dann eine
                 * Umleitung auf `errorCallbackURL` daraus. Ohne Code fliegt der
                 * Fehler weiter und der Mensch landet auf einer englischen
                 * Standard-Fehlerseite statt auf unserer Anmeldeseite.
                 *
                 * Die Meldung ist bewusst allgemein und nennt die Adresse
                 * nicht: Better Auth hängt sie als `error_description` an die
                 * Rückleitungs-URL, und eine E-Mail-Adresse in der URL steht
                 * danach im Browserverlauf und in jedem Zugriffsprotokoll
                 * davor. `fehler.message` mit der Adresse bleibt für den Server
                 * erhalten.
                 */
                throw new APIError("FORBIDDEN", {
                  code: ZUGANG_NICHT_FREIGESCHALTET,
                  message: ABWEISUNG,
                });
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

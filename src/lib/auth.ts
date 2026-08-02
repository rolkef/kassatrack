import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { db } from "@/db";
import * as authSchema from "@/db/schema/auth";
import { env } from "@/lib/env";
import { ZUGANG_NICHT_FREIGESCHALTET } from "@/lib/anmeldung";
import { haltAbweisungFest } from "@/lib/abweisung";
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
          before: async (user, kontext) => {
            try {
              await pruefeZugang(datenbank, user.email);
            } catch (fehler) {
              if (fehler instanceof ZugriffVerweigert) {
                /*
                 * Einziger Ort, an dem eine Abweisung überhaupt festgehalten
                 * werden kann — weiter unten steht ausdrücklich, dass die
                 * Adresse in nichts landen darf, was nach außen geht.
                 *
                 * `haltAbweisungFest` wirft konstruktionsbedingt nie (der Fang
                 * liegt in der Funktion selbst, damit kein Umbau hier ihn
                 * weglassen kann). Damit kann ein kaputtes Protokoll die
                 * Abweisung darunter nicht ersetzen: Ein fehlendes Protokoll
                 * darf niemals zu einer offenen Registrierung führen.
                 *
                 * `kontext.path` ist der Endpunktpfad von Better Auth
                 * (`/callback/google`, `/passkey/…`) und sagt, auf welchem Weg
                 * jemand angeklopft hat. Der Kontext kann `null` sein.
                 */
                await haltAbweisungFest(datenbank, {
                  email: user.email,
                  weg: typeof kontext?.path === "string" ? kontext.path : null,
                });

                /*
                 * `message` und `code` tragen absichtlich denselben Wert —
                 * beides sind hier Marken, kein Fließtext.
                 *
                 * Grund: Better Auth erreicht die Anmeldeseite auf zwei
                 * verschiedenen Wegen, und beide nehmen einen anderen Teil
                 * dieses Fehlers.
                 *
                 * Der Weg, den eine Google-Anmeldung tatsächlich nimmt, fängt
                 * den Fehler schon in `handleOAuthUserInfo` ab
                 * (oauth2/link-account.mjs: `if (isAPIError(e)) return
                 * { error: e.message, … }`) und der Callback macht daraus
                 * `redirectOnError(…, result.error.split(" ").join("_"))`.
                 * Dort zählt also die **Meldung**, nicht der Code — und
                 * Leerzeichen würden zu Unterstrichen.
                 *
                 * Nur wenn ein APIError außerhalb jenes inneren try fliegt,
                 * greift `callback.mjs`: `if (isAPIError(e) && e.body?.code)`
                 * — dort zählt der **Code**.
                 *
                 * Ein sprechender deutscher Satz an dieser Stelle käme also
                 * als `?error=Diese_Adresse_ist_für_KassaTrack_…` an und
                 * liefe an `deuteRueckleitung` vorbei. Mit einer Marke stimmen
                 * beide Wege überein, und in der URL landet kein Fließtext.
                 * Der für Menschen geschriebene Satz steht in `ABWEISUNG` und
                 * wird erst auf der Anmeldeseite eingesetzt.
                 *
                 * Achtung: In dem, was **nach außen** geht, steht die Adresse
                 * nicht — weder in der URL noch im Fehlerkörper. `fehler` wird
                 * hier verworfen. Sie als `cause` mitzugeben wäre falsch:
                 * Better Call fädelt `body.cause` in den Fehler ein, und der
                 * Body wird auf dem 403-Weg serialisiert.
                 *
                 * Nach **innen** steht sie sehr wohl: `haltAbweisungFest` oben
                 * legt sie in `abweisung` ab, wo nur die angemeldete
                 * betreibende Person sie sieht (`/verwaltung/zugriff`), und
                 * wo sie nach `AUFBEWAHRUNG_TAGE` wieder verschwindet.
                 */
                throw new APIError("FORBIDDEN", {
                  code: ZUGANG_NICHT_FREIGESCHALTET,
                  message: ZUGANG_NICHT_FREIGESCHALTET,
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

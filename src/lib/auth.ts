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
import {
  pruefeZugang,
  pruefeZugangFuerNutzer,
  ZugriffVerweigert,
  type ZugriffsDb,
} from "@/lib/zugriff";

const rpID = new URL(env.BETTER_AUTH_URL).hostname;

/**
 * Schreibt die Abweisung mit und liefert den Fehler, der nach außen geht.
 *
 * Geteilt von beiden Gates, damit die Zusagen nur an einer Stelle stehen und
 * nicht auseinanderlaufen können. Die Funktion **wirft nicht selbst** — sie
 * gibt den Fehler zurück, und das `throw` bleibt an der Aufrufstelle sichtbar.
 * Bei einer Sicherheitsgrenze soll man den Abbruch dort lesen können, wo er
 * passiert.
 *
 * `haltAbweisungFest` wirft konstruktionsbedingt nie (der Fang liegt in der
 * Funktion selbst). Ein kaputtes Protokoll kann die Abweisung darunter also
 * nicht ersetzen — ein fehlendes Protokoll darf niemals eine offene Anmeldung
 * ergeben.
 */
async function haltFestUndBaueAbweisung(
  datenbank: ZugriffsDb,
  fehler: ZugriffVerweigert,
  kontext: { path?: unknown } | null,
): Promise<APIError> {
  await haltAbweisungFest(datenbank, {
    // Aus dem Fehler, nicht aus einem zweiten Nachschlagen: Die Adresse steht
    // dort bereits kleingeschrieben bereit.
    email: fehler.email,
    // Endpunktpfad von Better Auth (`/callback/google`, `/passkey/…`) — sagt,
    // auf welchem Weg jemand angeklopft hat. Der Kontext kann `null` sein.
    weg: typeof kontext?.path === "string" ? kontext.path : null,
  });

  return new APIError("FORBIDDEN", {
    code: ZUGANG_NICHT_FREIGESCHALTET,
    message: ZUGANG_NICHT_FREIGESCHALTET,
  });
}

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

    /*
     * Ausdrücklich eingeschaltet, nicht der Voreinstellung überlassen: Better
     * Auth begrenzt sonst nur in der Produktion und großzügiger (100 Anfragen
     * je 10 Sekunden).
     *
     * Der Grund ist die Abweisungstabelle. Jeder abgelehnte Anmeldeversuch legt
     * dort eine Zeile an, und dieser Weg ist von außen ohne Anmeldung
     * erreichbar — ohne Begrenzung könnte jemand die Tabelle mit selbst
     * erfundenen Adressen vollschreiben. 20 Versuche pro Minute und Herkunft
     * sind für eine Anwendung mit einer Handvoll eingeladener Personen reichlich
     * und begrenzen das Wachstum wirksam.
     */
    rateLimit: { enabled: true, window: 60, max: 20 },

    /*
     * Herkunft für die Begrenzung oben — ausdrücklich, nicht der Voreinstellung
     * überlassen. Ohne diesen Block nimmt Better Auth zwar ohnehin schon
     * `x-forwarded-for` (das steht so in `DEFAULT_IP_HEADERS`), aber unbenannt
     * lassen hieße, sich auf einen Vorgabewert zu verlassen, der sich mit
     * einer künftigen Better-Auth-Version ändern könnte, ohne dass hier
     * jemand hinschaut.
     *
     * Annahme, keine in dieser Sitzung erneut nachvollzogene Tatsache:
     * Coolifys mitgelieferter Traefik setzt beim Anlegen der Ressource
     * **kein** `forwardedHeaders.trustedIPs` und kein `insecure` (Stand einer
     * früheren Prüfung gegen `bootstrap/helpers/proxy.php` des
     * coollabsio/coolify-Repos — dort ist `trustedIPs` ein optionaler
     * Zusatzbefehl, den man selbst für z. B. Cloudflare einträgt, kein
     * Standardwert). Traefiks `XForwarded`-Middleware
     * (`pkg/middlewares/forwardedheaders/forwarded_header.go`) verwirft ohne
     * `insecure`/`trustedIPs` jeden aus dem Netz mitgebrachten
     * `X-Forwarded-For` und setzt ihn aus der tatsächlichen Verbindung neu —
     * bei einer normalen Coolify-Installation ohne vorgeschaltetes CDN wäre
     * das also immer genau ein Wert: die echte Adresse der anfragenden
     * Person. Genau dafür reicht Better Auths Vorgabe (`ipAddressHeaders`
     * ohne `trustedProxies`) bereits aus — sie vertraut einem Kopf nur, wenn
     * er exakt einen Wert trägt. **Diese Coolify/Traefik-Annahme wurde seither
     * nicht erneut gegen den aktuellen Stand des coollabsio/coolify-Repos
     * geprüft** — sie kann veralten, falls sich Coolifys Vorgabe ändert. Das
     * belastbare Signal zur Laufzeit ist die Better-Auth-eigene Warnung
     * „Rate limiting could not determine a client IP …" im Server-Log (einmal
     * pro Prozessstart protokolliert): erscheint sie, greift die Annahme oben
     * nicht (mehr), und die Begrenzung fällt auf einen einzigen gemeinsamen
     * Bucket pro Pfad zurück.
     *
     * `trustedProxies` bleibt deshalb hier bewusst leer. Ein Eintrag wäre erst
     * nötig, sobald ein zusätzlicher Sprung vor Traefik dazukäme (etwa
     * Cloudflare) — dann müsste sowohl Traefik (`trustedIPs` für den
     * vorgeschalteten Dienst) als auch dieser Block (`trustedProxies` für
     * dessen Adressraum) angepasst werden, sonst würde die neue Herkunft als
     * Client-Adresse durchgehen und alle Anfragen einer gemeinsamen Bucket
     * zuordnen.
     *
     * Unverändert bleibt dabei das Speicherproblem: `rateLimit` oben nutzt die
     * Vorgabe `storage: "memory"` (siehe `docs/deployment-coolify.md`) — pro
     * Replik ein eigener Zähler, das Gesamtbudget wächst also mit der
     * Replik-Anzahl.
     */
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for"],
      },
    },

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
          //
          // Aber: Er feuert nur beim **Anlegen** des Kontos. Für alles danach
          // sorgt das Sitzungs-Gate weiter unten.
          before: async (user, kontext) => {
            try {
              await pruefeZugang(datenbank, user.email);
            } catch (fehler) {
              if (fehler instanceof ZugriffVerweigert) {
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
                 * Nach **innen** steht sie sehr wohl: `haltFestUndBaueAbweisung`
                 * legt sie in `abweisung` ab, wo nur die angemeldete
                 * betreibende Person sie sieht (`/verwaltung/zugriff`), und
                 * wo sie nach `AUFBEWAHRUNG_TAGE` wieder verschwindet.
                 */
                throw await haltFestUndBaueAbweisung(datenbank, fehler, kontext);
              }
              throw fehler;
            }
          },
        },
      },

      session: {
        create: {
          /*
           * Die Prüfung, die „Zugang entziehen" überhaupt wirksam macht.
           *
           * Das Gate darüber feuert genau einmal, beim Anlegen des Kontos. Wer
           * schon ein Konto hatte, kam danach ohne jede weitere Prüfung
           * herein — ein Entzug war also für genau die Personen wirkungslos,
           * für die man den Knopf drückt. Zu jeder Anmeldung gehört dagegen
           * eine neue Sitzung, und `internalAdapter.createSession` führt jeden
           * Anmeldeweg durch diesen Hook (nachgesehen in
           * `db/internal-adapter.mjs`: `createWithHooks(data, "session", …)`).
           *
           * Der Hook bekommt nur die Sitzungsdaten — `userId`, `token`,
           * `expiresAt` —, aber keine Adresse; `pruefeZugangFuerNutzer` schlägt
           * sie nach. Das kostet eine Abfrage pro Anmeldung, nicht pro Aufruf:
           * Bestehende Sitzungen werden hier nicht angefasst.
           *
           * Dieselben drei Zusagen wie oben: jede nicht freigeschaltete Adresse
           * wird abgewiesen, ein Nicht-`ZugriffVerweigert` fliegt unverändert
           * weiter (ein Datenbankausfall darf keine offene Anmeldung ergeben),
           * und ein Fehler beim Mitschreiben kann die Abweisung nicht
           * verschlucken.
           */
          before: async (sitzung, kontext) => {
            try {
              await pruefeZugangFuerNutzer(datenbank, sitzung.userId);
            } catch (fehler) {
              if (fehler instanceof ZugriffVerweigert) {
                throw await haltFestUndBaueAbweisung(datenbank, fehler, kontext);
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

import { and, eq } from "drizzle-orm";
import type { NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { user } from "@/db/schema/auth";
import { allowedEmail } from "@/db/schema/zugriff";

export type ZugriffsDb = NodePgDatabase<Record<string, never>>;

/**
 * Ein Datenbank-Handle, das auch eine **laufende Transaktion** sein darf.
 *
 * `db.transaction(async (tx) => …)` reicht kein `NodePgDatabase` herein, sondern
 * eine `PgTransaction`. Beide erben von `PgDatabase`, und genau das ist hier der
 * gemeinsame Nenner: Wer diesen Typ verlangt, lässt sich sowohl von außerhalb
 * als auch von innerhalb einer Transaktion aufrufen.
 *
 * Bewusst **nicht** als Erweiterung von `ZugriffsDb`: Den Typ reicht
 * `src/lib/auth.ts` an den Drizzle-Adapter von Better Auth weiter, und der
 * verlangt das konkrete Handle. Deshalb zwei Namen statt eines aufgeweiteten.
 *
 * `ZugriffsDb` ist auf diesen Typ zuweisbar, alle bisherigen Aufrufer bleiben
 * also unverändert gültig.
 */
export type DbOderTransaktion = PgDatabase<NodePgQueryResultHKT, Record<string, never>>;

export class ZugriffVerweigert extends Error {
  /**
   * Die abgewiesene Adresse, kleingeschrieben — oder `null`, wenn keine
   * mitkam.
   *
   * Als eigenes Feld und nicht bloß im Meldungstext, damit die Gates in
   * `src/lib/auth.ts` sie für das Protokoll herausziehen können, ohne sie aus
   * einem Satz zurückparsen oder ein zweites Mal nachschlagen zu müssen.
   * Achtung: Dieser Fehler bleibt damit strikt intern — er darf nie zum
   * Aufrufer nach außen durchgereicht werden. Die Gates ersetzen ihn deshalb
   * durch einen `APIError` ohne Adresse.
   */
  readonly email: string | null;

  constructor(email?: string | null) {
    super(
      email
        ? `Die Adresse ${email} ist für KassaTrack nicht freigeschaltet.`
        : "Ohne freigeschaltete E-Mail-Adresse ist keine Anmeldung möglich.",
    );
    this.name = "ZugriffVerweigert";
    this.email = email ? normalisiereEmail(email) : null;
  }
}

/**
 * Wird geworfen, wenn jemand die Zugriffsverwaltung benutzen will, ohne die
 * Betreiber-Rolle zu haben. Angemeldet ja, berechtigt nein — das ist kein
 * Fehlverhalten, und die Oberfläche sagt das entsprechend.
 */
export class NichtBetreiber extends Error {
  constructor() {
    super("Diese Seite ist der betreibenden Person vorbehalten.");
    this.name = "NichtBetreiber";
  }
}

export function normalisiereEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function istEmailZugelassen(db: ZugriffsDb, email: string): Promise<boolean> {
  const normalisiert = normalisiereEmail(email);
  if (normalisiert === "") return false;

  const treffer = await db
    .select({ id: allowedEmail.id })
    .from(allowedEmail)
    .where(eq(allowedEmail.email, normalisiert))
    .limit(1);

  return treffer.length > 0;
}

/** Ob diese Adresse einladen und Zugänge entziehen darf. */
export async function istBetreiber(db: ZugriffsDb, email: string): Promise<boolean> {
  const normalisiert = normalisiereEmail(email);
  if (normalisiert === "") return false;

  const treffer = await db
    .select({ id: allowedEmail.id })
    .from(allowedEmail)
    .where(and(eq(allowedEmail.email, normalisiert), eq(allowedEmail.istBetreiber, true)))
    .limit(1);

  return treffer.length > 0;
}

/**
 * Ob es überhaupt eine betreibende Person gibt.
 *
 * Die erste Zeile mit `ist_betreiber = true` wird beim Aufsetzen von Hand
 * gesetzt (siehe Task 10). Wird das vergessen, kann niemand verwalten — und
 * dann soll die Seite das erklären, statt so zu tun, als sei die anfragende
 * Person das Problem.
 */
export async function gibtEsBetreiber(db: ZugriffsDb): Promise<boolean> {
  const treffer = await db
    .select({ id: allowedEmail.id })
    .from(allowedEmail)
    .where(eq(allowedEmail.istBetreiber, true))
    .limit(1);

  return treffer.length > 0;
}

/**
 * Wirft `NichtBetreiber`, wenn diese Adresse nicht verwalten darf.
 *
 * Fehlschlagen in Richtung „zu": Gibt es gar keine betreibende Person, darf das
 * die Verwaltung nicht für alle öffnen. Ohne Eintrag kommt niemand durch.
 */
export async function pruefeBetreiber(db: ZugriffsDb, email: string): Promise<void> {
  if (!(await istBetreiber(db, email))) throw new NichtBetreiber();
}

export async function pruefeZugang(db: ZugriffsDb, email: string | undefined | null): Promise<void> {
  if (!email || !(await istEmailZugelassen(db, email))) {
    throw new ZugriffVerweigert(email);
  }
}

/**
 * Prüft die Allowlist für ein **bestehendes Konto** und liefert dessen Adresse.
 *
 * Warum es diese zweite Fassung braucht: Die Prüfung in
 * `databaseHooks.user.create.before` feuert genau einmal, beim Anlegen des
 * Kontos. Wer schon ein Konto hat, kam danach ohne jede weitere Prüfung
 * herein — „Zugang entziehen" war für genau die Personen wirkungslos, für die
 * man den Knopf überhaupt drückt. Diese Funktion sitzt deshalb zusätzlich im
 * Sitzungs-Hook, der bei **jeder** Anmeldung läuft.
 *
 * Der Sitzungs-Hook bekommt nur die Sitzungsdaten (`userId`, `token`, …) und
 * keine Adresse; sie wird hier nachgeschlagen. Die Normalisierung in
 * `istEmailZugelassen` ist dabei Absicherung, nicht Notwendigkeit: Better Auth
 * schreibt `user.email` beim Anlegen und Ändern selbst klein
 * (`db/internal-adapter.mjs`, `oauth2/link-account.mjs`). Eine gemischte
 * Schreibweise kann nur aus einer direkt eingefügten Zeile stammen — und die
 * dürfte nicht dazu führen, dass eine freigeschaltete Person ausgesperrt wird.
 *
 * Gibt es zu der Kennung keinen Nutzer, wird abgewiesen statt durchgelassen:
 * Im Zweifel ist die Tür zu.
 *
 * **Kopplung an die Adapter-Einstellungen.** Gelesen wird über das äußere
 * `db`-Handle, nicht über den gerade laufenden Adapter von Better Auth. Das
 * geht gut, weil der Drizzle-Adapter `transaction: false` voreingestellt hat:
 * Die Nutzerzeile ist festgeschrieben, bevor `createSession` läuft, und diese
 * Abfrage sieht sie. Würde jemand `transaction: true` setzen, liefe das Anlegen
 * von Nutzer und Sitzung in einer offenen Transaktion — die Zeile wäre von hier
 * aus unsichtbar, und **jede Erstanmeldung** bekäme keine Sitzung. Das
 * scheiterte zwar in Richtung „zu", wäre aber ein vollständiger Ausfall der
 * Registrierung. Wer die Adapter-Einstellungen ändert, muss hier mitlesen.
 */
export async function pruefeZugangFuerNutzer(db: ZugriffsDb, userId: string): Promise<string> {
  if (!userId) throw new ZugriffVerweigert(null);

  const [zeile] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!zeile) throw new ZugriffVerweigert(null);

  await pruefeZugang(db, zeile.email);
  return normalisiereEmail(zeile.email);
}

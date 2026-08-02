import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { user } from "@/db/schema/auth";
import { allowedEmail } from "@/db/schema/zugriff";

export type ZugriffsDb = NodePgDatabase<Record<string, never>>;

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
 * keine Adresse; sie wird hier nachgeschlagen. `user.email` trägt dabei die
 * Schreibweise des Anbieters und wird von Better Auth nirgends normalisiert —
 * `istEmailZugelassen` normalisiert sie, sonst sperrte eine Großschreibung im
 * Konto eine freigeschaltete Person aus.
 *
 * Gibt es zu der Kennung keinen Nutzer, wird abgewiesen statt durchgelassen:
 * Im Zweifel ist die Tür zu.
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

import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { session, user } from "@/db/schema/auth";
import { allowedEmail, invite } from "@/db/schema/zugriff";
import { normalisiereEmail, type ZugriffsDb } from "@/lib/zugriff";

export class EinladungUngueltig extends Error {
  constructor() {
    super("Diese Einladung ist ungültig, abgelaufen oder bereits eingelöst.");
    this.name = "EinladungUngueltig";
  }
}

/**
 * Legt eine Einladung an und schaltet die Adresse **sofort** frei.
 *
 * Das ist Absicht und nicht bloß Bequemlichkeit: Die Freischaltung hängt damit
 * nicht daran, ob der Einladungslink jemals geöffnet wird. Ein Messenger, der
 * beim Verschicken eine Linkvorschau holt, löst den Token nämlich mit ein
 * (siehe `loeseEinladungEin`). Wäre die Freischaltung an das Einlösen
 * gekoppelt, könnte das Versenden der Einladung sie verbrennen. So bleibt die
 * eingeladene Person in jedem Fall anmeldeberechtigt; der Token entscheidet
 * nur noch darüber, ob sie die Willkommensseite zu sehen bekommt.
 */
export async function erzeugeEinladung(
  db: ZugriffsDb,
  eingabe: { email: string; erstelltVon: string; gueltigkeitTage?: number },
): Promise<{ token: string; gueltigBis: Date }> {
  const email = normalisiereEmail(eingabe.email);
  // 32 Byte, base64url-kodiert: 43 Zeichen ohne Sonderzeichen, damit der Link
  // ungeschützt durch Messenger, QR-Codes und Adresszeilen geht.
  const token = randomBytes(32).toString("base64url");
  const gueltigBis = new Date(Date.now() + (eingabe.gueltigkeitTage ?? 14) * 86_400_000);

  await db
    .insert(allowedEmail)
    .values({ id: randomUUID(), email, hinzugefuegtVon: eingabe.erstelltVon })
    .onConflictDoNothing({ target: allowedEmail.email });

  await db.insert(invite).values({
    id: randomUUID(),
    token,
    email,
    erstelltVon: eingabe.erstelltVon,
    gueltigBis,
  });

  return { token, gueltigBis };
}

/**
 * Löst einen Token ein — genau einmal.
 *
 * Prüfung und Markierung stecken in **einem** Update mit allen Bedingungen in
 * der `where`-Klausel. Zwei getrennte Schritte (erst lesen, dann schreiben)
 * hätten ein Zeitfenster, in dem derselbe Token zweimal durchginge.
 */
export async function loeseEinladungEin(
  db: ZugriffsDb,
  token: string,
): Promise<{ email: string }> {
  const [eintrag] = await db
    .update(invite)
    .set({ eingeloestAm: new Date() })
    .where(
      and(eq(invite.token, token), isNull(invite.eingeloestAm), gt(invite.gueltigBis, new Date())),
    )
    .returning({ email: invite.email });

  if (!eintrag) throw new EinladungUngueltig();
  return { email: eintrag.email };
}

/**
 * Nimmt die Adresse von der Liste **und** beendet ihre laufenden Sitzungen.
 *
 * Beides zusammen ergibt erst eine Aussperrung, und die Reihenfolge ist
 * Absicht:
 *
 * 1. **Freischaltung streichen.** Damit kommt keine neue Sitzung mehr zustande
 *    — das Sitzungs-Gate in `src/lib/auth.ts` prüft die Liste bei jeder
 *    Anmeldung.
 * 2. **Bestehende Sitzungen löschen.** Sonst bliebe die Person bis zum Ablauf
 *    ihrer Sitzung angemeldet, obwohl der Zugang entzogen ist.
 * 3. **Offene Einladungen entwerten.** Siehe unten.
 *
 * Scheitert Schritt 2, ist die Person trotzdem beim nächsten Anmelden draußen.
 * In der umgekehrten Reihenfolge wäre eine Teilausführung schlechter: abgemeldet,
 * aber weiterhin berechtigt, sich sofort neu anzumelden. Schritt 3 steht zuletzt,
 * weil er als einziger nichts aussperrt: Ein noch offener Token käme auch für
 * sich genommen nirgends hinein (`loeseEinladungEin` schaltet nichts frei), er
 * ließe nur eine Seite eine Unwahrheit behaupten.
 *
 * **Warum Schritt 3 überhaupt nötig ist.** Wird jemand zwischen dem Erstellen
 * der Einladung und dem Öffnen des Links entzogen — der gewöhnliche Fall
 * „falsche Adresse erwischt" —, ist der Token weiterhin ungenutzt und nicht
 * abgelaufen. Die Einladungsseite prüft nur ihn und schriebe der Person dann
 * „«Adresse» ist freigeschaltet. Melde dich mit dieser Adresse an." Sie täte
 * genau das und liefe in die Abweisung — zwei Bildschirme hintereinander, die
 * einander widersprechen. Der Entzug bleibt damit der eine Ort, an dem „draußen"
 * entschieden wird.
 *
 * `lower(user.email)` aus demselben Grund wie in `holeZugaenge`: Better Auth
 * schreibt Adressen selbst klein, direkt eingefügte Zeilen laufen daran aber
 * vorbei. Ohne die Absicherung blieben deren Sitzungen hier stehen — und das
 * wäre eine Aussperrung, die nur halb stattfindet.
 */
export async function entzieheZugang(db: ZugriffsDb, email: string): Promise<void> {
  const normalisiert = normalisiereEmail(email);

  await db.delete(allowedEmail).where(eq(allowedEmail.email, normalisiert));

  const betroffene = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, normalisiert));

  if (betroffene.length > 0) {
    await db.delete(session).where(
      inArray(
        session.userId,
        betroffene.map((zeile) => zeile.id),
      ),
    );
  }

  // Als eingelöst markiert statt gelöscht: `loeseEinladungEin` wertet genau
  // dieses Feld aus, und die Zeile bleibt als Spur erhalten, dass eingeladen
  // wurde. Nur die noch offenen — eine bereits eingelöste Einladung trägt ihren
  // Zeitpunkt, und der soll nicht überschrieben werden.
  await db
    .update(invite)
    .set({ eingeloestAm: new Date() })
    .where(and(eq(invite.email, normalisiert), isNull(invite.eingeloestAm)));
}

export type Zugang = {
  id: string;
  email: string;
  erstelltAm: Date;
  /**
   * Ob zu dieser Adresse bereits ein Konto besteht.
   *
   * **Nur noch eine Auskunft.** Früher entschied dieses Feld, was „Zugang
   * entziehen" bewirkt: Die Allowlist wurde allein beim Anlegen des Kontos
   * geprüft, ein bestehendes Konto überlebte den Entzug also. Das gilt nicht
   * mehr — `databaseHooks.session.create.before` prüft bei jeder Anmeldung, und
   * `entzieheZugang` beendet zusätzlich die laufenden Sitzungen. Ein Entzug
   * sperrt damit jede Adresse aus, mit Konto wie ohne.
   *
   * Geblieben ist der Unterschied, was *zusätzlich* passiert: Nur wo ein Konto
   * besteht, gibt es eine laufende Anmeldung zu beenden. Genau das — und nichts
   * weiter — sagt die Oberfläche noch dazu.
   */
  hatKonto: boolean;
  /** Darf einladen und Zugänge entziehen. */
  istBetreiber: boolean;
};

/**
 * Die freigeschalteten Adressen, jeweils mit der Angabe, ob dazu schon ein
 * Konto besteht.
 */
export async function holeZugaenge(db: ZugriffsDb): Promise<Zugang[]> {
  const zeilen = await db
    .select({
      id: allowedEmail.id,
      email: allowedEmail.email,
      erstelltAm: allowedEmail.erstelltAm,
      istBetreiber: allowedEmail.istBetreiber,
      konto: user.id,
    })
    .from(allowedEmail)
    // `leftJoin`, nicht `innerJoin`: Die überwiegende Mehrheit der Einträge hat
    // noch kein Konto, und genau die sollen sichtbar bleiben.
    //
    /*
     * `lower(user.email)` als Absicherung, nicht als Notwendigkeit.
     *
     * Better Auth schreibt Adressen beim Anlegen und Ändern selbst klein
     * (`db/internal-adapter.mjs`: `email: user.email?.toLowerCase()` in
     * `createUser` und `createOAuthUser`; `oauth2/link-account.mjs` ebenso beim
     * Aktualisieren). Über den normalen Anmeldeweg kann hier also gar keine
     * gemischte Schreibweise ankommen.
     *
     * Direkt eingefügte Zeilen — Einspielskripte, Migrationen, ein Eingriff von
     * Hand in der Datenbank — laufen an dieser Normalisierung vorbei. Und
     * Postgres vergleicht `text` unterscheidend, `allowed_email.email` ist per
     * Constraint kleingeschrieben: Ohne `lower()` fände eine so entstandene
     * Zeile ihr Konto nicht und die Seite meldete „Noch nicht angemeldet" für
     * jemanden, der längst ein Konto hat. Ein Zeichen Aufwand für einen Fall,
     * der sonst still danebengeht.
     */
    .leftJoin(user, eq(sql`lower(${user.email})`, allowedEmail.email))
    .orderBy(asc(allowedEmail.erstelltAm));

  return zeilen.map(({ konto, ...rest }) => ({ ...rest, hatKonto: konto !== null }));
}

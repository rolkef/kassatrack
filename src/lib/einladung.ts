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
 *
 * Scheitert Schritt 2, ist die Person trotzdem beim nächsten Anmelden draußen.
 * In der umgekehrten Reihenfolge wäre eine Teilausführung schlechter: abgemeldet,
 * aber weiterhin berechtigt, sich sofort neu anzumelden.
 *
 * `lower(user.email)`, weil `user.email` die Schreibweise des Anbieters trägt
 * und von Better Auth nirgends normalisiert wird — ein direkter Vergleich
 * ließe die Sitzungen von `Neu@Example.at` stehen.
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
}

export type Zugang = {
  id: string;
  email: string;
  erstelltAm: Date;
  /**
   * Ob zu dieser Adresse bereits ein Konto besteht — die wichtigste Angabe der
   * ganzen Seite, weil sie bestimmt, was „Zugang entziehen" tatsächlich
   * bewirkt.
   *
   * Die Allowlist wird **nur** in `databaseHooks.user.create.before` geprüft,
   * also genau einmal: beim Anlegen des Kontos. Wer schon ein Konto hat, kommt
   * danach ohne erneute Prüfung herein. Das Entziehen streicht deshalb nur die
   * Einladung; ein bestehendes Konto bleibt bestehen. Die Oberfläche sagt das
   * so, statt eine Aussperrung zu versprechen, die nicht stattfindet.
   */
  hatKonto: boolean;
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
      konto: user.id,
    })
    .from(allowedEmail)
    // `leftJoin`, nicht `innerJoin`: Die überwiegende Mehrheit der Einträge hat
    // noch kein Konto, und genau die sollen sichtbar bleiben.
    //
    // `lower(user.email)`: `allowed_email.email` ist per Constraint
    // kleingeschrieben, `user.email` trägt dagegen die Schreibweise des
    // Anbieters und wird von Better Auth nirgends normalisiert. Postgres
    // vergleicht `text` unterscheidend nach Groß- und Kleinschreibung — ohne
    // `lower()` fände ein Konto mit `Neu@Example.at` seine Zeile nicht.
    .leftJoin(user, eq(sql`lower(${user.email})`, allowedEmail.email))
    .orderBy(asc(allowedEmail.erstelltAm));

  return zeilen.map(({ konto, ...rest }) => ({ ...rest, hatKonto: konto !== null }));
}

import { randomUUID } from "node:crypto";
import { desc, gte, lt } from "drizzle-orm";
import { abweisung } from "@/db/schema/zugriff";
import { normalisiereEmail, type ZugriffsDb } from "@/lib/zugriff";

/**
 * Wie lange abgelehnte Anmeldeversuche aufbewahrt werden.
 *
 * Die Frist ist eine bewusste Abwägung, keine runde Zahl aus Verlegenheit.
 * In dieser Tabelle stehen E-Mail-Adressen von Personen, die *keine* Nutzer
 * sind — personenbezogene Daten Dritter, für die es keine Einwilligung gibt.
 * Sie haben genau zwei Zwecke:
 *
 * 1. „Warum kommt die Person, die ich eingeladen habe, nicht herein?" — diese
 *    Frage wird innerhalb von Minuten bis Tagen gestellt.
 * 2. „Versucht jemand von außen hereinzukommen?" — ein Muster daraus liest man
 *    über Wochen ab, nicht über Monate.
 *
 * 30 Tage decken beides ab. Alles darüber wäre eine dauerhafte Sammlung
 * fremder Adressen ohne Zweck.
 */
export const AUFBEWAHRUNG_TAGE = 30;

export type Abweisung = {
  id: string;
  email: string | null;
  weg: string | null;
  zeitpunkt: Date;
};

function fristBeginn(): Date {
  return new Date(Date.now() - AUFBEWAHRUNG_TAGE * 86_400_000);
}

/**
 * Schreibt einen abgelehnten Anmeldeversuch mit — und wirft dabei **nie**.
 *
 * Diese Funktion wird aus dem Registrierungs-Gate in `src/lib/auth.ts` heraus
 * gerufen, unmittelbar bevor die Abweisung geworfen wird. Ein Fehler beim
 * Mitschreiben darf die Abweisung unter keinen Umständen ersetzen oder
 * verschlucken: Eine fehlende Protokolltabelle wäre sonst ein Weg, aus einer
 * geschlossenen Anmeldung eine offene zu machen. Deshalb liegt der Fang hier
 * drin und nicht beim Aufrufer — so kann kein späterer Umbau ihn versehentlich
 * weglassen.
 *
 * Die Adresse wird kleingeschrieben abgelegt, weil die Allowlist ebenfalls nur
 * gegen die kleingeschriebene Form vergleicht. Stünde hier die Originalform,
 * könnte man die Schreibweise für die Ursache halten — sie ist es nie.
 */
export async function haltAbweisungFest(
  db: ZugriffsDb,
  eingabe: { email: string | null | undefined; weg: string | null },
): Promise<void> {
  try {
    const email = eingabe.email ? normalisiereEmail(eingabe.email) : null;
    await db.insert(abweisung).values({
      id: randomUUID(),
      email: email === "" ? null : email,
      weg: eingabe.weg,
    });
  } catch (fehler) {
    // Sichtbar für den Betrieb, folgenlos für die Anmeldung.
    console.warn("Abgewiesener Anmeldeversuch konnte nicht mitgeschrieben werden:", fehler);
  }
}

/**
 * Liefert die jüngsten Abweisungen und räumt dabei die abgelaufenen weg.
 *
 * Das Löschen hängt am Lesen, weil es in dieser Phase noch keinen Zeitplaner
 * gibt. Damit die Frist trotzdem verlässlich gilt, wird zusätzlich beim Lesen
 * gefiltert: Selbst wenn das Löschen einmal scheitert, bekommt niemand einen
 * Eintrag zu sehen, der älter als die Frist ist.
 */
export async function holeAbweisungen(db: ZugriffsDb, grenze = 50): Promise<Abweisung[]> {
  const grenzzeit = fristBeginn();

  await db.delete(abweisung).where(lt(abweisung.zeitpunkt, grenzzeit));

  return db
    .select()
    .from(abweisung)
    .where(gte(abweisung.zeitpunkt, grenzzeit))
    .orderBy(desc(abweisung.zeitpunkt))
    .limit(grenze);
}

/**
 * Macht aus dem Endpunktpfad von Better Auth einen Namen, den man vorlesen kann.
 *
 * Ein unbekannter Pfad wird absichtlich unverändert durchgereicht statt zu
 * „Sonstiges" zusammengefasst: Kommt ein neuer Anmeldeweg dazu, soll er in der
 * Verwaltung auffallen und nicht verschwinden.
 */
export function benenneWeg(weg: string | null): string {
  if (!weg) return "Unbekannt";
  if (weg.includes("google")) return "Google";
  if (weg.includes("passkey")) return "Passkey";
  return weg;
}

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
 * Diese Funktion wird aus **beiden** Gates in `src/lib/auth.ts` heraus gerufen —
 * dem Registrierungs-Gate (`user.create.before`) und dem Sitzungs-Gate
 * (`session.create.before`) —, unmittelbar bevor die Abweisung geworfen wird.
 * Ein abgewiesener Anmeldeversuch einer entzogenen Person landet also ebenso
 * hier wie einer von einer nie eingeladenen Adresse. Ein Fehler beim
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

  // Wer schreibt, räumt auch auf. Dieser Weg ist von außen und ohne Anmeldung
  // erreichbar — genau der Pfad, über den die Tabelle wachsen kann. Dass er
  // zugleich aufräumt, hält sie auch dann in der Frist, wenn die
  // Verwaltungsseite monatelang niemand öffnet.
  await raeumeAbweisungenAuf(db);
}

/**
 * Löscht alles, was älter als die Frist ist — und wirft dabei **nie**.
 *
 * Der Fang liegt wie bei `haltAbweisungFest` in der Funktion selbst, damit kein
 * Aufrufer ihn vergessen kann. Das ist hier nicht nur Vorsicht: Ohne ihn
 * scheiterte die ganze Verwaltungsseite an einem misslungenen Aufräumen, und
 * der Filter beim Lesen, der die Frist absichern soll, käme nie zum Zug.
 *
 * Gerufen wird sie an drei Stellen, damit die Zusage auf dem Bildschirm
 * („Einträge werden nach 30 Tagen gelöscht") auch stimmt, wenn niemand
 * hinsieht:
 *
 * - beim Start des Servers und danach täglich (`src/instrumentation.ts`),
 * - bei jedem Lesen der Verwaltungsseite (`holeAbweisungen`),
 * - bei jedem Schreiben (`haltAbweisungFest`).
 *
 * Damit gibt es keinen Betriebszustand mehr, in dem Adressen Dritter monatelang
 * liegen bleiben, ohne dass jemand die Seite öffnet.
 */
export async function raeumeAbweisungenAuf(db: ZugriffsDb): Promise<void> {
  try {
    await db.delete(abweisung).where(lt(abweisung.zeitpunkt, fristBeginn()));
  } catch (fehler) {
    console.warn("Abgelaufene Abweisungen konnten nicht gelöscht werden:", fehler);
  }
}

/**
 * Liefert die jüngsten Abweisungen und räumt dabei die abgelaufenen weg.
 *
 * Zusätzlich zum Löschen wird beim Lesen **gefiltert**. Das ist echte
 * Absicherung und keine Zierde: `raeumeAbweisungenAuf` schluckt seine Fehler,
 * ein Aufräumen kann also unbemerkt ausfallen — und selbst dann bekommt niemand
 * einen Eintrag zu sehen, der älter als die Frist ist.
 */
export async function holeAbweisungen(db: ZugriffsDb, grenze = 50): Promise<Abweisung[]> {
  await raeumeAbweisungenAuf(db);

  return db
    .select()
    .from(abweisung)
    .where(gte(abweisung.zeitpunkt, fristBeginn()))
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

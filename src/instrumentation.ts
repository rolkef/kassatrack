/**
 * Läuft einmal beim Start jeder Serverinstanz (Next-Konvention).
 *
 * Einziger Zweck bisher: die Aufbewahrungsfrist für abgelehnte Anmeldeversuche
 * einhalten, auch wenn niemand die Verwaltungsseite öffnet. Ohne das hinge das
 * Löschen allein am Lesen und am Schreiben — und die Zusage auf dem Bildschirm
 * („Einträge werden nach 30 Tagen gelöscht") stimmte in einer ruhigen Instanz
 * schlicht nicht. Dort stehen Adressen von Personen, die keine Nutzer sind;
 * eine Frist, die niemand durchsetzt, ist keine.
 */
export async function register() {
  // Nur im Node-Server, nicht in der Edge-Laufzeit: Dort gibt es weder die
  // pg-Verbindung noch einen langlebigen Prozess für den Zeitgeber.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { db } = await import("@/db");
  const { raeumeAbweisungenAuf } = await import("@/lib/abweisung");

  const TAG = 24 * 60 * 60 * 1000;

  /*
   * Bewusst **ohne** `await`: Next wartet `register()` ab, bevor es Anfragen
   * annimmt. Ein `await` hier hinge also die Startbereitschaft an eine
   * Datenbankverbindung. Der Pool in `src/db/index.ts` ist zwar auf zehn
   * Sekunden begrenzt (`connectionTimeoutMillis`), das hilft hier aber nichts:
   * Auf Coolify startet der App-Container regelmäßig, bevor Postgres
   * Verbindungen annimmt, und dann verzögert jeder Versuch die Bereitschaft um
   * seine volle Wartezeit — für eine Aufgabe, die niemand erwartet. Den Fehler
   * abzufangen hülfe nichts, weil das Warten selbst das Problem ist.
   *
   * Aufräumen ist Hausarbeit und darf im Hintergrund passieren.
   * `raeumeAbweisungenAuf` wirft nie, es kann hier also nichts unbehandelt
   * entkommen.
   */
  void raeumeAbweisungenAuf(db);

  // `unref()`, damit dieser Zeitgeber den Prozess nicht am Beenden hindert —
  // ein Container, der auf sein Aufräumen wartet, wäre ein schlechter Tausch.
  setInterval(() => void raeumeAbweisungenAuf(db), TAG).unref();
}

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

  await raeumeAbweisungenAuf(db);

  // `unref()`, damit dieser Zeitgeber den Prozess nicht am Beenden hindert —
  // ein Container, der auf sein Aufräumen wartet, wäre ein schlechter Tausch.
  // `raeumeAbweisungenAuf` wirft nie, ein unbehandelter Fehler kann hier also
  // nicht den Prozess mitnehmen.
  setInterval(() => void raeumeAbweisungenAuf(db), TAG).unref();
}

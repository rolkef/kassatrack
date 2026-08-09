/**
 * Führt die Aktion aus und liefert den geworfenen Fehler zurück — oder
 * `undefined`, wenn nichts geworfen wurde.
 *
 * Warum nicht `expect(...).rejects`: Bun 1.3.14 hängt auf Windows oder stürzt
 * mit einem Segfault ab, wenn `.resolves`/`.rejects` auf ein Versprechen
 * angewendet wird, das selbst eine Datenbankabfrage ausführt, und im selben
 * Test bereits eine Abfrage abgewartet wurde. Die Abfrage wird serverseitig
 * fertig, das Versprechen bleibt offen. Nachgemessen: dieselbe Konstruktion
 * mit einem Versprechen ohne Datenbankzugriff läuft durch. Siehe
 * task-4-report.md.
 */
export async function faengtFehler(aktion: () => Promise<unknown>): Promise<unknown> {
  try {
    await aktion();
    return undefined;
  } catch (fehler) {
    return fehler;
  }
}

import { describe, expect, it } from "bun:test";
import journal from "../drizzle/meta/_journal.json";

/*
 * Eine Bremse gegen einen Fehler, der sich sonst nirgends zeigt.
 *
 * Drizzles Migrator wendet eine Migration nur an, wenn ihr Zeitstempel *nach*
 * dem der zuletzt eingetragenen liegt (`dialect.cjs`: `!lastDbMigration ||
 * Number(lastDbMigration.created_at) < migration.folderMillis`). Verglichen
 * wird also allein gegen den letzten Eintrag der Datenbank, nicht gegen die
 * ganze Historie. Steht im Journal eine Migration mit einem Zeitstempel, der
 * kleiner ist als der ihrer Vorgängerin, wird sie auf jeder bereits migrierten
 * Datenbank stillschweigend und dauerhaft übersprungen — ohne Fehler, ohne
 * Ausgabe, und auch ein zweiter Lauf holt sie nicht nach.
 *
 * Kein anderer Test in diesem Projekt kann das fangen: Alle legen eine frische
 * Wegwerf-Datenbank an, dort ist `lastDbMigration` undefiniert und der
 * fehlerhafte Zweig wird nie betreten. Genau so ist der Fall in Plan 4, Task 6
 * durchgerutscht und erst beim Review aufgefallen — bei 479 grünen Tests.
 *
 * Diese Datei prüft deshalb nicht das Verhalten, sondern die Zusicherung, aus
 * der es folgt: streng aufsteigende Zeitstempel in Feldreihenfolge. Sie hält
 * eine spätere Handänderung, einen schiefen Merge oder eine verstellte Uhr auf.
 * Siehe auch `docs/offene-punkte.md`, „Bekannte Falle: Migrations-Zeitstempel".
 */
describe("drizzle/meta/_journal.json", () => {
  it("führt streng aufsteigende Zeitstempel", () => {
    const eintraege = journal.entries;
    expect(eintraege.length).toBeGreaterThan(0);

    for (let i = 1; i < eintraege.length; i++) {
      const vorher = eintraege[i - 1];
      const jetzt = eintraege[i];

      // Die Meldung nennt die Tags, weil die reine Zahl niemandem sagt, welche
      // Migration nie mehr angewendet würde.
      expect(
        jetzt.when,
        `${jetzt.tag} liegt zeitlich vor ${vorher.tag} und würde auf jeder bereits migrierten Datenbank übersprungen`,
      ).toBeGreaterThan(vorher.when);
    }
  });

  /*
   * Die Reihenfolge im Feld ist das, wonach der Migrator die `.sql`-Dateien
   * abarbeitet. Liefe sie der Nummerierung zuwider, prüfte der Test oben die
   * falsche Abfolge und sähe trotzdem grün aus.
   */
  it("führt die Einträge in der Reihenfolge ihrer Nummerierung", () => {
    expect(journal.entries.map((eintrag) => eintrag.idx)).toEqual(
      journal.entries.map((_, i) => i),
    );
  });
});

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { getQueriesForElement } from "@testing-library/dom";

GlobalRegistrator.register();

/**
 * Ein neu gebundenes `screen` — und der Grund, warum es das braucht:
 *
 * Bun wertet die CommonJS-Abhängigkeiten einer Testdatei vor deren
 * ESM-Importen aus. `@testing-library/dom` ist CommonJS und kommt deshalb
 * hoch, bevor diese Datei happy-dom registriert. Sein eingebautes `screen`
 * prüft beim Auswerten `typeof document !== "undefined"`, findet nichts und
 * ersetzt sich durch Platzhalter, die bei jeder Abfrage werfen — auch später,
 * wenn das Dokument längst da ist. An der Importzeile sieht man das nicht.
 *
 * Hier ist `document` bereits vorhanden, also binden wir die Abfragen selbst.
 * Komponententests importieren `screen` daher aus dieser Datei, nicht aus
 * `@testing-library/react`.
 */
export const screen = getQueriesForElement(document.body);

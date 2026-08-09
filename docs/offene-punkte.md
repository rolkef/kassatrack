# Offene Punkte

Bewusst aufgeschobene Kleinigkeiten aus abgeschlossenen Phasen. Nichts hier blockiert etwas — jeder Eintrag wurde in einem Review gefunden, bewertet und mit Begründung zurückgestellt. Diese Datei existiert, damit aus „aufgeschoben" nicht „vergessen" wird.

## Aus Phase 1 (Fundament & Auth, PR #1)

### Erledigt

- **Entzug verglich die Einladung buchstabengenau.** Behoben in Plan 2, Task 9: `entzieheZugang` vergleicht jetzt über `lower(invite.email)`, wie es `holeZugaenge` und die Sitzungssuche schon taten. Ein Test in `tests/einladung.test.ts` fügt eine gemischt geschriebene Zeile per rohem SQL ein und hält den Fall fest.

### Warten

- **`bunx eslint .` ist projektweit kaputt** — `typescript-eslint` unterstützt TypeScript 7 noch nicht. Blockiert auf eine Veröffentlichung stromaufwärts; `next build` lintet in Next 16 ohnehin nicht mehr. Wieder aufgreifen, wenn Unterstützung erscheint.
- **`aktionen.ts` beschreibt `entzieheZugang` als zweistufig**, es sind inzwischen drei Schritte. Reiner Prosa-Verzug, die Fehlermeldung selbst stimmt weiterhin.
- **`entzieheZugang` hängt jetzt hart an der `invite`-Tabelle.** Fehlt sie, wird ein erfolgreicher Entzug als Fehler gemeldet. In der Produktion unkritisch, weil die Migration sie anlegt.
- **Zwei Testdateien ersetzen `@/db` global** durch je eine eigene Wegwerf-Datenbank. Heute wirkungslos, weil Testdateien nacheinander laufen und keine andere Datei darüber abfragt.
- **`ZugriffsDb` ist auf ein leeres Schema typisiert.** Bricht, sobald jemand Drizzle mit einem Schema-Objekt aufruft — dann als Übersetzungsfehler, nicht stillschweigend. Phase 2 erzwingt das vermutlich; dann mitziehen.
- **Der `pg_trgm`-Test prüft nur die Zeile, die ihn unmittelbar davor angelegt hat.** In Phase 2 sinnvoll ersetzen, sobald die Erweiterung für die Produktsuche tatsächlich verwendet wird — dann sollte er eine Abfrage prüfen, keine Erweiterung.
- **Gemischte Zeitstempel-Konvention:** die von Better Auth erzeugten Tabellen nutzen `timestamp` ohne Zeitzone, die handgeschriebenen `timestamptz`. Bewusst so belassen, weil die erzeugte Datei unverändert übernommen wird.
- **Alle Screenshots unter `docs/bilder/`** tragen links oben ein weißes Rechteck des Aufnahmewerkzeugs.

### Bewusste Entscheidungen, keine Mängel

- **Ein einziger Betreiber, kein Wiederherstellungsweg.** Geht dieser Zugang verloren, hilft nur ein direkter Datenbankzugriff. Nach Nennung der Konsequenz so entschieden.
- **Keinerlei Offline-Fähigkeit.** Der Service Worker darf keine angemeldeten Inhalte zwischenspeichern; ohne Seiten im Cache gibt es nichts anzuzeigen, wenn das Netz fehlt.
- **Drei Dockerfile-Zeilen wurden nie gebaut.** Beide möglichen Fehlerbilder brechen den Bau sichtbar ab, ein gebautes-aber-kaputtes Image kann nicht entstehen.
- **Die Annahme, dass Coolifys Proxy `x-forwarded-for` sendet**, ist belegt zitiert, aber nicht selbst geprüft. Gepaart mit einer Protokollzeile, an der man erkennt, wenn sie nicht mehr gilt.

## Aus Plan 2 (Katalog & Preis-Engine)

### Warten

- **Jede Anfrage schlägt die Sitzung zweimal nach.** Seit die Navigation im Wurzel-Layout sitzt, ruft dieses `holeSitzung()` und zusätzlich `istBetreiber()`, während die Seite darunter ihr eigenes `requireUser()` ruft. Fachlich richtig, aber eine Abfrage je Anfrage zu viel. `cache()` aus React wäre der übliche Weg; er verändert allerdings `src/lib/sitzung.ts`, auf das `tests/sitzung.test.ts` ausdrücklich zielt — deshalb nicht nebenbei erledigt.
- **Berührungsgrößen sind nirgends automatisiert geprüft.** `min-h-14` und `min-h-12` stehen im Quelltext und auf den Aufnahmen unter `docs/bilder/`, aber kein Test hält sie fest; ein `min-h-8` fiele erst jemandem im Geschäft auf. Gilt für die ganze App, nicht erst seit Plan 2.
- **Die Startseite hat kein aktives Ziel in der Navigation.** Folgerichtig — sie ist keiner der drei Bereiche, und die Wortmarke trägt dort `aria-current="page"`. Beim ersten Blick sieht es trotzdem aus, als sei nichts ausgewählt. Falls das stört, ist die Startseite ein viertes Ziel.

### Bewusste Entscheidungen, keine Mängel

- **Die Wortmarke ist am Handy der einzige Weg zurück zur Startseite.** Der Plan nennt drei Ziele (Erfassen, Produkte, Zugriff); die Startseite ist keines davon und wäre damit unerreichbar gewesen — als installierte PWA gibt es keine Zurück-Schaltfläche des Browsers. Die Leiste trägt deshalb unverändert die drei Ziele, und die Wortmarke führt zusätzlich heim.
- **`holeLetzteErfassungen` filtert keine Preisarten.** Die Liste auf der Startseite ist ein Protokoll, keine Grundlage für eine Berechnung — der `PROMO`-Ausschluss gilt beim Referenzpreis, wo eine Aktion etwas verschieben könnte. Gekennzeichnet wird sie trotzdem, sonst läsen sich zwei Preise derselben Kette am selben Tag wie ein Widerspruch.

# Offene Punkte

Bewusst aufgeschobene Kleinigkeiten aus abgeschlossenen Phasen. Nichts hier blockiert etwas — jeder Eintrag wurde in einem Review gefunden, bewertet und mit Begründung zurückgestellt. Diese Datei existiert, damit aus „aufgeschoben" nicht „vergessen" wird.

## Aus Phase 1 (Fundament & Auth, PR #1)

### Zuerst nachziehen

**Entzug vergleicht die Einladung buchstabengenau.** `entzieheZugang` in `src/lib/einladung.ts` löscht die Freischaltung und die Sitzungen unabhängig von Groß- und Kleinschreibung, entwertet die Einladung aber mit einem exakten Vergleich. `allowed_email` hat eine Bedingung, die Kleinschreibung erzwingt — `invite` hat keine. Ein von Hand eingefügter Einladungs-Eintrag mit Großbuchstaben überlebt daher den Entzug, und die betroffene Person liest wieder „deine Adresse ist freigeschaltet", bevor sie abgewiesen wird.

Relevant, weil `docs/deployment-coolify.md` beibringt, Zeilen von Hand einzufügen. Behebung: `lower(invite.email)` im Vergleich, oder eine Bedingung auf der Spalte. Ein Ausdruck.

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

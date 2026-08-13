# Plan 4: Einkaufszettel und Optimierer — Design

## Kontext

Plan 2 hat die Preis-Engine gebaut (Referenzpreis vs. aktueller Bestpreis je
Kette), Plan 3 den Katalog um Barcode-Scan und Produktbilder ergänzt. Beide
beantworten „ist das gerade billig?" für ein einzelnes Produkt. Keiner
beantwortet die eigentliche Frage vor einem Einkauf: **Was von meiner Liste
kaufe ich wo, um insgesamt am wenigsten zu bezahlen?**

Das ist der Teil, der dem Projektnamen seinen Sinn gibt — ohne ihn bleibt
KassaTrack ein Preisarchiv, kein Einkaufswerkzeug.

**Zielbild:** Eine Liste zusammenstellen, aus dem Katalog oder frei. Die App
zeigt sofort zwei Zahlen nebeneinander: „alles bei einer Kette" und
„aufgeteilt auf die günstigsten Ketten je Artikel", mit der Ersparnis in
Euro. Beim Einkaufen wird abgehakt — und das Abhaken bietet direkt an, den
bezahlten Preis einzutragen, sodass ein Griff Einkaufen und Erfassen in
einem erledigt.

## Umfang

**Drin:**
- Beliebig viele Einkaufszettel, Artikel aus dem Katalog oder als Freitext
- Optimierer: „Bester Einzelmarkt" und „Optimale Aufteilung" nebeneinander,
  Ersparnis in Euro, zweischichtig (ruhige Kernaussage, dichte
  Ketten-Aufschlüsselung auf Tap)
- Abhaken eines Artikels bietet die vorausgefüllte Preiserfassung an
  (Produkt und empfohlene Kette aus der Optimierer-Zeile); das Abhaken
  selbst geschieht erst mit dem erfolgreichen Speichern des Preises

**Bewusst nicht drin (Entscheidungen aus dem Brainstorming, mit
Begründung):**
- **Kein Offline-Modus.** Die ursprüngliche Design-Spec wollte den
  Einkaufszettel offline-fähig (IndexedDB, Sync bei Reconnect) — Phase 1 hat
  aber bewusst entschieden, dass der Service Worker keinerlei angemeldete
  Inhalte zwischenspeichern darf. Der Einkaufszettel verhält sich wie
  `/erfassen` und `/produkte`: braucht Netz, zeigt bei Verbindungsabbruch
  einen klaren Hinweis. Konsistenz mit einer bestehenden
  Sicherheitsentscheidung wiegt hier schwerer als die im Supermarkt manchmal
  schwache Verbindung.
- **Keine gebündelte Preisabfrage für den Optimierer.** `holePreisMatrix`
  kostet laut Plan 2 rund 16 Abfragen je Produkt, und die eigene
  Dokumentation warnt ausdrücklich davor, sie pro Zeile einer Listenseite
  aufzurufen — genau das tut der Optimierer hier, einmal je
  katalogverknüpftem Artikel. Bewusst so belassen: ein Haushalt, keine
  Nebenläufigkeit, Listen mit typischerweise unter 30 Positionen — eine
  Frage von Millisekunden auf einer modernen Postgres-Instanz. Im Code als
  referenzierte, bewusste Entscheidung zu vermerken, nicht stillschweigend
  zu wiederholen.
- **Keine Katalog-Vorschläge beim Eintippen eines Freitext-Artikels.**
  Freitext bleibt reiner Merkposten ohne Ähnlichkeitssuche gegen den
  Katalog. Eine Fuzzy-Suche beim Tippen (wie Plan 3s Strichcode-Vorschlag)
  wäre mehr Bauaufwand für einen Fall, der beim Abhaken ohnehin sauber
  aufgelöst wird — dort entsteht bei Bedarf ganz regulär ein neues Produkt.
- **Kein Löschen von Produkten aus dem Katalog.** Existiert heute nicht;
  das Schema sieht dennoch vor, dass ein Zettel-Eintrag das überleben würde
  (siehe Datenmodell), reine Vorsorge, kein Feature dieses Plans.
- **Billa/Spar-Online-Anbindung und Beleg-Erkennung** sind eigene, spätere
  Pläne — der Optimierer liest ausschließlich, was in Plan 2/3 bereits
  erfasst wurde.

## Datenmodell

Zwei neue Tabellen, ohne Filial- oder Mandantenkonzept — wie der Rest der
App: ein Haushalt, alle authentifizierten Nutzer sehen alles.

```
shopping_list
  id            text primary key
  name          text not null
  erstellt_am   timestamptz not null default now()

shopping_list_item
  id            text primary key
  list_id       text not null references shopping_list(id) on delete cascade
  product_id    text references product(id)          -- nullable
  freitext      text                                   -- nullable
  stueckzahl    integer not null default 1
  abgehakt_am   timestamptz                            -- nullable
```

**Genau eines von `product_id`/`freitext`, nie beides, nie keines** — als
Check-Constraint erzwungen, nach demselben Muster wie die bestehenden
Schema-Bedingungen in `src/db/schema/katalog.ts`/`preise.ts`.

`stueckzahl` ist bewusst ein eigenes Feld und **nicht** zu verwechseln mit
`product.menge` (der Packungsgröße aus Plan 2, z. B. 250 g) — hier zählt,
wie viele Packungen gekauft werden sollen. Der Optimierer multipliziert
`bestpreis × stueckzahl` je Artikel.

`product_id` referenziert `product` bewusst **ohne** `on delete cascade`:
Verschwände ein Produkt aus einem anderen Grund, bliebe der Zettel-Eintrag
als Freitext-Rest bestehen (`product_id` auf `null`, ursprünglicher Name in
`freitext` nachgetragen), statt lautlos vom Zettel zu verschwinden.
Produktlöschung existiert heute nicht — das ist reine Vorsorge, kein
aktiver Mechanismus dieses Plans.

## Der Optimierer

Baut ausschließlich auf vorhandenen Plan-2-Funktionen auf
(`holePreisMatrix`, `bestesAngebot`) — keine neue Preislogik.

- **Optimale Aufteilung:** für jedes katalogverknüpfte Item
  `holePreisMatrix` + `bestesAngebot(...).heuteSieger` aufrufen,
  `bestpreis × stueckzahl` je Kette aufsummieren. Ergebnis: eine
  Gesamtsumme mit einer Zeile je Kette samt der Artikel, die dort zu kaufen
  wären.
- **Bester Einzelmarkt:** für jede Kette die Summe aus
  `bestpreis × stueckzahl` über alle Items, bei denen diese Kette selbst
  einen `bestpreis` trägt. Fehlt der Kette bei auch nur einem Item der
  Preis, gilt sie als **unvollständig** — keine Summe, sondern ein Hinweis
  („nicht alles hier erfasst"), und sie fällt aus dem Einzelmarkt-Vergleich
  heraus. Unter den vollständigen Ketten gewinnt die günstigste.
- **Ersparnis in Euro:** Differenz zwischen der günstigsten vollständigen
  Einzelmarkt-Summe und der Aufteilungs-Summe. Gibt es keine vollständige
  Kette, entfällt die Ersparnis-Aussage (nichts, womit man vergleichen
  könnte).
- Freitext-Items fließen in **keine** der beiden Rechnungen ein.
- Eine Liste, in der kein einziges Item einen Preis hat, zeigt „noch keine
  Preise erfasst" statt einer leeren oder irreführenden Rechnung.

## Oberfläche

Vier Bereiche, in den bestehenden Navigationsrahmen eingehängt (Details der
Einhängung — viertes Ziel oder eigener Startseiten-Einstieg — legt der
Implementierer mit den Design-Skills fest):

1. **Listenübersicht** — alle Zettel, neue Liste anlegen, öffnen, löschen.
2. **Listendetail** — Artikel hinzufügen (Katalogsuche wie `/produkte`,
   oder „als Freitext hinzufügen"), Menge ändern, abhaken, entfernen.
   Darüber die zweischichtige Optimierer-Ansicht: **ruhige Ebene** — die
   betonte Aussage ist entweder „Am günstigsten: alles bei X, Y €" oder,
   wenn die Aufteilung spürbar günstiger ist, „Aufgeteilt sparst du Y €";
   **dichte Ebene** auf Tap — die volle Ketten-für-Ketten-Aufschlüsselung.
3. **Abhak-Fluss** — ein katalogverknüpftes Item abhaken öffnet die
   vorausgefüllte Preiserfassung (Produkt, empfohlene Kette aus der
   Optimierer-Zeile für dieses Item); der bestehende `erfasse`-Server-Action-
   Pfad aus Plan 2 übernimmt das Speichern unverändert. **Abhaken und Preis
   speichern sind ein Vorgang, kein Zwischenzustand:** Der Haken wird erst
   gesetzt, wenn die Erfassung tatsächlich gespeichert ist; bricht die
   Person ab, bleibt das Item unverändert unabgehakt. Ein Freitext-Item
   abhaken öffnet dieselbe Erfassung ohne Vorbefüllung — wie eine
   unbekannte EAN in Plan 3 auf die manuelle Eingabe zurückfällt.
4. Kein eigener Bildschirm für „Freitext zu Katalogprodukt machen" — das
   passiert implizit beim Abhaken, über denselben `findeProdukt`/
   `legeProduktAn`-Pfad, den jede andere Preiserfassung auch nimmt.

## Fehlerfälle

- Erfassung beim Abhaken abgebrochen oder abgewiesen → Item bleibt
  unabgehakt, keine Preiszeile entsteht (dieselbe Zusicherung wie in Plan 2:
  nichts wird angelegt, wenn geprüft wird).
- Ein bereits abgehaktes Item entfernen oder eine Liste löschen wirkt
  **nicht** auf `price_observation` zurück — der einmal gespeicherte Preis
  bleibt in der append-only-Historie bestehen, unabhängig davon, was mit dem
  Zettel-Eintrag danach geschieht. Es gibt bewusst kein „Häkchen wieder
  entfernen": Es markiert ein abgeschlossenes Ereignis (ein Preis wurde
  erfasst), keinen umkehrbaren Schalter.
- Leere Liste → kein Optimierer, Einstieg zum Hinzufügen.
- Liste ganz ohne Preisdaten (nur Freitext oder unbeobachtete Katalog-
  Artikel) → „noch keine Preise erfasst".
- Keine Kette vollständig für „Bester Einzelmarkt" → nur die Aufteilung
  wird gezeigt, keine Ersparnis-Aussage ohne Vergleichspunkt.

## Testen

- `src/lib/einkaufszettel.ts` (Listen-/Artikel-CRUD, Optimierer-Aggregation)
  gegen echtes Postgres, mit Fixtures, die gezielt Ketten-Lücken erzeugen
  (für den „unvollständig"-Zweig von „Bester Einzelmarkt").
- Server Actions und Formulare nach dem in Plan 2/3 etablierten Muster:
  Aktionen als Props injiziert, kein `mock.module` für Aufrufer-Tests;
  `requireUser()` als erste Anweisung, mit Test.
- Der Abhak-Fluss: ein Test, der bestätigt, dass ein abgebrochener/
  abgewiesener Erfassungsversuch das Item unabgehakt lässt und keine
  Preiszeile hinterlässt.

## Verifikation

**Plan 4 gilt als fertig, wenn:**

1. `bun test`, `bunx tsc --noEmit`, `bun run build` fehlerfrei
2. Eine Liste mit Artikeln aus mindestens zwei Ketten zeigt „Bester
   Einzelmarkt" und „Optimale Aufteilung" korrekt und unterschiedlich,
   inklusive Ersparnis in Euro
3. Eine Kette mit einer Preislücke bei einem Artikel gilt für „Bester
   Einzelmarkt" nachweislich als unvollständig, nicht als künstlich billig
4. Ein katalogverknüpftes Item abzuhaken öffnet die vorausgefüllte
   Preiserfassung; ein Abbruch lässt das Item nachweislich unabgehakt
5. Ein Freitext-Item abzuhaken öffnet dieselbe Erfassung ohne Vorbefüllung
6. Freitext-Items erscheinen in keiner der beiden Optimierer-Rechnungen
7. Einkaufszettel-Bildschirme sind auf einem Handy in der Hand bedienbar,
   im Browser geprüft, mit Aufnahmen belegt

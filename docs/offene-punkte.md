# Offene Punkte

Bewusst aufgeschobene Kleinigkeiten aus abgeschlossenen Phasen. Nichts hier blockiert etwas — jeder Eintrag wurde in einem Review gefunden, bewertet und mit Begründung zurückgestellt. Diese Datei existiert, damit aus „aufgeschoben" nicht „vergessen" wird.

## Aus Phase 1 (Fundament & Auth, PR #1)

### Erledigt

- **Entzug verglich die Einladung buchstabengenau.** Behoben in Plan 2, Task 9: `entzieheZugang` vergleicht jetzt über `lower(invite.email)`, wie es `holeZugaenge` und die Sitzungssuche schon taten. Ein Test in `tests/einladung.test.ts` fügt eine gemischt geschriebene Zeile per rohem SQL ein und hält den Fall fest.

### Warten

- **`bunx eslint .` ist projektweit kaputt** — `typescript-eslint` unterstützt TypeScript 7 noch nicht. Blockiert auf eine Veröffentlichung stromaufwärts; `next build` lintet in Next 16 ohnehin nicht mehr. Wieder aufgreifen, wenn Unterstützung erscheint.
- **`aktionen.ts` beschreibt `entzieheZugang` als zweistufig**, es sind inzwischen drei Schritte. Reiner Prosa-Verzug, die Fehlermeldung selbst stimmt weiterhin.
- **`entzieheZugang` hängt jetzt hart an der `invite`-Tabelle.** Fehlt sie, wird ein erfolgreicher Entzug als Fehler gemeldet. In der Produktion unkritisch, weil die Migration sie anlegt.
- **Vier Testdateien ersetzen `@/db` global** durch je eine eigene Wegwerf-Datenbank: `tests/erfassen-aktionen`, `tests/verwaltung-aktionen`, `tests/sitzung` (Plan 2, Task 7 kam als dritte dazu) und `tests/ean-aktionen` (Plan 3, Task 6). Die Attrappen selbst sind unbedenklich — `src/db/index.ts` exportiert nur `db`, es kann also keiner späteren Datei ein Export fehlen. Was jede Registrierung aber sehr wohl tut: Sie hebt für den ganzen restlichen Lauf den Riegel auf, den das Modul unter `NODE_ENV === "test"` auf `pool.query` und `pool.connect` legt. Eine spätere Testdatei, die `@/db` nicht selbst ersetzt und darüber abfragt, bekommt deshalb nicht mehr die Ansage „ersetze das Modul", sondern stillschweigend die längst gestoppte Wegwerf-Datenbank der ersten Datei — und damit einen Verbindungsfehler, der nichts über die Ursache sagt. Heute fragt keine solche Datei ab.
- **`ZugriffsDb` ist auf ein leeres Schema typisiert.** Bricht, sobald jemand Drizzle mit einem Schema-Objekt aufruft — dann als Übersetzungsfehler, nicht stillschweigend. Phase 2 erzwingt das vermutlich; dann mitziehen.
- **Der `pg_trgm`-Test prüft nur die Zeile, die ihn unmittelbar davor angelegt hat.** In Phase 2 sinnvoll ersetzen, sobald die Erweiterung für die Produktsuche tatsächlich verwendet wird — dann sollte er eine Abfrage prüfen, keine Erweiterung.
- **Gemischte Zeitstempel-Konvention:** die von Better Auth erzeugten Tabellen nutzen `timestamp` ohne Zeitzone, die handgeschriebenen `timestamptz`. Bewusst so belassen, weil die erzeugte Datei unverändert übernommen wird.
- **Eine einzige Aufnahme trägt noch das weiße Rechteck des Aufnahmewerkzeugs:** `docs/bilder/einladung-handy.png`, links oben über dem Wort „Willkommen". Der Eintrag stand ursprünglich für *alle* Aufnahmen; nachgeprüft wurde inzwischen jede einzelne der 33 Dateien — die 25 in Plan 2 gezogenen sind sauber, ebenso die übrigen sieben aus Phase 1. Übrig bleibt diese eine.

### Bewusste Entscheidungen, keine Mängel

- **Ein einziger Betreiber, kein Wiederherstellungsweg.** Geht dieser Zugang verloren, hilft nur ein direkter Datenbankzugriff. Nach Nennung der Konsequenz so entschieden.
- **Keinerlei Offline-Fähigkeit.** Der Service Worker darf keine angemeldeten Inhalte zwischenspeichern; ohne Seiten im Cache gibt es nichts anzuzeigen, wenn das Netz fehlt.
- **Drei Dockerfile-Zeilen wurden nie gebaut.** Beide möglichen Fehlerbilder brechen den Bau sichtbar ab, ein gebautes-aber-kaputtes Image kann nicht entstehen.
- **Die Annahme, dass Coolifys Proxy `x-forwarded-for` sendet**, ist belegt zitiert, aber nicht selbst geprüft. Gepaart mit einer Protokollzeile, an der man erkennt, wenn sie nicht mehr gilt.

## Aus Plan 2 (Katalog & Preis-Engine)

Neun Tasks, jeder mit eigenem Review. Was hier steht, ist der Abgleich gegen das
vollständige Protokoll dieser Reviews — nicht nur gegen das, was zuletzt noch
präsent war.

### Erledigt

- **Die NaN-Falle auf dem Preis-Schreibpfad ist zu.** `schreibeAngebot` und `schreibeBeobachtung` weisen nicht-endliche Zahlen jetzt selbst ab. Nötig war das, weil die Datenbank hier kein Auffangnetz ist: `numeric` nimmt `'NaN'` an und `NaN > 0` ist in Postgres wahr, die Bedingungen `preis_positiv` und `offer_preis_positiv` lassen den Wert also durch. Beim Lesen gewann er danach jeden Vergleich, den er verlieren musste. Die Begrenzung in `src/app/erfassen/aktionen.ts` hatte den Fall zwar unerreichbar gemacht — aber nur für die Oberfläche, und Plan 3 schreibt an ihr vorbei.
- **Die Aktionszeile hängt nicht mehr an einem geratenen Pfad.** Task 7 hat `revalidatePath("/produkte/<id>")` geschrieben, bevor es die Seite gab; Task 8 hat den Pfad angelegt und damit geradegezogen.
- **`pg_trgm` wird von einer echten Migration angelegt**, nicht mehr nur vom Test-Helfer (`drizzle/0005_wandering_trgm.sql`). Vorher hätte die Produktsuche in einer frisch migrierten Datenbank nicht funktioniert, ohne dass ein Test es gezeigt hätte. Für den nächsten Coolify-Einsatz: prüfen, dass der Datenbank-Benutzer die Erweiterung anlegen darf.
- **Zwei Testdateien hingen voneinander ab, ohne es zu wissen.** `tests/erfassen-aktionen` und `tests/verwaltung-aktionen` ersetzten beide `@/lib/sitzung` für den ganzen Lauf; die zuerst laufende Datei reichte damit ihre eigene Attrappe an die zweite weiter. Beide lesen das echte Modul jetzt über den Anhang `?echt` ein und sind damit von der Dateireihenfolge unabhängig.

### Warten — Produkt und Oberfläche

- **Eine Fehleingabe lässt sich aus der App nicht korrigieren.** Beobachtungen sind bewusst append-only, es gibt kein Löschen und kein Ändern — und damit auch keinen Weg zurück, wenn sich jemand vor dem Regal um eine Stelle vertippt. Der falsche Wert geht in den Median ein und bleibt dort ein halbes Jahr lang. Das ist die sichtbarste offene Lücke des ganzen Produkts, und der Plan hat sie nicht als Prüfkriterium geführt: Sie gehört ausdrücklich in den Umfang von Plan 3, nicht noch einmal ins Wiederentdecken. Die Append-only-Zusage muss dabei nicht fallen — eine Gegenbuchung oder ein Widerrufskennzeichen erhält die Historie und nimmt den Wert trotzdem aus der Berechnung.
- **Treuekarten- und Mengenrabatt-Preise sind schreibgeschützt im Wortsinn:** Sie werden erfasst, erscheinen einmal in der Liste „Zuletzt erfasst" auf der Startseite — und sind danach von keinem Bildschirm aus je wieder zu sehen. Der Referenzpreis schließt sie aus (richtig, sie gelten nicht für alle), eine `offer`-Zeile erzeugen sie nicht (auch richtig, sie sind an eine Bedingung geknüpft). Dasselbe trifft eine Aktion, sobald ihr Gültig-bis verstrichen ist. Jede Einzelentscheidung stimmt; in Summe kann jemand Daten eintragen, die die App ihm nie wieder zeigt.
- **Die Trefferzahl der Suche kann lügen.** Die Abfrage ist bei `TREFFER_OBERGRENZE = 50` gekappt, die Überschrift zeigt aber schlicht die Länge der Liste. Bei genau fünfzig Treffern steht dort „50" statt „50+".
- **`aktion` ist null, wann immer die Aktion nicht gewinnt.** Der Aufrufer kann „läuft gerade, lohnt sich aber nicht" nicht von „läuft keine" unterscheiden. Für den Bildschirm „wo kaufe ich das?" ist das richtig; wer ein Kennzeichen unabhängig vom Sieger will, braucht ein zweites Feld. Die Bildunterschrift, die diesen Fall heute trägt, ist zudem sehr leise.
- **Der Fokus geht beim Absenden verloren**, weil die Schaltfläche währenddessen gesperrt wird. Dasselbe Muster wie in Phase 1, deshalb nicht einzeln behoben.
- **Nach einem Speichern und einer darauffolgenden Abweisung stehen Bestätigung und Fehlermeldung gleichzeitig** im Formular. Beide Aussagen stimmen für sich, zusammen lesen sie sich widersprüchlich.
- **Jede Anfrage schlägt die Sitzung zweimal nach.** Seit die Navigation im Wurzel-Layout sitzt, ruft dieses `holeSitzung()` und zusätzlich `istBetreiber()`, während die Seite darunter ihr eigenes `requireUser()` ruft. Fachlich richtig, aber eine Abfrage je Anfrage zu viel. `cache()` aus React wäre der übliche Weg; er verändert allerdings `src/lib/sitzung.ts`, auf das `tests/sitzung.test.ts` ausdrücklich zielt — deshalb nicht nebenbei erledigt.
- **Berührungsgrößen sind nirgends automatisiert geprüft.** `min-h-14` und `min-h-12` stehen im Quelltext und auf den Aufnahmen unter `docs/bilder/`, aber kein Test hält sie fest; ein `min-h-8` fiele erst jemandem im Geschäft auf. Gilt für die ganze App, nicht erst seit Plan 2.
- **Die Startseite hat kein aktives Ziel in der Navigation.** Folgerichtig — sie ist keiner der drei Bereiche, und die Wortmarke trägt dort `aria-current="page"`. Beim ersten Blick sieht es trotzdem aus, als sei nichts ausgewählt. Falls das stört, ist die Startseite ein viertes Ziel.

## Aus Plan 3 (Barcode-Scan & Produktbilder)

Acht Tasks, jeder mit eigenem Review, dazu Task 9 als Abschluss. Was hier
steht, ist der Abgleich gegen das vollständige Protokoll dieser Reviews
(`.superpowers/sdd/2026-08-09-plan3-barcode-produktbilder/progress.md`) —
nicht nur gegen das, was zuletzt noch präsent war.

### Erledigt

- **Task 1:** Ein mkdtemp-Leck in den eigenen Test-Fixtures (Important, ein
  Fehler im Brief selbst, nicht des Implementierers) ist behoben — das
  Wurzelverzeichnis wird jetzt getrennt vom Arbeitspfad für die Aufräumung
  festgehalten.
- **Task 4:** Eine SSRF-Lücke (Important, aus automatisiertem
  Sicherheits-Review) ist behoben — `ladeUndSpeichereBild` prüft jetzt
  Host/Protokoll der von Open Food Facts gelieferten `bildUrl`, bevor
  serverseitig abgerufen wird; empirisch gegen echtes Bun-`fetch`-Verhalten
  unter `redirect:"manual"` verifiziert.
- **Task 6:** Ein env-Mock-Leck (Important) ist behoben —
  `mock.module("@/lib/env", …)` in `tests/produktbilder-route.test.ts`
  überlebte ins nächste Testfile und lenkte dessen Schreibvorgänge in ein
  bereits gelöschtes Verzeichnis um. Die erste Reparatur (`afterAll`-Reset)
  wurde empirisch als wirkungslos verifiziert (`afterAll` in einer
  describe-losen Datei feuert auf dieser Windows/Bun-1.3.14-Kombination
  nicht zuverlässig vor der nächsten Datei); endgültig gelöst, indem
  `mock.module` ganz entfernt und stattdessen ins echte
  `env.PRODUKTBILDER_VERZEICHNIS` mit testlaufweit eindeutigem Schlüssel
  geschrieben wird.
- **Task 7:** Der Brief selbst nahm an, `videoRef.current` sei „spätestens
  nach dem ersten Render" gesetzt, wenn `schleife()` direkt nach
  `setZustand("scannt")` aufgerufen wird — falsch, React rendert nicht
  synchron nach einem State-Setter neu. In einem echten Browser wäre die
  Kameravorschau nie verkabelt worden. Vom Implementierer selbst vor dem
  Review gefunden und mit `useEffect` behoben, abgesichert durch eine
  Zusicherung, dass der Decoder sein erstes Argument tatsächlich vom
  `<video>`-Element bekommt, nicht `null`.
- **Task 7/8:** Die Kamera blieb an und ließ sich nicht stoppen, wenn die
  Komponente während des `getUserMedia`-Berechtigungsdialogs aushängte (in
  Task 7 gefunden, in Task 8 behoben — der Fix ging über den Vorschlag
  hinaus: ein StrictMode-Mount/Unmount/Remount wird jetzt zurückgesetzt).

### Warten

- **Task 1:** Kein Test prüft `.gitignore` maschinell auf Korrektheit für
  `/daten/` — von Hand nachgeprüft (`git ls-files` enthält nichts unter
  `daten/`), aber nichts hält das programmatisch fest.
- **Task 1:** `schreibeBild` schreibt nicht-atomar (`writeFile`), kein
  dedizierter Test für einen Teil-Schreibvorgang — beim aktuellen
  Nutzungsmuster (Einzelhaushalt, geringe Nebenläufigkeit, Bilder werden
  einmalig geholt und zwischengespeichert) kein echtes Risiko.
- **Task 4:** `tests/produktbilder.test.ts:172-193` (Exception-Test) liest
  die Datenbank nach dem Wurf nicht erneut, anders als die zwei
  Nachbartests im selben describe-Block. Aktuell folgenlos (der Wurf
  passiert vor jedem Schreibversuch), würde aber einen künftigen Refactor
  nicht auffangen, der `schreibeBild`/`db.update` vor die mögliche
  Netzwerk-Exception verschöbe.
- **Task 4:** Der Happy-Path-Test liest die erzeugte Bilddatei nicht selbst
  erneut von der Platte, um die Bytes zu prüfen — verlässt sich auf
  `schreibeBild`s eigene Bytegenauigkeits-Tests an anderer Stelle derselben
  Datei. Vertretbare Abgrenzung, keine Lücke.
- **Task 4:** Der Kommentar bei `produktbilder.ts:79-82` behauptet, Bun
  liefere unter `redirect:"manual"` eine spec-korrekte
  `opaqueredirect`-Antwort (Status 0) — empirisch liefert es tatsächlich
  eine unverfolgte rohe 3xx-Antwort (Status 302, `type: "default"`). Die
  Sicherheitseigenschaft (`.ok` bleibt `false`) gilt in beiden Fällen,
  reine Dokumentations-Ungenauigkeit, ein Einzeiler bei nächster Berührung.
- **Task 6:** `bestaetigeZuordnung`s Idempotenz-Vertrag steht nur in einem
  Inline-Kommentar, nicht im äußeren Docstring der Funktion — wer nur den
  Docstring liest (wie ein künftiger Implementierer es zuerst täte), sieht
  die Zusicherung nicht.
- **Task 6:** Zeigt `produktId` auf ein anderes Produkt als das, das
  bereits mit der EAN verknüpft ist, liefert die Funktion stillschweigend
  das bereits verknüpfte Produkt zurück — kein Fehler, kein Test, eine
  Verhaltensänderung gegenüber dem ursprünglichen Brief-Design, vermutlich
  beabsichtigt, aber undokumentiert.
- **Task 6:** `loeseEanAuf`s „Anmeldung erforderlich"-Test hängt in seinem
  Bestehen/Scheitern zufällig auch von echter Netzwerk-Erreichbarkeit zu
  Open Food Facts ab, nicht rein vom Auth-Check.
- **Task 8:** `echterDecoder()`/`istScanFaehig()` haben keinerlei
  Testabdeckung — genau die Funktionen, deren Bruch sich nur auf echter
  Hardware zeigen würde, und die Geräteverifikation steht noch aus (siehe
  Checkliste unten).
- **Task 8:** Ein zweiter Scan kann starten, während die Auflösung des
  ersten noch läuft; die frühere Antwort kann bei der Auflösung die
  spätere überschreiben (sichtbar, nicht still, aber es könnte das falsche
  Produkt vorausgefüllt werden).
- **Task 8:** `bestaetigeZuordnung`-Fehler und `loeseEanAuf`-Fehler teilen
  sich einen Fehlerzustand mit einer Meldung, die für den
  `bestaetigeZuordnung`-Fall falsch ist, und verwirft dabei unnötig die
  bereits geladene Vorschlagsliste.
- **Task 8:** `bestaetigeZuordnung`s catch-Pfad im Formular ist ungetestet
  — ließe sich löschen, ohne dass ein Test rot würde.
- **Task 8:** Der Hinweis auf veraltete Screenshots in
  `docs/bilder/README.md` liegt rund 70 Zeilen von den Tabellenzeilen
  entfernt, die er betrifft — wer nur die Tabelle liest, übersieht ihn
  leicht.
- **Task 8:** Die Betonung „bestehendes Produkt vor neuem"
  (`variante="neben"` vs. `"haupt"` je nach `aehnliche.length`) ist nur auf
  Reihenfolge getestet, nicht auf die visuelle Betonung selbst — eine
  Regression zu immer-`"haupt"` bliebe grün.
- **Plan-übergreifend:** Die echte Geräteverifikation (Android + Chrome
  `BarcodeDetector`, echte Better-Auth-Sitzung, HTTPS/`localhost` für
  `getUserMedia`, eine echte bekannte und eine echte unbekannte EAN gegen
  Open Food Facts) steht noch aus — kein Subagent in dieser Umgebung kann
  ein Android-Gerät oder eine interaktive Google-Anmeldung liefern. Siehe
  Checkliste unten für die konkreten Schritte.

### Bewusste Entscheidungen, keine Mängel

- **Kein iOS-Safari-Fallback** (`zxing-wasm`) — Zielumfeld ist
  Android/Chrome.
- **Kein Nachtrage-Weg für Altbestand ohne EAN.**
- **Kein Bild-Refresh**, einmal geladen bleibt ein Bild bestehen.
- **Ein fehlgeschlagener Bild-Download wird nicht automatisch
  wiederholt.**
- **Task 5:** Der Pfad-Traversal-Schutz auf der Bilder-Route ist der
  einzige und ausreichende Riegel — `lesePfadZuBild` selbst hat keinen
  eigenen Schutz, das ist bewusst so (der Reviewer hat aktiv gegen
  Newline-Injektion, Nullbyte, Unicode-Ziffern, Backslash, ein
  nicht-verankertes Regex gefuzzt und keinen Bypass gefunden).
- **Task 9, Step 1 (`compose.yaml`-Volume):** kein Änderungsbedarf. Das
  Bildverzeichnis ist ein lokaler Ordner für die Entwicklung (Next läuft
  dort direkt auf dem Host, nicht im Container); in Coolify wird es
  stattdessen im `Dockerfile` verankert (siehe Abschnitt „Produktbilder —
  persistentes Volume" in `docs/deployment-coolify.md`).

### Geräteverifikation — noch ausständig, für den Betreiber

Task 9 konnte die Browser-Verifikation auf einem echten Android-Gerät
nicht durchführen — kein Android-Gerät, kein `BarcodeDetector` in
Windows-Desktop-Chrome, und keine Möglichkeit, eine echte, authentifizierte
Better-Auth-Sitzung herzustellen (direkte Schreibzugriffe auf die
Benutzer-/Sitzungstabellen wurden von der Umgebungs-Berechtigung verweigert
— das war auch schon bei Task 8 so und wurde dort bewusst nicht umgangen).
Das ist der einzige Teil von Plan 3, der echten Kamerabetrieb belegt statt
nur Verdrahtung und Oberfläche. Checkliste für den Projektbetreiber (mit
echtem Android-Handy):

1. **Sicherer Kontext.** `getUserMedia` verlangt `https://` oder
   `localhost` — ein Aufruf über die reine LAN-IP (`http://192.168.…`)
   fragt gar nicht erst nach der Kamera-Berechtigung. Entweder ein
   selbstsigniertes Zertifikat lokal einrichten, einen Tunnel-Dienst (z. B.
   `bunx localtunnel`) verwenden, oder direkt gegen eine testweise
   erreichbare Coolify-Instanz mit echtem TLS prüfen.
2. **Echte Anmeldung.** Über echtes Google-OAuth (Better Auth) anmelden,
   damit `/erfassen` überhaupt erreichbar ist — kein Mock, keine
   Testroute.
3. **Produktionsbau starten** (`bun run build && bun run start`),
   `/erfassen` auf dem Handy in Chrome öffnen.
4. **Drei Scan-Fälle durchspielen:**
   - Eine EAN, die bereits in `product_ean` verknüpft ist (nach dem ersten
     erfolgreichen Durchlauf zwangsläufig gegeben) → sollte das Formular
     direkt vorausfüllen.
   - Eine EAN, die Open Food Facts kennt, aber noch nicht im eigenen
     Katalog verknüpft ist → sollte den Fuzzy-Vorschlag zeigen.
   - Eine erfundene EAN, die niemand kennt → sollte sauber auf die
     manuelle Eingabe zurückfallen, unverändert.
5. **Kamera-Berechtigung bewusst einmal verweigern** und prüfen, dass der
   Hinweistext erscheint — kein Absturz, keine hängende Oberfläche.
6. **Browser-Konsole prüfen** auf CSP-Verstöße oder andere Fehler während
   des ganzen Durchlaufs.
7. **Screenshots neu ziehen** — siehe `docs/bilder/README.md`, Abschnitt
   „Strichcode-Scan im Erfassungsformular (Plan 3, Task 8)" für den
   genauen, aktuellen Stand des Hinweises. Betrifft mindestens:
   - Drei seit Task 8 veraltete Aufnahmen ganz ohne Scan-Schaltfläche:
     `erfassen-handy-leer.png`, `erfassen-handy-fokus.png`,
     `erfassen-desktop.png`.
   - Neun Aufnahmen aus Task 8, die gegen eine nachgebildete
     Kamera/nachgebildeten Decoder und eine provisorische, nicht
     angemeldete Route entstanden (keine Navigationsleiste sichtbar):
     `erfassen-handy-scan-bereit.png`, `erfassen-handy-scan-kamera.png`,
     `erfassen-handy-scan-vorschlag.png`,
     `erfassen-handy-scan-vorschlag-ohne-treffer.png`,
     `erfassen-handy-scan-vorschlag-fokus.png`,
     `erfassen-handy-scan-uebernommen.png`,
     `erfassen-handy-scan-unbekannt.png`,
     `erfassen-handy-scan-fehlgeschlagen.png`,
     `erfassen-desktop-scan-vorschlag.png`.
   - Vor jeder Neuaufnahme die alte Datei löschen, danach jede neue
     Aufnahme öffnen und gegen ihren Dateinamen und die
     Tabellenbeschreibung in `docs/bilder/README.md` prüfen — wie in jeder
     bisherigen UI-Aufgabe dieses Projekts.
8. Erst wenn alle sieben Punkte durchlaufen sind, gilt
   Plan-3-Verifikationspunkt 6 („Ein echter Scan auf einem Android-Handy
   mit Chrome funktioniert, Browser-verifiziert mit Screenshots") als
   erledigt — nicht vorher, und nicht von einem Subagenten markierbar.

### Warten — Daten, Schema und Abfragen

- **`offer.preis` heißt „preis", hält aber einen Grundpreis in € je Kilo, Liter oder Stück.** Der Schemakommentar und `schreibeAngebot` sagen das jetzt ausdrücklich, und ein Wächter weist wenigstens unsinnige Zahlen ab — aber der *Name* sagt es weiterhin nicht. Flugblätter und Ketten-Schnittstellen veröffentlichen Regalpreise; wer in Plan 3 einliest und den Kommentar überliest, trägt 1,49 € gegen einen Median in €/kg ein, und jede eingelesene Aktion sähe unschlagbar aus. Die Spalte auf `grundpreis` umzubenennen — wie in `price_observation` — bleibt der billige, dauerhafte Weg; er kostet eine Migration und war unmittelbar vor dem Zusammenführen das falsche Risiko.
- **`drizzle/meta/0005_snapshot.json` fehlt**, obwohl `_journal.json` den Eintrag `0005_wandering_trgm` führt. Nachgeprüft und folgenlos: `drizzle-kit migrate` liest nur das Journal und die `.sql`-Dateien, und `bunx drizzle-kit generate` läuft sauber durch („No schema changes") — `0005` ist ein handgeschriebenes `create extension`, das Drizzle ohnehin nicht abbildet, weshalb `0004_snapshot.json` den Tabellenstand weiterhin richtig beschreibt. Bleibt als bekannte Lücke notiert, falls sich eine spätere Drizzle-Fassung anders verhält.
- **`ladeProdukt` läuft zweimal je Produktseite** — einmal für `generateMetadata`, einmal für die Seite selbst. Zwei identische Abfragen, wo eine reichte; `cache()` aus React ist der vorgesehene Weg.
- **`letzteBeobachtung` nimmt die neueste *geholte* Zeile, nicht die neueste *endliche*.** Wäre eine Beobachtung nicht-endlich, stünde das Datum einer Zeile da, die gar nicht in den Referenzpreis eingegangen ist. Die Detailseite hängt die Altersangabe deshalb vorsorglich am Referenzpreis auf, nicht am Zeitstempel — „vor 3 Tagen" kann so nie neben „keine Daten" stehen.
- **`letzteBeobachtung` heißt nicht „zuletzt gesehen".** Es ist die jüngste `NORMAL`-Beobachtung innerhalb von 180 Tagen. Eine Aktion von gestern verschiebt den Wert nicht — was richtig ist, aber beim Beschriften leicht falsch gerät.
- **Der Median sagt nicht, wie viele Werte er verworfen hat.** Er filtert nicht-endliche Zahlen heraus, und `anzahl` zählt seit Task 6 richtig nach dem Filter — aber niemand erfährt, dass von fünf Beobachtungen vier unbrauchbar waren. Der Unterschied zwischen „ein Preis" und „ein Preis von fünf, vier davon Schrott" ist einer, den man sehen wollen würde.
- **Eine Produktseite kostet sechzehn Abfragen** — `holePreisMatrix` fragt je Kette zweimal, dazu die Ketten selbst. Bei fünf Ketten vertretbar und bewusst so belassen. Bricht erst, wenn eine Listenseite die Funktion je Zeile aufruft; heute hat sie genau einen Aufrufer, und die Suchergebnisse zeigen deshalb bewusst keinen Preis.
- **Der Index `(product_id, chain_id, beobachtet_am)` deckt `preisart` nicht ab**, obwohl jede Referenzpreis-Abfrage danach filtert. Nicht vorab optimiert, weil sich das gegen eine echte Abfrage messen lässt, sobald Daten in Menge da sind.
- **`price_observation` verschwindet mit dem Produkt** (`on delete cascade`), obwohl die Tabelle sich als Historie versteht, die nicht verloren gehen soll. Verdient eine bewusste Entscheidung, keinen Reflex.
- **Der Median zweier mittlerer Werte erbt die Gleitkomma-Ungenauigkeit** (`0,15000000000000002`). Innerhalb der Funktion nicht zu beheben — das gehört in die Darstellung.
- **`src/lib/zugriff.ts` nimmt weiterhin das enge `ZugriffsDb`**, während `katalog.ts` und `preise.ts` auf `DbOderTransaktion` umgestellt wurden. Keine Zugriffs-Funktion lässt sich damit innerhalb einer Transaktion aufrufen. Heute braucht das niemand; wissenswert, bevor es jemand versucht.
- **`katalog.ts` deckt zwei Teilbereiche in einer Datei ab.** Heute stimmig; aufteilen, sobald weitere Funktionen rund um `product_ean` und `store_product` dazukommen.
- **Redundante Kopie in `median`:** `[...endlich]` erzeugt ein zweites Feld, obwohl `filter` bereits ein frisches liefert.

### Warten — Tests

- **Kein Test fängt es, wenn jemand `requireUser()` aus den `/produkte`-Routen entfernt.** Die Gates sind an allen elf Routen vorhanden und wurden von Hand nachgezählt, aber keine Regressionsbremse hält sie fest. Gilt für die ganze App, nicht erst seit Plan 2, und ist der einzige Punkt dieser Liste mit sicherheitsrelevantem Beigeschmack.
- **Der Reihenfolge-Test der Ketten beweist weniger, als er scheint.** Die Reihenfolge im `KETTEN`-Feld ist dieselbe wie die der `sortierung`, deshalb kann der Test Einfüge- nicht von Sortier-Reihenfolge unterscheiden. Ein Test, der außerhalb von `legeKettenAn` verkehrt herum einfügt, würde es festnageln.
- **Die Ketten der Test-Fixtures teilen sich alle `sortierung` 0**, die Zeilenreihenfolge ist dort also das, was Postgres gerade liefert.
- **Der Pfad „nur Leerzeichen" *durch* `legeProduktAn` ist ungetestet** — festgehalten ist nur der direkte Einfügeversuch gegen die Datenbank-Bedingung.
- **Der `konfidenz`-Test prüft nur die obere Grenze.** Ein negativer Wert wäre der vollständigere Beweis gewesen.
- **`findeProdukt` und `sichereKettenProdukt` haben keine eigenen Tests**, nur die durch die Erfassungs-Aktion hindurch; der Nebenläufigkeits-Zweig in `katalog.ts` ist gar nicht abgedeckt.
- **Der Suchbildschirm hat keinen eigenen Test** — der Task-Auftrag verlangte keinen.
- **Die Zusicherungen in den `preis-tabelle`-Tests hängen an `textContent`** und würden eine geänderte Formatierung nicht bemerken.
- **`erfassungs-formular.test.tsx` prüft nur das Wort „Grundpreis"**, nicht den Satz, der daneben stehen soll.

### Warten — Prosa und Nachweise

- **„Leidzahl" ist kein deutsches Wort.** Gemeint war „führende Null". Steht in einem Kommentar, einer Testbeschreibung und einer Commit-Nachricht — die Regel selbst ist an allen drei Stellen richtig beschrieben.
- **„Eyebrow" ist das einzige englische Wort im Quelltext** (`erfassungs-formular.tsx`).
- **Fünf einzelne `upsert`-Aufrufe statt eines gebündelten** beim Anlegen der Ketten. Bei fünf Zeilen zur Saatzeit folgenlos.

### Bewusste Entscheidungen, keine Mängel

- **Die Wortmarke ist am Handy der einzige Weg zurück zur Startseite.** Der Plan nennt drei Ziele (Erfassen, Produkte, Zugriff); die Startseite ist keines davon und wäre damit unerreichbar gewesen — als installierte PWA gibt es keine Zurück-Schaltfläche des Browsers. Die Leiste trägt deshalb unverändert die drei Ziele, und die Wortmarke führt zusätzlich heim.
- **`holeLetzteErfassungen` filtert keine Preisarten.** Die Liste auf der Startseite ist ein Protokoll, keine Grundlage für eine Berechnung — der `PROMO`-Ausschluss gilt beim Referenzpreis, wo eine Aktion etwas verschieben könnte. Gekennzeichnet wird sie trotzdem, sonst läsen sich zwei Preise derselben Kette am selben Tag wie ein Widerspruch.

## Aus Plan 4 (Einkaufszettel & Optimierer)

Neun Tasks, jeder mit eigenem Review. Was hier steht, ist der Abgleich gegen
das vollständige Protokoll dieser Reviews
(`.superpowers/sdd/2026-08-13-plan4-einkaufszettel-optimierer/progress.md`) —
nicht nur gegen das, was zuletzt noch präsent war.

### Bekannte Falle: Migrations-Zeitstempel

Der wichtigste Eintrag dieses Abschnitts, weil er weder eine Kleinigkeit noch
auf Plan 4 beschränkt ist.

Drizzles Migrator wendet eine Migration nur an, wenn ihr Zeitstempel *nach* dem
der zuletzt in die Datenbank eingetragenen liegt. Die Stelle ist
`node_modules/drizzle-orm/pg-core/dialect.cjs:64`:

```js
if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) {
```

Verglichen wird also allein gegen den **einen** jüngsten Eintrag, nicht gegen
die ganze Historie. `drizzle-kit generate` stempelt eine neue Migration mit der
echten Uhrzeit ihrer Erzeugung.

Im Journal stehen die Migrationen `0005_wandering_trgm` und
`0006_famous_shinobi_shaw` mit **von Hand gesetzten, in der Zukunft liegenden**
Zeitstempeln: `1786646400000` (2026-08-13T18:40:00Z) und `1786646460000`
(2026-08-13T18:41:00Z). Daraus folgt unmittelbar:

**Jede Migration, die vor dem 2026-08-13T18:41:00Z per `drizzle-kit generate`
erzeugt wird, bekommt einen echten Zeitstempel, der kleiner ist als der von
`0006` — und wird damit auf jeder Datenbank, in der `0006` bereits eingetragen
ist, stillschweigend und dauerhaft übersprungen.** Kein Fehler, keine Ausgabe,
kein Selbstheilen beim zweiten Lauf; die Tabelle fehlt einfach, und der Code,
der sie erwartet, bricht später an einer Stelle, die nichts mit Migrationen zu
tun hat.

Nach diesem Zeitpunkt entschärft sich die Falle von selbst, weil eine echte
Uhrzeit dann größer ist als `0006`. Bis dahin ist sie scharf.

Frische Datenbanken sind nicht betroffen: Dort ist `lastDbMigration`
undefiniert, der erste Zweig der Bedingung greift, und alles wird der Reihe
nach angewendet. Genau deshalb kann **kein einziger Test dieses Projekts** den
Fall zeigen — alle zwölf `migrate()`-Aufrufe legen eine frische Wegwerf-Datenbank
an. In Plan 4, Task 6 ist der Fehler auf diese Weise bei 479 grünen Tests
durchgerutscht und erst im Review aufgefallen, nachgestellt an zwei
Wegwerf-Datenbanken außerhalb des Arbeitsverzeichnisses.

Was dagegen jetzt existiert: `tests/migrations-zeitstempel.test.ts` hält die
Zusicherung fest, aus der das Verhalten folgt — streng aufsteigende `when`-Werte
in Feldreihenfolge. Das repariert die bestehenden Zeitstempel *nicht* (sie sind
untereinander korrekt geordnet, nur in der Zukunft), und es fängt auch nicht
den Fall oben ab; es fängt die *nächste* Handänderung, den schiefen Merge und
die verstellte Uhr. Wer wegen genau dieser Fehlerklasse sucht, findet dort
einen benannten Ort.

Zwei Dinge bleiben offen und gehören vor den nächsten Einsatz geprüft:

- **Ob die echte Produktionsdatenbank `0006` überhaupt eingetragen hat.** Unter
  dem alten Journal (0006 zeitlich *vor* 0005) wäre sie es nicht — dann fehlen
  dort die Einkaufszettel-Tabellen, obwohl die Migration erfolgreich meldete.
- **Kein Test wendet Migrationen auf eine bereits migrierte Datenbank an.** Der
  fehlerhafte Vergleichszweig wird nirgends betreten. Der Nachbau im Review von
  Task 6 hat unter einer Minute gekostet und wäre die naheliegende Vorlage.

### Erledigt

- **Task 3:** Ein blinder Test (`faengtFehler(...)` ohne Auswertung des
  Rückgabewerts) hätte auch dann bestanden, wenn die Datenbank-Bedingung gegen
  `stueckzahl = 0` nicht mehr ausgelöst hätte. Aus dem Brief geerbt, behoben.
- **Task 4:** Die Stückzahl-Multiplikation war auf der Seite „Bester
  Einzelmarkt" ohne jede Regressionsabdeckung — richtig, aber nur per
  Augenschein. Zusicherung auf `guenstigsterEinzelmarkt.summe` ergänzt.
- **Task 5:** Der Abweisungstest mit `zettelItemId` scheiterte an der
  Validierung, *bevor* die Transaktion überhaupt begann, und bewies damit vom
  Rückbau nichts. Ersetzt durch eine echte Fehlerinjektion mitten in der
  Transaktion (temporäre Prüfbedingung, wie in `tests/erfassen-aktionen.test.ts`
  etabliert), die per erneutem Lesen belegt, dass der Haken ausbleibt.
- **Task 6:** Der Zeitstempel von `0006` lag *vor* dem von `0005` — die
  Migration wäre auf jeder bereits migrierten Datenbank nie angewendet worden.
  Behoben, Hintergrund siehe oben.
- **Task 7:** Der Regressionstest für die `aria-labelledby`-Korrektur fing gar
  keine Regression: `dom-accessibility-api` (das Testing Library benutzt) weicht
  an genau dieser Stelle bewusst von der Spezifikation ab, weshalb die kaputte
  und die reparierte Fassung denselben berechneten Namen ergaben — grün in
  beiden Fällen, auch in Playwrights ARIA-Abbild, unterschiedlich nur im echten
  Chromium. Ersetzt durch eine Zusicherung auf die Verdrahtung selbst.
- **Task 7:** Artikel sprangen nach jedem `+`/`−` und jedem Entfernen ans
  Listenende, weil `ladeArtikel` kein `ORDER BY` hatte und ein `UPDATE` die
  Zeile im Heap verschiebt. Für jeden früheren Test unsichtbar, weil dort nie
  eine bereits gezeichnete Liste aktualisiert wurde. Mit
  `orderBy(asc(shoppingListItem.id))` stabilisiert — eine feste, wenn auch
  willkürliche Reihenfolge; die *richtige* Einfügereihenfolge bräuchte eine
  `erstellt_am`-Spalte und damit eine Migration, was wegen der Falle oben
  gerade der falsche Zeitpunkt war.
- **Task 8:** Zwei Fehler, die sich ausschließlich im Browser zeigten — nicht
  abgehakte Artikel sahen abgehakt aus (ein Klassengruppen-Konflikt in
  `tailwind-merge` verschluckte eine Überschreibung stillschweigend), und React
  setzte bei einem Fehler im Formular eines Freitext-Artikels *alle* Textfelder
  zurück, nicht nur den Preis.

### Warten

- **Toter Import:** `import type { ReactNode }` in `optimierer-anzeige.tsx` wird
  nicht verwendet.
- **Ein Kommentar in `zettel-detail.tsx`/`abhak-formular.tsx` verspricht zu
  viel.** Er liest sich, als würde das Abhaken eines Freitext-Artikels diesen in
  einen katalogverknüpften Eintrag verwandeln. Das tut es nicht: Gesetzt wird
  allein `abgehaktAm`, der Zettel-Eintrag bleibt ein Freitext-Eintrag, die
  XOR-Bedingung bleibt unangetastet. Ein Produkt entsteht dabei sehr wohl — nur
  eben im Katalog, nicht im Zettel.
- **Eine Liste aus lauter Freitext-Artikeln zeigt dauerhaft „noch keine Preise
  erfasst"**, auch nachdem Artikel abgehakt und Preise gespeichert wurden.
  Dieser Zweig hängt an `aufteilung.length === 0`, und Freitext-Artikel gehen
  bauartbedingt in keine der beiden Rechnungen ein. Sachlich stimmt die Aussage
  über den Optimierer, für die Person davor liest sie sich wie ein Fehler.
- **Die Abhak-Schaltfläche trägt `aria-expanded`, aber kein `aria-controls`** auf
  das Formular, das sie aufklappt. Geringe praktische Wirkung, das Formular hat
  eine eigene `aria-label`.
- **Der Weg durch `erfasse` selbst ist nie im Browser gelaufen.** Task 9 hat die
  Kette von echtem Postgres über `berechneOptimierung` bis in die
  `OptimiererAnzeige` erstmals an echten Daten belegt (siehe
  `docs/bilder/README.md`, Abschnitt zu Task 9) — die Verifikationspunkte 2, 3
  und 6 gelten damit als gezeigt, samt Stückzahl-Multiplikation. Was dabei
  **nicht** durchlaufen wurde, ist das Abhak-Formular: `erfasse` beginnt mit
  `requireUser()`, und eine echte Sitzung ist in dieser Umgebung nicht
  herstellbar. Das Abhaken samt Preis wurde deshalb auf der Datenebene über
  dieselben Bibliotheksaufrufe ausgelöst, die `erfasse` in seiner Transaktion
  macht. Unbelegt bleiben damit `erfasse`s Eingabezerlegung im Browser und die
  Wirkung von `revalidatePath` in `erfassePreisAktion` — beides ist durch
  Einzeltests gegen echtes Postgres abgedeckt und in Task 8 gegen Attrappen
  gesehen, aber nicht durch die echte Aktion im echten Bündel.
- **Warum kein Passkey-Weg zu einer echten Sitzung führt** — nachgeprüft, damit
  es niemand ein zweites Mal versucht: `passkey()` wird in `src/lib/auth.ts`
  ohne `registration.requireSession: false` eingesetzt, und
  `/passkey/generate-register-options` liegt deshalb hinter
  `freshSessionMiddleware`. Einen Passkey kann also nur anlegen, wer bereits
  angemeldet ist; der einzige Weg zur ersten Sitzung bleibt Google-OAuth. Ein
  virtueller WebAuthn-Authenticator hilft dagegen nicht — die Sperre liegt vor
  dem Authenticator, nicht in ihm.
- **Die Aufnahmen der Tasks 7 und 8 entstanden gegen provisorische, nicht
  angemeldete Routen** und zeigen deshalb keine Navigationsleiste — dieselbe
  Einschränkung wie bei den Scan-Aufnahmen aus Plan 3. Sie belegen Gestalt und
  Zustände, nicht den angemeldeten Betrieb. Die sechs in Task 9 gezogenen
  Aufnahmen zeigen die Leiste mitsamt dem neuen Ziel.
- **Die zehn Aufnahmen aus Task 8 sind in `docs/bilder/README.md` nirgends
  beschrieben** (`zettel-abhaken-handy-*`, `zettel-optimierer-handy-*`,
  `zettel-optimierer-desktop`). Die Dateien liegen da, die Tabelle zu ihnen
  fehlt — als einzige Gruppe im ganzen Verzeichnis. In Task 9 bewusst nicht
  nachgetragen: Eine Beschreibung, die niemand gegen das Bild geprüft hat, wäre
  schlechter als keine.
- **Der Eintrag „Die Wortmarke ist am Handy der einzige Weg zurück" aus Plan 3
  spricht von drei Zielen.** Seit Task 9 sind es vier (Erfassen, Produkte,
  Zettel, für die betreibende Person zusätzlich Zugriff). Die Aussage über die
  Wortmarke gilt unverändert, die Zahl daneben nicht mehr.
- **Die Startseite hat weiterhin kein aktives Ziel in der Leiste** — der Eintrag
  aus Plan 2 gilt unverändert, mit einem Ziel mehr daneben.

### Bewusste Entscheidungen, keine Mängel

- **Kein Offline-Modus.** Die ursprüngliche Design-Spec wollte den Zettel
  offline-fähig (IndexedDB, Sync bei Reconnect). Phase 1 hat aber entschieden,
  dass der Service Worker keinerlei angemeldete Inhalte zwischenspeichert; der
  Zettel verhält sich deshalb wie `/erfassen` und `/produkte`. Konsistenz mit
  einer bestehenden Sicherheitsentscheidung wiegt schwerer als die im Supermarkt
  manchmal schwache Verbindung.
- **Keine gebündelte Preisabfrage im Optimierer.** `holePreisMatrix` kostet rund
  sechzehn Abfragen je Produkt, und die eigene Dokumentation warnt davor, sie je
  Zeile einer Liste aufzurufen — genau das tut der Optimierer, einmal je
  katalogverknüpftem Artikel. Bei einem Haushalt, ohne Nebenläufigkeit, mit
  typischerweise unter dreißig Positionen ist das eine Frage von Millisekunden.
  Im Code als bewusste Entscheidung vermerkt, nicht stillschweigend wiederholt.
- **Keine Katalog-Vorschläge beim Eintippen eines Freitext-Artikels.** Freitext
  bleibt reiner Merkposten. Eine Ähnlichkeitssuche beim Tippen wäre Bauaufwand
  für einen Fall, der beim Abhaken ohnehin sauber aufgelöst wird — dort entsteht
  bei Bedarf ganz regulär ein neues Produkt.
- **Kein Besitzmodell je Nutzer, auch nicht für Listen.** Ein automatisches
  Sicherheits-Review hat bei `hakeItemAb(tx, zettelItemId)` eine fehlende
  Besitzprüfung gemeldet; dieselbe Beobachtung trifft auf alle Listen- und
  Artikel-Aktionen zu. Bewertet und verworfen: Diese App hat *nirgends* ein
  Mandanten- oder Besitzkonzept — ein Haushalt, alle angemeldeten Personen sehen
  alles, gesichert allein durch die Freigabeliste in `requireUser()`. Eine
  Prüfung nur an dieser Stelle täuschte ein Modell vor, das es sonst nicht gibt.
- **Kein Löschen von Produkten aus dem Katalog.** Existiert heute nicht; das
  Schema sieht per `on delete set null` dennoch vor, dass ein Zettel-Eintrag es
  überstünde. Reine Vorsorge. Den ursprünglichen Namen dabei in `freitext`
  nachzutragen ist bewusst nicht Teil dieses Plans — es gibt keine Löschstelle,
  an die sich das hängen ließe.
- **Billa/Spar-Anbindung und Beleg-Erkennung** sind eigene, spätere Pläne. Der
  Optimierer liest ausschließlich, was in Plan 2 und 3 bereits erfasst wurde.

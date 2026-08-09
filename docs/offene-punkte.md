# Offene Punkte

Bewusst aufgeschobene Kleinigkeiten aus abgeschlossenen Phasen. Nichts hier blockiert etwas — jeder Eintrag wurde in einem Review gefunden, bewertet und mit Begründung zurückgestellt. Diese Datei existiert, damit aus „aufgeschoben" nicht „vergessen" wird.

## Aus Phase 1 (Fundament & Auth, PR #1)

### Erledigt

- **Entzug verglich die Einladung buchstabengenau.** Behoben in Plan 2, Task 9: `entzieheZugang` vergleicht jetzt über `lower(invite.email)`, wie es `holeZugaenge` und die Sitzungssuche schon taten. Ein Test in `tests/einladung.test.ts` fügt eine gemischt geschriebene Zeile per rohem SQL ein und hält den Fall fest.

### Warten

- **`bunx eslint .` ist projektweit kaputt** — `typescript-eslint` unterstützt TypeScript 7 noch nicht. Blockiert auf eine Veröffentlichung stromaufwärts; `next build` lintet in Next 16 ohnehin nicht mehr. Wieder aufgreifen, wenn Unterstützung erscheint.
- **`aktionen.ts` beschreibt `entzieheZugang` als zweistufig**, es sind inzwischen drei Schritte. Reiner Prosa-Verzug, die Fehlermeldung selbst stimmt weiterhin.
- **`entzieheZugang` hängt jetzt hart an der `invite`-Tabelle.** Fehlt sie, wird ein erfolgreicher Entzug als Fehler gemeldet. In der Produktion unkritisch, weil die Migration sie anlegt.
- **Drei Testdateien ersetzen `@/db` global** durch je eine eigene Wegwerf-Datenbank: `tests/erfassen-aktionen`, `tests/verwaltung-aktionen`, `tests/sitzung` (Plan 2, Task 7 kam als dritte dazu). Die Attrappen selbst sind unbedenklich — `src/db/index.ts` exportiert nur `db`, es kann also keiner späteren Datei ein Export fehlen. Was jede Registrierung aber sehr wohl tut: Sie hebt für den ganzen restlichen Lauf den Riegel auf, den das Modul unter `NODE_ENV === "test"` auf `pool.query` und `pool.connect` legt. Eine spätere Testdatei, die `@/db` nicht selbst ersetzt und darüber abfragt, bekommt deshalb nicht mehr die Ansage „ersetze das Modul", sondern stillschweigend die längst gestoppte Wegwerf-Datenbank der ersten Datei — und damit einen Verbindungsfehler, der nichts über die Ursache sagt. Heute fragt keine solche Datei ab.
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

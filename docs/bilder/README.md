# Bildnachweise

Aufnahmen der Oberfläche aus der Browserprüfung. Sie liegen hier und nicht unter
`.superpowers/`, weil dieses Verzeichnis in `.gitignore` steht — ein
Bildnachweis, den ein frischer Klon nicht sieht, ist keiner.

Erzeugt mit Chrome bei doppelter Pixeldichte. Vor jeder Neuaufnahme wird das
Verzeichnis geleert, damit kein veraltetes Bild stehen bleibt.

## Anmeldung (Task 7)

| Datei | Was zu sehen ist |
|---|---|
| `anmelden-desktop.png` | Anmeldeseite, Desktopbreite |
| `anmelden-handy.png` | Anmeldeseite, Handybreite |
| `anmelden-abweisung.png` | Abweisung nach dem Google-Rückweg, Sand-Ton |
| `anmelden-fokus.png` | Sichtbarer Fokusring |
| `anmelden-laden.png` | Laufende Anmeldung, beide Wege gesperrt |

## Zugriffsverwaltung und Einladung (Task 8 — die vier `zugriff-*` neu gezogen in Task 9)

| Datei | Was zu sehen ist |
|---|---|
| `zugriff-desktop.png` | Verwaltung als betreibende Person, eine Rückfrage offen. Die eigene Zeile trägt „Betreiber" und „Das bist du" statt einer Schaltfläche. |
| `zugriff-handy.png` | Dasselbe bei 390×844, gestapelt, ohne Querlauf |
| `zugriff-ohne-rolle.png` | Angemeldet, freigeschaltet, aber ohne Betreiber-Rolle |
| `zugriff-ohne-betreiber.png` | Installation, in der niemand als betreibend eingetragen ist |
| `einladung-handy.png` | Einladungsseite mit frischem Token, ausgeloggt |

## Einstieg und Navigation (Plan 2, Task 9)

Seit Task 9 trägt jede angemeldete Seite die Navigationsleiste — am Handy unten,
ab `sm` oben. **Alle Aufnahmen der angemeldeten Seiten wurden deshalb in Task 9
neu gezogen**, auch die aus Task 7 und 8; die alten zeigten die Bildschirme ohne
Leiste. Unberührt blieben nur die Aufnahmen ohne Sitzung (Anmeldung, Einladung,
PWA) — dort gibt es keine Leiste, weil es nichts zu navigieren gibt.

| Datei | Was zu sehen ist |
|---|---|
| `start-handy.png` | Die Startseite bei 390×844: Wortmarke, Begrüßung, der Weg zum Erfassen, darunter die zuletzt erfassten Preise mit „heute"/„gestern" statt eines Datums. Kein Ziel der Leiste ist aktiv — die Startseite ist keiner der drei Bereiche. |
| `start-handy-leer.png` | Die Startseite ohne einen einzigen erfassten Preis. Der leere Zustand sagt, was hier künftig steht; die Zählung neben der Überschrift fehlt, statt „0" zu behaupten. Aufgenommen in einer Sitzung **ohne** Betreiber-Rolle, die Leiste trägt deshalb zwei Ziele statt der drei aus `start-handy.png` — das ist der Rollenunterschied, nicht ein Mangel des leeren Zustands. |
| `start-desktop.png` | Die Startseite bei 1280×900. Die Leiste sitzt oben, die Wortmarke fluchtet mit der Überschrift darunter. |
| `navigation-handy-ohne-betreiber.png` | Dieselbe Startseite für eine Person **ohne** Betreiber-Rolle: nur zwei Ziele. „Zugriff" ist nicht ausgeblendet, sondern steht gar nicht im ausgelieferten HTML — nachgemessen. Die Liste darunter stammt aus einem Durchgang **vor** der Kennzeichnung der Aktionen und zeigt sie deshalb noch ohne den Zusatz; belegt ist hier die Leiste, nicht der Listeninhalt. |

Der aktive Bereich ist an **vier** Dingen zu erkennen, von denen nur eines die
Farbe ist: dem Balken an der Kante zum Inhalt (am Handy oben, am Desktop unten),
dem gefüllten statt umrissenen Symbol, der kräftigeren Schrift und
`aria-current="page"`. Am deutlichsten zu sehen in `erfassen-handy-leer.png`
(Handy) und `erfassen-desktop.png` (Desktop).

## Preiserfassung (Plan 2, Task 7 — neu gezogen in Task 9)

Aufgenommen gegen den Produktionsbau (`bun run build && bun run start`), nicht
gegen den Entwicklungsserver: Nur dort gilt die CSP ohne `'unsafe-eval'`. Die
Browserkonsole war bei allen Aufnahmen leer.

| Datei | Was zu sehen ist |
|---|---|
| `erfassen-handy-leer.png` | Leeres Formular bei 390×844. Die Grundpreis-Fläche sagt, was dort erscheinen wird; alle Platzhalter beginnen mit „z. B." und sind dadurch nicht mit Eingaben zu verwechseln. |
| `erfassen-handy-fokus.png` | Sichtbarer Fokusring auf dem ersten Kettenfeld — dem ersten Ziel **innerhalb** des Formulars. Davor liegen Wortmarke und die Ziele der Navigationsleiste, die seit Task 9 im Quelltext vor dem Inhalt stehen (`src/app/layout.tsx`); es braucht dorthin also mehrere Tabulatoren, nicht einen. Das Optionsfeld selbst liegt unsichtbar darunter, der Ring sitzt trotzdem am sichtbaren Feld. |
| `erfassen-handy-live.png` | Menge und Preis eingetragen, Grundpreis (9,96 €/kg) **vor** dem Speichern berechnet. Die gewählte Kette bleibt auch unter dem Zeiger lesbar. |
| `erfassen-handy-gespeichert.png` | Nach dem Speichern: die Produktfelder sind leer, die Grundpreis-Fläche wechselt in die Bestätigung („Butter bei Spar gespeichert", 9,96 €/kg), die Preisart steht wieder auf „Normal". Der Satz zur bleibenden Kette steht nur beim ersten Mal. Der Ausschnitt beginnt unterhalb der Ketten-Reihe und endet über der Liste — dass die Kette gewählt bleibt und darunter „Erfasst 1" steht, zeigt `erfassen-handy-mehrere.png`. |
| `erfassen-handy-aktion.png` | Preisart „Aktion" gewählt, dadurch erscheint „Gültig bis". |
| `erfassen-handy-mehrere.png` | Zweiter Preis desselben Einkaufs. Liste mit zwei Zeilen, das Jüngste zuoberst, die Aktion als solche gekennzeichnet. Preisart steht wieder auf „Normal". |
| `erfassen-handy-abgewiesen.png` | Vom Server abgewiesene Mengenangabe: Meldung über der Schaltfläche, Beanstandung am Feld, alle Eingaben und die gewählte Kette bleiben stehen. |
| `erfassen-desktop.png` | Dasselbe Formular bei 1280 px — fünf Ketten und vier Preisarten je in einer Reihe. |

## Produktsuche und Produktdetail (Plan 2, Task 8 — neu gezogen in Task 9)

Aufgenommen gegen den Produktionsbau (`bun run build && bun run start`) bei
doppelter Pixeldichte. Die Browserkonsole war bei allen Aufnahmen leer — keine
Verstöße gegen die Sicherheitsrichtlinie.

| Datei | Was zu sehen ist |
|---|---|
| `produkte-handy-leer.png` | Suche ohne Eingabe bei 390×844. Der leere Zustand sagt, was hier künftig steht und woher es kommt — er sagt nicht „keine Treffer". |
| `produkte-handy-tippfehler.png` | „Buter" findet „Butter". Der Grund für die Trigramm-Suche: Vor dem Regal wird einhändig getippt. |
| `produkte-handy-ohne-treffer.png` | Erfolglose Suche. Sand statt Rot, mit drei Wegen weiter — darunter der Link in die Erfassung. Keine Sackgasse. |
| `produktdetail-handy-ruhig.png` | Die ruhige Ebene: Kette, Preis, Ersparnis, Gültig-bis — die Antwort auf „Ist das gerade billig?" passt auf einen Handybildschirm. Die Tabelle liegt zugeklappt darunter. |
| `produktdetail-handy-tabelle.png` | Dieselbe Seite mit aufgeklappter Tabelle. Alle vier Zustände nebeneinander: Billa veraltet (170 Tage, Sand-Marke), Spar frisch mit drei Preisen, Hofer mit „Aktion bis 15.08.", Lidl „keine Daten" statt einer Null. |
| `produktdetail-handy-ohne-preis.png` | Produkt im Katalog, aber ohne jeden Preis. Die Tabelle bleibt stehen und zeigt, was hier ausgefüllt wird. |
| `produktdetail-handy-selber-sieger.png` | Heute-Sieger und Referenz-Sieger sind dieselbe Kette — dann steht das als eigener Satz da, statt zweimal derselbe Name. Keine Aktion, deshalb keine Gültig-bis-Zeile. |
| `produkte-desktop.png` | Suche bei 1280 px. Feld und Schaltfläche in einer Reihe, darunter die Trefferzahl und der eine Treffer, den die Entwicklungsdaten hergaben. Die Sortierung nach Ähnlichkeit — „Butter" vor „Buttermilch" — belegt dieses Bild **nicht**; sie steht in `tests/katalog-suche.test.ts` („sortiert den ähnlicheren Treffer nach vorn"), wo beide Produkte angelegt und die Reihenfolge festgenagelt wird. |
| `produktdetail-desktop.png` | Detailseite bei 1280 px, Tabelle offen. Die Marke „veraltet" steht hier in derselben Zeile wie Zahl und Datenalter. |

## PWA-Grundgerüst (Task 9)

| Datei | Was zu sehen ist |
|---|---|
| `pwa-installationsdialog.png` | Der native Chrome-Dialog „App installieren" für KassaTrack |
| `pwa-installiert.png` | Die installierte App im eigenen Fenster, ohne Adressleiste, auf der Anmeldeseite |

Diese beiden Aufnahmen stammen aus einer früheren Sitzung, deren Bericht
verloren ging (siehe `task-9-report.md`). Bei der Nachprüfung ließ sich nur
`pwa-installiert.png` gegenprüfen: sein Seiteninhalt (Text, Farben, Layout der
Anmeldeseite) stimmt mit einem frisch gezogenen Screenshot des aktuellen Codes
überein. `pwa-installationsdialog.png` zeigt den nativen Chrome-Dialog, der
die Seite verdeckt — er hat keinen Seiteninhalt, gegen den sich prüfen ließe.
Belegt ist dort nur, dass App-Name und Kachelfarbe im Bild zum aktuellen
Manifest passen; der Dialog selbst ließ sich in der Nachprüfung nicht neu
auslösen, weil die automatisierte Browsersitzung `beforeinstallprompt` nicht
feuerte und kein Werkzeug für native Fenster-Aufnahmen zur Verfügung stand.
Näheres dazu im Bericht.

## Strichcode-Scan im Erfassungsformular (Plan 3, Task 8)

**Herkunft dieser neun Aufnahmen — bitte vor dem Weiterverwenden lesen.** Sie
entstanden gegen den Produktionsbau (`bun run build && bun run start`), aber
**nicht** gegen `/erfassen` selbst: Diese Seite verlangt eine angemeldete
Sitzung, und die ließ sich in diesem Durchgang nicht herstellen, ohne in der
Datenbank an Benutzer- und Sitzungstabellen zu schreiben. Stattdessen lief eine
vorübergehende Route, die `ErfassungsFormular` mit denselben Tokens, derselben
CSP und demselben Bau, aber mit erfundenen Daten zeichnete; sie ist gelöscht
und liegt in keinem Commit.

Zwei Folgen davon stehen in den Bildern:

1. **Die Navigationsleiste fehlt** — die Prüfroute lag außerhalb des
   angemeldeten Bereichs. Am echten `/erfassen` sitzt sie am Handy unten und
   ab `sm` oben; alles darüber verschiebt sich entsprechend.
2. **Kamera und Decoder sind nachgebildet.** Windows-Chrome kennt keinen
   `BarcodeDetector`, und ein Gerät zum Scannen stand nicht zur Verfügung. Das
   Kamerabild ist eine gezeichnete Fläche, der Strichcode darauf wird nicht
   wirklich gelesen. Belegt sind damit Aufbau, Ablauf und Zustände der
   Oberfläche — **nicht**, dass ein echter EAN-13 auf einem Android-Gerät
   erkannt wird. Das steht noch aus.

Ebenfalls offen: `erfassen-handy-leer.png`, `erfassen-handy-fokus.png` und
`erfassen-desktop.png` zeigen das Formular **ohne** die Scan-Schaltfläche und
sind seit diesem Task veraltet. Sie bleiben vorerst stehen, weil eine
Neuaufnahme dieselbe Sitzung braucht wie oben.

| Datei | Was zu sehen ist |
|---|---|
| `erfassen-handy-scan-bereit.png` | Leeres Formular bei 390×844. Die Scan-Schaltfläche steht über „Produkt" — über den drei Feldern, die sie füllt, und unter der Kette, die man einmal je Einkauf wählt. |
| `erfassen-handy-scan-kamera.png` | Laufende Kamera mit Zielrahmen, Statuszeile und Abbruch darunter. Der Abbruch liegt unter der Vorschau, damit die Hand nicht verdeckt, was man anvisiert. |
| `erfassen-handy-scan-vorschlag.png` | Der Vorschlag aus Open Food Facts mit zwei ähnlichen Produkten aus dem eigenen Katalog. Die bestehenden Produkte stehen **oben** und tragen ihre Gebindegröße, „Neues Produkt anlegen" darunter und in der zurückhaltenden Variante — sonst wäre die Neuanlage der bequemste Weg und der Katalog führte bald drei Sorten Butter. |
| `erfassen-handy-scan-vorschlag-ohne-treffer.png` | Derselbe Vorschlag ohne Treffer im Katalog. Erst hier wird „Neues Produkt anlegen" zur betonten Wahl — es ist dann der einzige Weg. |
| `erfassen-handy-scan-vorschlag-fokus.png` | Sichtbarer Fokusring auf der ersten Produktzeile. Ihr zugänglicher Name lautet „Ist dasselbe wie Butter 250 g Kärntnermilch"; sichtbar steht der Satz nur einmal über der Liste, statt auf jeder Zeile. |
| `erfassen-handy-scan-uebernommen.png` | Nach der Zuordnung: Produkt, Marke und Menge stehen in den Feldern, darüber steht in einem Satz, woher sie kommen. Die Menge steht als „250 g" da — so, wie `zerlegeMenge` sie wieder liest. |
| `erfassen-handy-scan-unbekannt.png` | Strichcode gelesen, aber weder KassaTrack noch Open Food Facts kennen ihn. Sand statt Rot, und die Felder bleiben unangetastet: Hier hat niemand etwas falsch gemacht. |
| `erfassen-handy-scan-fehlgeschlagen.png` | Das Nachschlagen selbst ist gescheitert (Netz). Derselbe Ton, aber mit dem zweiten Weg dazu: noch einmal scannen. |
| `erfassen-desktop-scan-vorschlag.png` | Der Vorschlag bei 1280×900. Dieselbe Anordnung, nur breiter — die Zeilen bleiben linksbündig und über die volle Breite antippbar. |

Die Browserkonsole war über den ganzen Durchgang leer: keine
CSP-Verstöße, keine Hydrierungswarnungen, keine Fehler.

## Einkaufszettel — Übersicht (Plan 4, Task 6)

Gegen den Produktionsbau (`bun run build && bun run start`) bei 390×844 und
1280×900, angemeldet über eine von Hand angelegte Sitzung. Die Browserkonsole
war bei allen vier Aufnahmen und über alle Interaktionen hinweg leer: keine
CSP-Verstöße, keine Hydrierungswarnungen, keine Fehler.

| Datei | Was zu sehen ist |
|---|---|
| `zettel-handy-leer.png` | Noch kein Zettel angelegt. Der leere Zustand sagt in Sand, was hier künftig steht und wie es dorthin kommt — kein „nichts da". |
| `zettel-handy-liste.png` | Zwei Zettel, das Jüngste zuoberst. Jede Zeile ist über ihre ganze Breite antippbar; „Löschen" steht als zurückhaltende Nebenschaltfläche daneben, nicht in Rot. |
| `zettel-handy-rueckfrage.png` | Die Rückfrage vor dem Löschen, an Ort und Stelle statt in einem Dialog. Erst dieser zweite Schritt ist rot, und der Satz darüber sagt, dass alles auf dem Zettel mitgeht und nichts zurückzuholen ist. |
| `zettel-handy-abgewiesen.png` | Anlegen ohne Namen: Meldung unter dem Feld, roter Feldrand, Eingabe bleibt stehen. |
| `zettel-desktop.png` | 1280×900. Feld und Schaltfläche stehen nebeneinander und fluchten an der Oberkante; im Bild trägt „Löschen" den Fokusring, weil die Rückfrage gerade mit Escape abgebrochen wurde und der Fokus an ihren Auslöser zurückgesprungen ist. |

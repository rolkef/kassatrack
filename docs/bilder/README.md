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

## Zugriffsverwaltung und Einladung (Task 8)

| Datei | Was zu sehen ist |
|---|---|
| `zugriff-desktop.png` | Verwaltung als betreibende Person, eine Rückfrage offen. Die eigene Zeile trägt „Betreiber" und „Das bist du" statt einer Schaltfläche. |
| `zugriff-handy.png` | Dasselbe bei 390×844, gestapelt, ohne Querlauf |
| `zugriff-ohne-rolle.png` | Angemeldet, freigeschaltet, aber ohne Betreiber-Rolle |
| `zugriff-ohne-betreiber.png` | Installation, in der niemand als betreibend eingetragen ist |
| `einladung-handy.png` | Einladungsseite mit frischem Token, ausgeloggt |

## Preiserfassung (Plan 2, Task 7)

Aufgenommen gegen den Produktionsbau (`bun run build && bun run start`), nicht
gegen den Entwicklungsserver: Nur dort gilt die CSP ohne `'unsafe-eval'`. Die
Browserkonsole war bei allen Aufnahmen leer.

| Datei | Was zu sehen ist |
|---|---|
| `erfassen-handy-leer.png` | Leeres Formular bei 390×844. Die Grundpreis-Fläche sagt, was dort erscheinen wird; alle Platzhalter beginnen mit „z. B." und sind dadurch nicht mit Eingaben zu verwechseln. |
| `erfassen-handy-fokus.png` | Nach einmal Tabulator: sichtbarer Fokusring auf dem Kettenfeld. Das Optionsfeld selbst liegt unsichtbar darunter, der Ring sitzt trotzdem am sichtbaren Feld. |
| `erfassen-handy-live.png` | Menge und Preis eingetragen, Grundpreis (9,96 €/kg) **vor** dem Speichern berechnet. Die gewählte Kette bleibt auch unter dem Zeiger lesbar. |
| `erfassen-handy-gespeichert.png` | Nach dem Speichern: Kette bleibt gewählt, Produktfelder leer, die Fläche wechselt in die Bestätigung. Darunter die Liste „Erfasst 1". Der Satz zur bleibenden Kette steht nur beim ersten Mal. |
| `erfassen-handy-aktion.png` | Preisart „Aktion" gewählt, dadurch erscheint „Gültig bis". |
| `erfassen-handy-mehrere.png` | Zweiter Preis desselben Einkaufs. Liste mit zwei Zeilen, das Jüngste zuoberst, die Aktion als solche gekennzeichnet. Preisart steht wieder auf „Normal". |
| `erfassen-handy-abgewiesen.png` | Vom Server abgewiesene Mengenangabe: Meldung über der Schaltfläche, Beanstandung am Feld, alle Eingaben und die gewählte Kette bleiben stehen. |
| `erfassen-desktop.png` | Dasselbe Formular bei 1280 px — fünf Ketten und vier Preisarten je in einer Reihe. |

## Produktsuche und Produktdetail (Plan 2, Task 8)

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
| `produkte-desktop.png` | Suche bei 1280 px. Feld und Schaltfläche in einer Reihe, „Butter" vor „Buttermilch" — die Sortierung nach Ähnlichkeit. |
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

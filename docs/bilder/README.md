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

## PWA-Grundgerüst (Task 9)

| Datei | Was zu sehen ist |
|---|---|
| `pwa-installationsdialog.png` | Der native Chrome-Dialog „App installieren" für KassaTrack |
| `pwa-installiert.png` | Die installierte App im eigenen Fenster, ohne Adressleiste, auf der Anmeldeseite |

Diese beiden Aufnahmen stammen aus einer früheren Sitzung, deren Bericht verloren
ging (siehe `task-9-report.md`). Bei der Nachprüfung deckte sich der Seiteninhalt
beider Bilder deckungsgleich mit dem, was der aktuelle Code liefert — der native
Installationsdialog selbst ließ sich in der Nachprüfung nicht neu erzeugen, weil
die automatisierte Browsersitzung `beforeinstallprompt` nicht auslöste und kein
Werkzeug für native Fenster-Aufnahmen zur Verfügung stand. Näheres dazu im
Bericht.

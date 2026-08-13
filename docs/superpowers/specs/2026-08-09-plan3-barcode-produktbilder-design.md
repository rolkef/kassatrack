# Plan 3 — Barcode-Scan & Produktbilder — Design

## Kontext

Plan 2 hat den Katalog und die Preis-Engine gebaut; jedes Produkt entsteht
dort ausschließlich über die manuelle Erfassung — Name, Marke und Menge
werden für jedes neue Produkt von Hand eingetippt. Das Schema trägt bereits
zwei ungenutzte Vorleistungen dafür: `product_ean` (Strichcode → Produkt,
leer seit Plan 2, Task 3) und `product.bild_schluessel` (der Pfad zu einem
Produktbild, ebenfalls leer).

Aus dem ursprünglichen Phasenplan sind nach Plan 2 noch drei größere,
unabhängige Stücke offen: Barcode-Scan + Produktbilder, ein
Einkaufszettel-Optimierer, und eine Billa/Spar-Online-Anbindung. Plan 3
nimmt das erste — es baut direkt auf dem bestehenden Katalog auf, braucht
keinen externen API-Vertrag mit Fristen, und macht die Erfassung im
Geschäft spürbar schneller.

**Zielbild:** Strichcode scannen → Open Food Facts liefert Name, Marke,
Menge und Bild, falls bekannt → das Formular aus `/erfassen` ist
vorausgefüllt → Kette, Preis und Preisart tippt man wie bisher.

## Umfang

**Drin:**
- Barcode-Scan als zusätzlicher Einstieg in `/erfassen`, kein neuer
  Bildschirm
- Auflösung einer gescannten EAN gegen `product_ean`, sonst gegen Open
  Food Facts, sonst gegen einen Fuzzy-Vorschlag auf bestehende Produkte
- Produktbilder: serverseitig von Open Food Facts geladen, in einem
  Docker-Volume zwischengespeichert, über eine eigene Route ausgeliefert
- Zielumfeld: Android + Chrome (native `BarcodeDetector`-API)

**Bewusst nicht drin (Entscheidungen aus dem Brainstorming, mit
Begründung):**
- **Kein iOS-Safari-Fallback (`zxing-wasm`).** Gescannt wird auf
  Android/Chrome; ein Fallback für ein Gerät, das niemand benutzt, wäre
  Vorrat für einen Bedarf, der nicht besteht. Die Scan-Komponente bekommt
  ihren Decoder trotzdem als austauschbares Prop (siehe Testen) — ein
  späterer Fallback ist ein neuer Decoder, kein Umbau.
- **Kein Nachtrage-Weg für Altbestand.** Produkte aus Plan 2 ohne EAN
  bleiben ohne EAN und ohne Bild. Wer sie erneut kauft und scannt, verknüpft
  sie automatisch über den Fuzzy-Vorschlag — das erledigt sich beim
  nächsten Einkauf von selbst, ein eigener Bildschirm dafür wäre
  Mehraufwand für einen Randfall.
- **Kein Bild-Refresh.** Ein einmal geladenes Bild wird nie erneut
  abgefragt. Ändert Open Food Facts sein Bild später, bleibt das alte
  bestehen — dieselbe Klasse von Entscheidung wie die append-only
  Beleghistorie: Einfachheit vor Aktualität, weil Produktbilder sich in
  der Praxis kaum ändern.
- **Einkaufszettel/Optimierer und Billa/Spar-Anbindung** sind eigene,
  spätere Pläne.

## Architektur & Ablauf

```
/erfassen
  │
  ├─ bestehendes Formular (Plan 2, unverändert)
  │
  └─ neu: „Strichcode scannen"
       │  Client-Komponente, BarcodeDetector via injiziertem Decoder
       ▼
     EAN erkannt
       │
       ▼
     Server Action: loeseEanAuf(db, ean)
       │
       ├─ 1. product_ean kennt die EAN
       │     → Produkt geladen, Formular vorausgefüllt, fertig
       │
       ├─ 2. EAN unbekannt → Open-Food-Facts-Abfrage
       │     (Name, Marke, Menge, Bild-URL — falls vorhanden)
       │     │
       │     ├─ 2a. Fuzzy-Vorschlag gegen bestehende Produkte
       │     │      (dieselbe pg_trgm-Maschinerie wie in findeProdukt,
       │     │       Task 7/8) → Person bestätigt „dasselbe wie X"
       │     │       oder „neu anlegen"
       │     │
       │     └─ 2b. EAN wird verknüpft (verknuepfeEan),
       │            Bild wird beim ersten Mal geladen und
       │            zwischengespeichert
       │
       └─ 3. Weder product_ean noch Open Food Facts kennen die EAN
             → wie „neues Produkt", nur ohne Vorbefüllung
```

Der Rest von `/erfassen` (Kette, Preis, Preisart, Grundpreis-Anzeige,
Speichern) ist Plan 2 und bleibt unverändert.

## Datenmodell

Kein neues Schema. Beide benötigten Spalten/Tabellen existieren bereits
(`product_ean`, `product.bild_schluessel`), bisher nur ungenutzt. Neue
Funktionen in `@/lib/katalog`:

- `findeProduktPerEan(db, ean)` — exakter Primärschlüssel-Zugriff auf
  `product_ean`. Eine EAN zeigt auf genau ein Produkt; der
  Schema-Kommentar zu `product_ean` erwähnt mehrere EANs pro Produkt
  (Gebindewechsel), nicht umgekehrt — die Richtung, die hier gebraucht
  wird, ist bereits durch den Primärschlüssel eindeutig.
- `verknuepfeEan(db, produktId, ean)` — schreibt die Zuordnung,
  `onConflictDoNothing`, nach demselben Muster wie die bestehenden
  Schreibfunktionen in `katalog.ts`.
- Der Fuzzy-Vorschlag erweitert `findeProdukt` (oder einen dünnen Wrapper
  darüber) um denselben `similarity()`-Mechanismus, der dort für
  Kettennamen schon läuft — keine zweite Suchlogik.

## Open-Food-Facts-Anbindung

Ein neuer Client (`@/lib/produktbilder` oder vergleichbar) kapselt den
HTTP-Zugriff auf `world.openfoodfacts.org/api/v2/product/{ean}.json`.
Zwei Dinge vor der Implementierung zu verifizieren, nicht anzunehmen (siehe
Verifikation unten): das exakte Feld-Mapping der v2-Antwort, und die
aktuellen Richtlinien zu `User-Agent`/Ratenbegrenzung.

**Bewusste Abweichung vom bisherigen Testmuster:** Dies ist der erste
externe HTTP-Aufruf im Projekt. Statt ihn über `mock.module` global zu
ersetzen — die Fallenklasse, die dieses Projekt zweimal getroffen hat,
zuletzt im Abschlussreview von Plan 2 — bekommt der Client seine
Abruffunktion als Parameter injiziert: Produktionscode reicht `fetch`
durch, Tests reichen eine Fake-Funktion durch. Kein globaler Zustand, keine
Reihenfolge-Abhängigkeit zwischen Testdateien. Dieselbe Idee für die
Scan-Komponente: sie bekommt ihren Decoder als Prop, echte Browser liefern
`BarcodeDetector`, Tests einen Fake-Decoder — `happy-dom` kennt
`BarcodeDetector` ohnehin nicht.

## Bildspeicher

- Bilder werden serverseitig heruntergeladen, nie direkt vom Browser bei
  Open Food Facts angefragt (schneller, ausfallsicher, kein
  Drittanbieter-Request aus dem Browser).
- Ablage in einem Docker-Volume, Pfad über eine Umgebungsvariable
  konfigurierbar (dev und Coolify können unterschiedliche Pfade nutzen).
- Eine eigene Route liest aus dem Volume und liefert mit langem,
  unveränderlichem Cache-Header aus.
- Kein MinIO — für eine Ein-Haushalt-App mit einigen hundert kleinen
  Bildern ist ein zweiter Dienst mit eigenem Backup-Bedarf unverhältnismäßig.
  Falls Plan 4 (Kassabelege) später doch einen Objektspeicher braucht,
  ist das eine eigene Entscheidung zu ihrer Zeit, keine Vorwegnahme hier.

## Fehlerfälle

Keiner davon blockiert das Erfassen — der Weg „ohne Vorbefüllung weiter
wie bisher" ist immer offen:

- EAN bei Open Food Facts unbekannt → wie „neues Produkt", ohne Vorbefüllung.
- Daten vorhanden, aber kein Bild → Produkt entsteht ohne Bild.
- Bild-Download schlägt fehl (Netzwerk, 404) → `bild_schluessel` bleibt
  leer, kein automatischer Wiederholungsversuch. Landet als bekannte Lücke
  in `docs/offene-punkte.md`, kein stiller Fehler.
- Kein `BarcodeDetector` im Browser → Erkennung per Feature-Check
  deaktiviert, Hinweistext statt Absturz, manuelle Eingabe bleibt immer
  möglich.
- Zwei rasche Scans derselben neuen EAN → `verknuepfeEan` über
  `onConflictDoNothing`, wie an den bestehenden Stellen in `katalog.ts`.
- Kamera-Berechtigung verweigert → Hinweistext, manuelles Formular bleibt
  erreichbar.

## Testen

- `findeProduktPerEan` / `verknuepfeEan`: gegen echtes Postgres, wie jede
  andere Funktion in `katalog.ts`.
- Der Open-Food-Facts-Client: Fake-Abruffunktion injiziert, kein
  `mock.module`. Testfälle: Treffer mit vollständigen Feldern, Treffer ohne
  Bild, kein Treffer, Netzwerkfehler.
- Die Server Action `loeseEanAuf`: alle drei Zweige (bekannte EAN, neue EAN
  mit Fuzzy-Treffer, neue EAN ohne jeden Treffer) gegen echtes Postgres,
  mit injiziertem Fake-Client.
- Die Scan-Komponente: Fake-Decoder als Prop, prüft die Verdrahtung
  „erkannter Code → Server Action aufgerufen", nicht die Bilderkennung
  selbst (die liegt im Browser, nicht im Testcode).
- Bild-Route: schreibt eine Testdatei ins (Test-)Volume, prüft Antwort und
  Cache-Header.
- **Nicht durch Tests ersetzbar:** ein echter Scan auf einem echten
  Android-Handy mit Chrome — Browserverifikation mit Screenshots, wie bei
  jeder bisherigen UI-Aufgabe dieses Projekts.

## Verifikation

**Plan 3 gilt als fertig, wenn:**

1. `bun test`, `bunx tsc --noEmit`, `bun run build` fehlerfrei
2. Eine bekannte EAN füllt das Erfassungsformular korrekt vor (Name,
   Marke, Menge, Bild)
3. Eine unbekannte EAN mit Open-Food-Facts-Treffer zeigt den
   Fuzzy-Vorschlag, wenn ein ähnliches Produkt existiert, und legt sonst
   neu an
4. Eine völlig unbekannte EAN fällt sauber auf die unveränderte manuelle
   Eingabe zurück, ohne Fehlermeldung
5. Ein Produktbild wird genau einmal heruntergeladen, danach aus dem
   eigenen Volume ausgeliefert — kein wiederholter Open-Food-Facts-Zugriff
   für dieselbe EAN
6. Ein echter Scan auf einem Android-Handy mit Chrome funktioniert,
   Browser-verifiziert mit Screenshots

## Vor der Implementierung zu klären, nicht anzunehmen

- Exaktes Feld-Mapping der Open-Food-Facts-v2-Antwort (`product.product_name`,
  `product.brands`, `product.quantity`, Bild-URL-Feld) — gegen die aktuelle
  offizielle Dokumentation prüfen, nicht aus Trainingsdaten übernehmen.
- Aktuelle Richtlinien zu `User-Agent` und Ratenbegrenzung der API.
- Aktueller Support-Stand der `BarcodeDetector`-API in Chrome/Android — zum
  Zeitpunkt dieses Designs nicht per Websuche verifizierbar (in dieser
  Umgebung nicht verfügbar), daher Implementierungs-Aufgabe, nicht Annahme
  des Plans.

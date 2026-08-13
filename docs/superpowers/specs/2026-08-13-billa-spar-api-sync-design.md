# Ketten-API-Sync (Billa/Spar und weitere) — Design

## Kontext

Bisher entstehen Preisbeobachtungen ausschließlich manuell (`/erfassen`,
Plan 1) oder durch Barcode-Scan (Plan 3) — jemand muss im Geschäft stehen
und tippen. Referenzpreis und Bestpreis sind nur so gut wie das, was
tatsächlich erfasst wurde, und bei fünf Ketten und einem Haushalt bleibt
das lückenhaft.

**Zielbild:** Ein täglicher, automatischer Preisabgleich, der Billa und
Spar (und jede weitere Kette, die noch aktuelle Daten bietet) ohne
manuellen Einsatz in den Katalog einspeist — als Ergänzung zur manuellen
Erfassung, nicht als Ersatz. Aktionen/Loyalty-Preise bleiben weiterhin
Sache der manuellen Erfassung (siehe Umfang).

## Recherche-Ergebnis (Grundlage dieses Designs)

Weder Billa noch Spar veröffentlichen eine offizielle, dokumentierte API.
Beide Onlineshops (`shop.billa.at`, Spars FactFinder-Suche) haben aber
unauthentifizierte interne JSON-Schnittstellen, die ihre eigene Website
nutzt — dokumentiert im Open-Source-Projekt
[badlogic/heissepreise](https://github.com/badlogic/heissepreise), das sie
seit über zwei Jahren täglich abfragt, ohne dass ein rechtlicher Einwand
bekannt wurde (die österreichische Bundeswettbewerbsbehörde hat 2023 sogar
ein zustimmendes Fokuspapier zu genau dieser Art von Plattform
veröffentlicht).

Statt die beiden Shop-Schnittstellen selbst nachzubauen, konsumiert dieser
Plan den von heissepreise bereits aggregierten, normalisierten
Tagesdatensatz: `https://heisse-preise.io/data/latest-canonical.json`. Ein
Abruf statt zwei brüchiger Scraper, und er deckt neben Billa/Spar auch
Hofer, Lidl und Penny ab — alle fünf Ketten, die heute schon im Katalog
stehen.

**Zwei Lücken der Quelle, die dieses Design mitträgt:**
- **Keine EAN/GTIN** in den Einträgen — Zuordnung zum Katalog kann nicht
  über `product_ean` laufen, nur über Name/Menge/Einheit gegen
  `store_product.rohNamen`.
- **Keine verlässliche Aktions-/Loyalty-Kennzeichnung** — jeder Eintrag
  wird als Normalpreis behandelt (siehe Umfang).

Feed-Struktur (aus dem Repository, nicht selbst nachgemessen — im ersten
Task gegen eine echte Antwort zu verifizieren): flaches Array, je Eintrag
`store` (Kettenkürzel, z. B. `"billa"`), `name`, `price` (aktueller
Regalpreis), `quantity`/`unit` (Gebindegröße), `bio` (Flag),
`priceHistory` (Array aus `{ date: "yyyy-mm-dd", price }`, absteigend
sortiert).

## Umfang

**Drin:**
- Tägliches, eigenständiges Sync-Skript (`scripts/synchronisiere-ketten.ts`),
  gestartet über einen Coolify Scheduled Task
- Nur die fünf bereits im Katalog stehenden Ketten (Billa, Spar, Hofer,
  Lidl, Penny); eine im Feed neu auftauchende Kette (z. B. `dm`) wird
  ignoriert, bis sie bewusst im Katalog ergänzt wird
- Pro-Ketten-Aktualitätsprüfung: eine Kette ohne hinreichend frische
  Einträge im Feed wird diesen Lauf übersprungen und im Protokoll vermerkt
  — kein hartcodiertes „diese Kette ist tot", sondern eine laufende
  Prüfung, die eine künftige Shop-Schließung (wie bei MPreis 2024)
  automatisch abfängt
- Exakte Zuordnung (normalisierter Name + Menge + Einheit) gegen
  `store_product.rohNamen`; kein unscharfes Matching
- Nicht zuordenbare Artikel landen in einer neuen Prüfliste
  (`chain_sync_ungeklaert`) statt automatisch einen neuen Katalogeintrag
  zu erzeugen
- Neue Oberfläche `/verwaltung/ketten-abgleich`: Prüflisten-Einträge einem
  bestehenden Produkt zuordnen (trägt den Rohnamen nach) oder als neues
  Produkt anlegen — beides über die bereits bestehenden Katalog-Funktionen
  (`sichereKettenProdukt`, `legeProduktAn`, `sucheProdukte`)
- Grundpreis-Umrechnung vor jedem Schreiben, exakt wie in `erfasse` — der
  Feed liefert Regalpreise, `price_observation.grundpreis` bekommt nie den
  rohen Wert
- Historischer Erstimport: `priceHistory` wird beim ersten erfolgreichen
  Treffer eines Artikels eingelesen, aber nur an den Tagen mit echter
  Preisänderung als eigene Beobachtung — nicht ein Eintrag pro Tag
- Tägliche Folgeläufe schreiben nur bei tatsächlicher Preisänderung eine
  neue Beobachtung (verglichen mit der letzten `CHAIN_API`-Beobachtung
  desselben Artikels) — idempotent bei mehrfachem Lauf am selben Tag
- Laufprotokoll (verarbeitete Ketten, Treffer, neue Prüflisten-Einträge,
  übersprungene Ketten) auf der Konsole, landet in Coolifys Task-Logs

**Bewusst nicht drin:**
- **Kein unscharfes/Ähnlichkeits-Matching.** Jede aus der Prüfliste
  bestätigte Zuordnung erweitert `rohNamen` — die Liste lernt sich über die
  Zeit selbst leer, ein Rateverfahren wäre eine zusätzliche
  Fehlerquelle ohne echten Nutzen dafür.
- **Keine Aktions-/Loyalty-Preise aus dem Sync.** Der Feed unterscheidet
  Jö-/Kundenkarten-Aktionen nicht zuverlässig von Normalpreisen. Jeder
  synchronisierte Preis ist `Preisart: 'NORMAL'`; in die `offer`-Tabelle
  schreibt weiterhin ausschließlich die manuelle Erfassung. Der Optimierer
  sieht also aus dieser Quelle nie eine „Aktion", nur den Referenzpreis.
- **Keine automatische Anlage neuer Ketten.** Der Katalog wächst hier nur
  bei Produkten, nicht bei Ketten.
- **Keine direkte Anbindung an die Billa-/Spar-Shop-APIs.** Der aggregierte
  Datensatz ist die Quelle; ein Ausfall von heisse-preise.io bedeutet einen
  ausbleibenden Sync, keinen sofortigen Umstieg auf die Einzel-Schnittstellen.
- **Kein HTTP-Endpunkt, kein Webhook.** Ein Skript im Container, gestartet
  von Coolifys eigenem Scheduler — dieselbe Vertrauensgrenze wie bei
  `scripts/migrieren.ts`.

## Datenmodell

Neue Tabelle `chain_sync_ungeklaert` — die Prüfliste:

- `id`, `chainId` (FK auf `chain`)
- `rohname` (Text aus dem Feed, unverändert)
- `menge`, `einheit` (aus dem Feed geparst)
- `letzterPreis` (Regalpreis, zur Anzeige — keine Preis-Wahrheit, nur
  Orientierungshilfe beim Zuordnen)
- `zuerstGesehenAm`, `zuletztGesehenAm`

Kein Fremdschlüssel auf `product` — genau die fehlende Zuordnung ist der
Zweck der Tabelle. Ein `unique`-Index auf (`chainId`, `rohname`) verhindert
doppelte Prüflisten-Zeilen über mehrere Läufe hinweg; ein erneuter Fund
aktualisiert nur `letzterPreis`/`letztGesehenAm`.

Zwei kleine, nicht-schemaverändernde Ergänzungen an bestehendem Code:
- `schreibeBeobachtung` (`src/lib/preise.ts`) bekommt einen optionalen
  `beobachtetAm`-Parameter (Default: `defaultNow()` wie bisher), damit der
  historische Erstimport Beobachtungen mit ihrem echten Datum statt mit
  „jetzt" schreiben kann.
- Kein neues Feld an `price_observation` — `quelle: 'CHAIN_API'` existiert
  bereits seit Phase 1 genau hierfür.

## Ablauf des Sync-Skripts

1. **Abrufen:** `latest-canonical.json` per `fetch` laden (injizierbar wie
   bei `holeOffProdukt`, für Tests ohne echtes Netzwerk).
2. **Gruppieren:** Einträge nach `store` gruppieren, auf die fünf bekannten
   Kettenkürzel abbilden; unbekannte `store`-Werte werden verworfen und im
   Protokoll gezählt (nicht einzeln geloggt — bei tausenden Fremdartikeln
   wäre das reines Rauschen).
3. **Aktualität je Kette:** eine Kette gilt als aktuell, wenn mindestens die
   Hälfte ihrer Einträge ein `priceHistory[0].date` von höchstens drei Tagen
   vor dem Lauf tragen; sonst wird die ganze Kette diesen Lauf übersprungen
   und im Protokoll als „übersprungen (veraltet)" geführt. Beide Zahlen
   (50 %, drei Tage) als benannte Konstanten im Code, nicht als Magic
   Numbers verstreut — spätere Anpassung soll eine Zeile sein.
4. **Je Artikel einer aktuellen Kette:**
   - Rohname + Menge + Einheit exakt gegen `store_product.rohNamen` der
     Kette abgleichen.
   - **Kein Treffer:** Zeile in `chain_sync_ungeklaert` anlegen/auffrischen.
   - **Treffer:** Regalpreis in Grundpreis umrechnen
     (`grundpreis(preis, { wert: menge, einheit })`); dann:
     - **Kein bisheriger `CHAIN_API`-Eintrag für diesen Artikel:**
       `priceHistory` durchgehen, an jedem Tag mit einer echten
       Preisänderung eine Beobachtung mit historischem `beobachtetAm`
       schreiben.
     - **Bereits vorhanden:** nur schreiben, wenn sich der heutige
       Grundpreis von der letzten `CHAIN_API`-Beobachtung unterscheidet.
5. **Protokoll ausgeben** und beenden. Kein Teilschreiben bei einem
   Abbruch mitten im Lauf (Fehler vor dem Schreiben abbrechen lassen,
   nicht mittendrin weiterschreiben).

## Die Prüfliste — `/verwaltung/ketten-abgleich`

Neue Seite nach dem Muster von `/verwaltung/zugriff`. Tabelle: Kette,
Rohname, Menge/Einheit, letzter bekannter Preis, zuerst/zuletzt gesehen.
Je Zeile zwei Aktionen:

- **Bestehendem Produkt zuordnen** — Katalogsuche (`sucheProdukte`),
  Auswahl trägt den Rohnamen über `sichereKettenProdukt` nach und löscht
  die Prüflisten-Zeile. Ab dem nächsten Lauf trifft der Artikel automatisch.
- **Als neues Produkt anlegen** — der bestehende Katalog-Anlage-Weg
  (`legeProduktAn`), vorbefüllt aus dem Feed; verknüpft danach ebenfalls
  über `sichereKettenProdukt`.

Kein Massen-Import, keine automatische Bestätigung.

## Fehlerfälle

- **Feed nicht erreichbar / kaputtes JSON:** Lauf bricht mit einer klaren
  Fehlermeldung ab, schreibt nichts.
- **Alle Ketten veraltet** (z. B. heisse-preise.io selbst down): als
  ausdrückliche Warnung im Protokoll, nicht als stiller Erfolg mit null
  Treffern.
- **Doppelter Lauf am selben Tag:** idempotent durch die
  „nur bei Preisänderung schreiben"-Regel — kein gesonderter Sperrmechanismus
  nötig.
- **Rohname mehrdeutig** (z. B. durch eine falsche frühere Zuordnung):
  landet in der Prüfliste statt eine Zufallsentscheidung zu treffen.

## Testen

Sync-Kernlogik (Gruppierung, Aktualitätsprüfung, Zuordnung,
Grundpreis-Umrechnung, Änderungserkennung) als reine Funktionen gegen
echtes Postgres getestet. Der Feed-Abruf wird injiziert
(`typeof fetch`), damit kein Test echtes Internet braucht. Ein Test mit
zwei unterschiedlichen Gebindegrößen sichert die Grundpreis-Umrechnung
ausdrücklich ab (dieselbe Fehlerklasse, die Plan 4s Optimierer betraf, darf
hier nicht ein zweites Mal unbemerkt hereinkommen). Die Prüflisten-Seite
bekommt Komponententests nach etabliertem Muster (Aktionen als Props).
Browser-Verifikation der neuen Seite vor Abschluss.

## Deployment

Neuer Abschnitt in `docs/deployment-coolify.md`: Coolify Scheduled Task
einrichten, der täglich `bun scripts/synchronisiere-ketten.js` im laufenden
Container ausführt (dasselbe Vorkompilierungs-Prinzip wie
`scripts/migrieren.ts` — kein Registry-Zugriff zur Laufzeit nötig, außer
dem einen Feed-Abruf).

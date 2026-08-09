# KassaTrack — Design & Umsetzungsplan

## Context

Christopher will wissen, wo er welches Lebensmittel am günstigsten bekommt. Heute existiert dieses Wissen nur im Kopf und ist durch Aktionen verzerrt: ein Produkt wirkt bei Hofer billig, weil es zufällig gerade rabattiert war. KassaTrack baut aus Kassabelegen, Barcode-Scans und (später) Supermarkt-APIs eine belastbare Preisdatenbank für österreichische Ketten und trennt dabei sauber zwischen *Normalpreis* und *Aktionspreis*.

Zielbild: nach dem Einkauf ein Foto vom Beleg, sonst nichts. Beim nächsten Einkaufszettel sagt die App, wo was am günstigsten ist — heute, inklusive laufender Aktionen.

**Zustand:** Leeres Repo (`D:\Christopher\Github\KassaTrack`, nur Initial Commit). Greenfield.

**Hosting:** Coolify, öffentlich erreichbar, Login nur für eine kleine, von Christopher eingeladene Gruppe.

---

## Die zentrale Design-Entscheidung: zwei Preisbegriffe

Das ist der Kern der App. Jedes Produkt hat pro Kette **zwei** Preise:

| Begriff | Definition | Beantwortet |
|---|---|---|
| **Referenzpreis** | Median der `NORMAL`-Beobachtungen der letzten 180 Tage, aktualitätsgewichtet, mit Konfidenz + Datenalter | „Wo ist Butter *grundsätzlich* günstig?" — Langzeitwissen, immun gegen Aktions-Rauschen |
| **Aktueller Bestpreis** | `min(Referenzpreis, aktive Aktion)` mit Gültig-bis-Datum | „Wo kaufe ich *heute*?" — treibt den Einkaufszettel-Optimierer |

Konsequenz: Hofer ist normal teurer als Spar, hat aber diese Woche Butter-Aktion → beim Einkaufszettel gewinnt Hofer, in der Langzeit-Statistik bleibt Spar der Referenz-Sieger. Beides ist gleichzeitig sichtbar, nichts davon widerspricht sich.

Alle Preiszeilen werden gespeichert und klassifiziert. Nichts wird verworfen.

---

## Getroffene Entscheidungen

| Thema | Entscheidung |
|---|---|
| Ketten | Billa/Billa Plus, Spar/Interspar, Hofer, Lidl, Penny (Österreich) |
| Nutzer | Ein Haushalt, gemeinsame Daten, beliebig viele Einkaufszettel |
| Erfassung | Beleg-Foto, Barcode-Scan, Supermarkt-Sync, manuell — alle vier |
| KI | Azure AI Foundry, `gpt-5.4-mini` (Vision + Structured Outputs) für Belege, `gpt-5.4-nano` für Namens-Normalisierung |
| Rabatte | Alles speichern + klassifizieren; Standardvergleich nur `NORMAL`; Aktionen fließen in den aktuellen Bestpreis |
| Login | Passkeys + Invite-Link **und** Google-Login, beides gegen E-Mail-Allowlist |
| Angebote | Stufe 1 (Billa+Spar APIs) jetzt, Stufe 2 (Flugblatt-Parsing Discounter) später |
| Optimierer | Bester Einzelmarkt **und** optimale Aufteilung nebeneinander, Nutzer entscheidet |
| Belegfotos | **Unbegrenzt aufbewahren**, kein Auto-Löschen. Löschen ist eine bewusste manuelle Aktion (einzeln oder gefiltert per Massenaktion). Preisdaten bleiben davon unberührt bestehen. |
| Look | Zweischichtig: ruhige, große Oberfläche — dichte, technische Detailebene auf Tap |

## Warum kein Azure Document Intelligence (`prebuilt-receipt`)

Geprüft in den aktuellen Docs: Das Modell liefert `MerchantName`, `TransactionDate`, `Items[Description, Quantity, Price, TotalPrice]`, `Subtotal`, `Total` — aber **keine Rabatt-Semantik**. Österreichische Belege schreiben Rabatte als eigene Negativzeile unter dem Artikel und Einwegpfand als separate Position. Die Zuordnung „welche Minuszeile gehört zu welchem Artikel" ist genau die geforderte Smartness und braucht ein Sprachmodell. Ein Vision-LLM mit striktem JSON-Schema macht Extraktion und Rabattlogik in einem Schritt. DI bleibt als optionaler Genauigkeits-Booster in der Hinterhand, falls die Trefferquote nicht reicht.

---

## Tech-Stack (Versionen am 2026-08-02 gegen npm-Registry geprüft)

| Paket | Version | Anmerkung |
|---|---|---|
| `next` | 16.2.12 | App Router, Server Components, Partial Prerendering |
| `react` | 19.2.8 | |
| `typescript` | 7.0.2 | Go-native Compiler |
| `tailwindcss` | 4.3.3 | CSS-first Config, **kein** `tailwind.config.js` |
| `shadcn/ui` | latest CLI | auf Radix, Komponenten liegen im Repo |
| `drizzle-orm` | 0.45.2 | + `drizzle-kit` Migrationen |
| `better-auth` | 1.6.25 | Passkey-Plugin + Google + Invites in einem |
| `zod` | 4.4.3 | Validierung + JSON-Schema-Generierung für Structured Outputs |
| `@tanstack/react-query` | 5.101.4 | Client-Cache |
| Runtime | Bun 1.3.14 | gemäß globaler Guidelines; Node 24 LTS als Fallback |
| DB | PostgreSQL 18 | Coolify-Service, `pg_trgm` für Fuzzy-Matching |
| Queue | `pg-boss` | Postgres-basiert, kein Redis nötig |
| Storage | MinIO (Coolify-Service) | S3-kompatibel, presigned URLs, versioniertes Backup — **kein** Auto-Löschen |

**Wichtig für die Umsetzung:** Next.js **16**, nicht 15. Tailwind **v4** (CSS-first). TypeScript **7**. Vor dem ersten Code die Docs via context7 ziehen — insbesondere Next 16 App Router, Tailwind v4 Config und Better Auth Passkey-Plugin.

---

## Architektur

Ein Next.js-16-Container auf Coolify, daneben Postgres und MinIO als Coolify-Services.

```
Browser (PWA)
  │  Passkey / Google
  ▼
Next.js 16  ──────────────────────────────────┐
  ├ Server Components  (Lesepfade)            │
  ├ Server Actions     (Schreibpfade)         │
  ├ Route Handlers     (Upload, Webhooks)     │
  └ pg-boss Worker     (Sync, Cleanup, Match) │
        │                    │                │
        ▼                    ▼                ▼
   Postgres 18           MinIO          Azure AI Foundry
   (Preise, Auth)      (Belegfotos)     gpt-5.4-mini/nano
                                              │
                                    Open Food Facts (Bilder)
                                    Billa/Spar API (Phase 3)
```

### Module (klare Grenzen, unabhängig testbar)

| Modul | Aufgabe | Schnittstelle |
|---|---|---|
| `auth` | Login, Invites, Allowlist, Sessions | Better-Auth-Config + `requireUser()` |
| `catalog` | Produkte, EANs, Kategorien, Bilder | `findOrCreateProduct(candidate)` |
| `matching` | Beleg-Kürzel → kanonisches Produkt | `matchProduct(raw, chain) → {product, confidence}` |
| `ingest/receipt` | Foto → strukturierte Zeilen | `parseReceipt(image) → ReceiptDraft` |
| `ingest/barcode` | EAN-Scan → Preiseingabe | Client-Komponente + Server Action |
| `pricing` | Referenzpreis, aktueller Bestpreis, Verlauf | `getPriceMatrix(productIds) → …` |
| `offers` | Aktionen aus Chain-APIs (Phase 3) | `syncChainOffers(chain)` |
| `lists` | Einkaufszettel + Optimierer (Phase 2) | `optimizeList(listId) → Plan` |

---

## Datenmodell (Kern)

Bewusst **ohne** Filialebene — Preise sind in Österreich innerhalb einer Kette faktisch einheitlich. Bewusst **ohne** Mandantenfähigkeit — ein Haushalt, alle authentifizierten Nutzer sehen alles.

```
user, session, account, passkey        -- Better Auth
allowed_email (email, invited_by, used_at)

chain            (BILLA | SPAR | HOFER | LIDL | PENNY)
category
product          -- kanonisch, kettenübergreifend
  name, brand, category_id
  net_quantity, unit (G|ML|STK), base_unit          -- für €/kg, €/l, €/Stk
  image_key, off_id
product_ean      (ean UNIQUE, product_id)

store_product    -- kettenspezifische Ausprägung
  chain_id, product_id, chain_sku, raw_names TEXT[], image_key

price_observation                       -- append-only, Herzstück
  store_product_id, chain_id, observed_at
  source        RECEIPT | BARCODE | MANUAL | CHAIN_API | FLYER
  price_kind    NORMAL | PROMO | LOYALTY | MULTIBUY
  unit_price, quantity, line_total
  normalized_price                      -- €/kg bzw. €/l, generated column
  promo_label, promo_valid_until
  deposit_amount                        -- Einwegpfand, aus unit_price herausgerechnet
  confidence, needs_review, receipt_id

receipt
  chain_id, purchased_at, total_stated, total_computed
  image_key NULLABLE                    -- NULL = Foto manuell gelöscht, Beleg bleibt
  raw_extraction JSONB                  -- bleibt auch nach Foto-Löschung erhalten
  status PENDING | REVIEWED | FAILED
  image_deleted_at NULLABLE

offer            -- nur aus CHAIN_API / FLYER, nie aus Belegen
  store_product_id, price, valid_from, valid_until, condition_text, source

shopping_list, shopping_list_item
```

**Abgeleitet:** `reference_price(product_id, chain_id)` als Materialized View mit `median`, `n_observations`, `last_seen_at`, `confidence`. Refresh inkrementell nach jedem verarbeiteten Beleg.

**Haushalts-Einstellung:** `loyalty_counts_as_normal` (Default `false`, Christophers Wahl). Umschaltbar, falls sich herausstellt, dass der jö-/Vorteilskartenpreis der reale Alltagspreis ist.

---

## Beleg-Pipeline (der schwierigste Teil)

```
Foto → EXIF strippen, komprimieren → MinIO
     → gpt-5.4-mini (Vision + strict JSON Schema + kettenspezifische Hinweise)
     → deterministische Plausibilisierung im Code
     → Produkt-Matching pro Zeile
     → Review-Screen (nur auffällige Zeilen vorausgewählt)
     → price_observations schreiben
```

### Was der Parser können muss (österreichische Realität)

- **Rabatt als Folgezeile:** `AKTION -0,70`, `SPAR Vorteil`, `% AKTION` unter dem Artikel → `PROMO`
- **Treuekarte:** `jö Bonus`, `Lidl Plus Rabatt` → `LOYALTY`
- **Mengenrabatt:** `3 x 0,99`, `2+1 gratis` → `MULTIBUY`
- **Einwegpfand (seit 2025, 0,25 €/Gebinde):** eigene Zeile, muss aus dem Produktpreis **heraus**gerechnet werden. Sonst ist jede Cola dauerhaft 0,25 € zu teuer — der Fehler, den die meisten Apps machen.
- **Mehrwegpfand** (Glas, Kiste) und dessen Rückgabe als Negativposition
- **Gewichtsartikel:** `0,432 kg x 3,99 €/kg`
- **Storno-/Retourzeilen**

### Selbstvalidierung — der wichtigste Trick

Nach dem Parsing rechnet der Code deterministisch nach:

```
Σ(Zeilensummen) + Σ(Pfand) − Σ(Rabatte) == Beleg-Gesamtsumme ?
```

Stimmt es auf den Cent → hohe Konfidenz, Review-Screen zeigt nur eine Bestätigung.
Stimmt es nicht → `needs_review`, die abweichenden Zeilen werden markiert und zuerst gezeigt.

Der Beleg validiert sich selbst. Das ersetzt manuelles Nachprüfen jeder Zeile und ist der Grund, warum die Erfassung im Alltag wirklich ein Foto bleibt.

---

## Produkt-Matching (Kaskade)

Beleg-Kürzel sind brutal: `VOLLM.3,5% 1L`, `BUTT.EXTRA 250`. Deshalb:

1. **EAN vorhanden** (Barcode-Scan / Chain-API) → exakter Treffer, fertig
2. **Ketten-SKU bekannt** → `store_product` existiert bereits, fertig
3. **Trigram-Fuzzy** (`pg_trgm`) gegen bereits gesehene `raw_names` derselben Kette, Schwelle 0.85 → automatisch
4. **LLM-Vorschlag** (`gpt-5.4-nano`) wählt aus den Top-5-Kandidaten und normalisiert Name/Menge
5. **Sonst:** neues Produkt, im Review-Screen als „Neu" markiert, ein Tap zum Zusammenführen

**Bewusste Strategie:** Jeder Barcode-Scan legt dauerhaft die Brücke EAN ↔ Ketten-SKU ↔ kanonisches Produkt. Der Scan im Laden *trainiert* also die Belegerkennung — je öfter gescannt, desto weniger Nachfragen beim Foto. Das ist der Grund, warum beide Erfassungswege zusammen mehr wert sind als einzeln.

## Produktbilder

Open Food Facts per EAN (kostenlos, ODbL) liefert Bild, Marke, Menge, Kategorie. Bilder werden **kopiert und in MinIO gecacht**, nicht hotgelinkt — schneller, ausfallsicher, kein Third-Party-Request aus dem Browser. Fallback: Shop-Bild aus Chain-API (Phase 3), dann generisches Kategorie-Icon.

---

## UI

Zweischichtig, wie ausgewählt. Deutsch (österreichisch: „Kassabeleg", „Sackerl", „Aktion").

**Ruhige Ebene** — großer Preis, ein Satz Kontext, eine Aktion. Große Touch-Targets, hoher Kontrast, keine Fachbegriffe.
**Dichte Ebene** — auf `[Detail ▸]`: Ketten-Vergleichstabelle mit tabellarischen Ziffern, 90-Tage-Sparkline, Datenalter-Warnung, Streuung, Anzahl Beobachtungen, EAN.

Sechs Screens im MVP:

1. **Start** — „Beleg fotografieren" als dominante Aktion, darunter zuletzt erfasst
2. **Beleg-Review** — Zeilen mit Ampel, Abweichungen zuerst, Bestätigen in einem Tap
3. **Produktsuche** — Suche + Kategorien, Karte pro Produkt mit Bestpreis
4. **Produktdetail** — die zweischichtige Ansicht oben
5. **Beleg-Archiv** — alle Belege chronologisch, filterbar nach Kette und Zeitraum, Originalfoto per Tap. Hier sitzt auch das manuelle Löschen (einzeln oder gefiltert) und der Weg, eine alte Fehlerkennung nachträglich zu korrigieren.
6. **Einkaufszettel** (Phase 2) — Liste + Optimierer

**PWA:** installierbar, Kamerazugriff, Einkaufszettel offline-first via IndexedDB mit Sync bei Reconnect — im Supermarkt ist der Empfang schlecht. Barcode via nativer `BarcodeDetector` API, Fallback `zxing-wasm` für iOS Safari.

**Umsetzung der UI erfolgt mit den Skills `/impeccable`, `/ui-ux-pro-max` und `/frontend-design`** gemäß globaler Guidelines.

---

## Sicherheit

Die App hängt am offenen Internet, deshalb explizit:

- **Better Auth** mit Passkey-Plugin (WebAuthn) als primärem Weg, Google-Social-Provider als zweitem
- **Allowlist-Gate in beiden Pfaden:** ein `before`-Hook prüft die E-Mail gegen `allowed_email`. Ohne Eintrag kein Account — auch nicht via Google. Das ist die einzige Stelle, an der Registrierung entsteht.
- **Invite-Flow:** Christopher erzeugt einen Link, Empfänger registriert Passkey, Eintrag wird als verbraucht markiert
- Sessions in `httpOnly`, `SameSite=Lax`, `Secure` Cookies
- Rate-Limiting auf Auth- und Upload-Routen
- Uploads: MIME- und Größenprüfung, EXIF-Strip (GPS!), kein Content-Type-Sniffing
- Azure-Key ausschließlich serverseitig, nie im Client-Bundle
- Secrets als Coolify Environment Variables, nicht im Repo
- CSP, HSTS, `X-Frame-Options` über Next-Middleware
- Belegfotos über kurzlebige presigned URLs, nie öffentlich lesbar
- **Keine automatische Löschung.** Belege bleiben unbegrenzt für die historische Auswertung. Löschen ist eine manuelle Aktion im Beleg-Archiv, einzeln oder gefiltert (z.B. „alles vor 2025"). Beim Löschen verschwindet nur das Foto aus MinIO — Beleg-Datensatz, `raw_extraction` und alle Preisbeobachtungen bleiben erhalten, die Historie reißt also nie ab.
- Weil die Fotos dauerhaft liegen, zählt der Zugriffsschutz umso mehr: EXIF-Strip beim Upload entfernt GPS-Daten, der Bucket ist ausschließlich über die App erreichbar, und die Coolify-Backups des Buckets sind verschlüsselt abzulegen.
- Speicherbedarf ist unkritisch: ein komprimierter Beleg liegt bei ~150–300 KB, bei 10 Einkäufen pro Woche also grob 150 MB pro Jahr.

---

## Umsetzung in Phasen

Jede Phase ist für sich benutzbar. Jede bekommt ihren eigenen Spec und Implementierungsplan.

### Phase 1 — Fundament (dieser Spec)
Projekt-Setup, Docker/Coolify-Deployment, Auth mit Passkey+Google+Allowlist, Datenmodell, Beleg-Pipeline inkl. Review-Screen, Barcode-Scan, manuelle Eingabe, Produkt-Matching, Referenzpreis-Engine, Produktsuche, Produktdetail zweischichtig, Beleg-Archiv mit manuellem Löschen, PWA-Grundgerüst, Open-Food-Facts-Bilder.
→ **Ergebnis:** Foto machen, Preise landen sauber klassifiziert in der DB, Kettenvergleich funktioniert.

### Phase 2 — Einkaufszettel + Optimierer
Beliebig viele Listen, Artikel aus dem Katalog oder frei, Optimierer zeigt „Bester Einzelmarkt" und „Optimale Aufteilung" nebeneinander mit Ersparnis in Euro, Offline-Fähigkeit im Laden.
→ Läuft zunächst auf eigenen Daten, wird mit Phase 3 deutlich stärker.

### Phase 3 — Billa/Spar-Sync
Erster Schritt ist ein **Spike**: Nutzbarkeit und ToS-Lage der Online-Shop-Endpunkte von Billa und Spar verifizieren, bevor Aufwand hineinfließt. Danach täglicher pg-boss-Job, der Preise und laufende Aktionen zieht, respektvoll gedrosselt und mit Caching. Speist `offer` und `price_observation(source=CHAIN_API)`.
→ Der Optimierer kennt jetzt echte, aktuelle Aktionen statt nur Vergangenheit.

### Phase 4 — Discounter-Flugblätter
Wöchentlicher Job holt die Flugblatt-PDFs von Hofer, Lidl und Penny, `gpt-5.4-mini` extrahiert die Angebote, Matching gegen den Katalog.
→ Volle Abdeckung aller fünf Ketten.

**Explizit nicht im Scope:** native Apps, Rezeptverwaltung, Haushaltsbuch/Ausgabenanalyse, Filialebene, Mehrmandantenfähigkeit, Preisalarme.

---

## Verifikation

**Phase 1 gilt als fertig, wenn:**

1. `bun run build` und `bunx tsc --noEmit` laufen sauber durch
2. Unit-Tests: Beleg-Parser gegen echte Belegfotos aller fünf Ketten als Fixtures — Summenprobe muss auf den Cent stimmen, Rabatt- und Pfandzeilen korrekt klassifiziert
3. Unit-Tests: Matching-Kaskade — EAN-Treffer, Fuzzy-Treffer, Neuanlage
4. Unit-Tests: Referenzpreis ignoriert `PROMO`, aktueller Bestpreis berücksichtigt sie; das Butter-Szenario (Hofer-Aktion schlägt Spar-Normalpreis) ist als Test abgebildet
5. Integrationstest: kompletter Beleg-Upload-Flow gegen den Test-Postgres aus compose.yaml
6. Auth: manueller Test, dass eine Google-Adresse **außerhalb** der Allowlist abgewiesen wird — beide Pfade
7. Lighthouse auf Mobil: Performance ≥ 90, PWA installierbar
8. Deployment auf Coolify erreichbar, Beleg-Upload end-to-end auf dem Handy durchgespielt

---

## Offene Punkte für die Umsetzung

- Azure-Ressource anlegen: AI Foundry Projekt + `gpt-5.4-mini` und `gpt-5.4-nano` Deployment, Region und Kontingent klären
- Echte Beispielbelege aller fünf Ketten sammeln — die sind die Testfixtures und bestimmen die Prompt-Qualität
- Vor Implementierungsbeginn: context7-Docs für Next 16, Tailwind v4 und Better Auth Passkey ziehen
- Die in Phase 3 angenommene Nutzbarkeit der Billa-/Spar-Endpunkte ist **unverifiziert** und wird dort mit einem Spike geklärt, bevor Aufwand hineinfließt

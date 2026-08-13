# KassaTrack auf Coolify deployen

Diese Anleitung ist für eine Person gedacht, die allein gegen einen echten
Coolify-Server arbeitet, ohne den Implementierungsplan gelesen zu haben. Wo
ein Schritt scheitern kann, steht direkt daneben, woran das liegt und was zu
tun ist — nicht nur der Idealfall.

Voraussetzung: **Bun**, nicht npm/yarn/pnpm — auch lokal, falls ein Schritt
hier auf der eigenen Maschine statt im Coolify-Terminal ausgeführt wird.

## 1. Postgres anlegen

Neuer Service → PostgreSQL 18. Interne Verbindungs-URL notieren (Format
`postgres://user:passwort@host:5432/datenbank`, host ist der interne
Docker-Servicename, nicht von außen erreichbar).

## 2. Anwendung anlegen

Neue Ressource → Application → Git-Repository, Build Pack **Dockerfile**,
Branch `main`, Port `3000`.

Das Repository enthält ein mehrstufiges `Dockerfile` (`deps` → `builder` →
`runner`). Der Bau-Schritt (`RUN bun run build`) braucht Platzhalter-Werte für
`DATABASE_URL`, `BETTER_AUTH_SECRET` usw., weil `src/lib/env.ts` diese schon
beim Laden des Moduls prüft — also während `next build` die Routen einsammelt,
nicht erst zur Laufzeit. Diese Platzhalter stehen bereits im Dockerfile
(`bauzeit-platzhalter-…`) und sind mit echten Zugangsdaten unmöglich zu
verwechseln. Zur Laufzeit überschreiben die Werte aus Schritt 3 sie vollständig.

## 3. Environment-Variablen setzen

| Variable | Wert |
|---|---|
| `DATABASE_URL` | interne Postgres-URL aus Schritt 1 |
| `BETTER_AUTH_SECRET` | Ausgabe von `bunx @better-auth/cli secret` |
| `BETTER_AUTH_URL` | die öffentliche Domain, z. B. `https://kassatrack.example.at` |
| `GOOGLE_CLIENT_ID` | aus der Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | aus der Google Cloud Console |

Alle fünf sind Pflicht — `src/lib/env.ts` lehnt den Start ohne sie ab (Fehler
„Ungültige Environment-Konfiguration …" mit den fehlenden Feldern).

## 4. Google OAuth einrichten

Google Cloud Console → APIs & Services → Credentials → OAuth-Client (Web).
Autorisierter Redirect-URI: `https://<domain>/api/auth/callback/google`

Scheitert die Anmeldung mit `redirect_uri_mismatch`: Die URI muss exakt
(inklusive `https://` und ohne abschließenden Schrägstrich) mit der oben
eingetragenen Domain übereinstimmen.

## 5. Domain und TLS

Domain in Coolify eintragen. Traefik stellt das Zertifikat automatisch aus.

**Kritisch:** `BETTER_AUTH_URL` muss exakt der öffentlichen Domain
entsprechen — `src/lib/auth.ts` leitet daraus wörtlich den Passkey-`rpID` ab
(`new URL(env.BETTER_AUTH_URL).hostname`). Eine spätere Abweichung (andere
Domain, `www.`-Präfix, anderes Protokoll) macht **alle bereits registrierten
Passkeys unbrauchbar** — nicht nur neue Anmeldungen, sondern auch bestehende.
Steht die Domain noch nicht fest, mit der Anleitung erst ab hier fortfahren,
wenn sie es tut.

## 6. Migrationen ausführen

Die SQL-Migrationen liegen unter `drizzle/` und werden **nie automatisch**
beim Start ausgeführt — das Image führt nur `bun server.js` aus. Vor der
ersten Nutzung und nach jedem Deployment, das neue Dateien unter `drizzle/`
mitbringt, müssen sie von Hand angewendet werden:

1. In Coolify: die Anwendung öffnen → Terminal des laufenden Containers.
2. Dort ausführen:

   ```bash
   bun scripts/migrieren.js
   ```

**Nicht `bunx drizzle-kit migrate`** — eine frühere Fassung dieser Anleitung
sah das vor, aber `bunx` lädt `drizzle-kit` bei jedem Aufruf einmalig aus der
npm-Registry nach. Das hätte Christophers Erst-Migration von der
Netzwerk-Erreichbarkeit der Registry in genau diesem Moment abhängig gemacht
— eine restriktive Egress-Regel, ein Registry-Ausfall oder (siehe
Fehlerbehebung unten) eine TLS-Interception hätten diesen einen Schritt
scheitern lassen, mitten im ersten Deployment, ohne dass die Fehlermeldung
die wahre Ursache benennt. `scripts/migrieren.js` ist stattdessen ein beim
Bau vorkompiliertes, in sich geschlossenes Skript, das `drizzle-orm` (die vom
Projekt selbst genutzte ORM-Bibliothek) direkt einbindet — es braucht zur
Laufzeit **keinen Netzwerkzugriff auf irgendeine Paket-Registry**, nur die
Datenbankverbindung aus `DATABASE_URL`.

Erfolg sieht so aus (die erste Zeile nennt das tatsächliche Ziel — Host,
Port und Datenbankname, nie die Zugangsdaten — damit ein versehentlicher
Lauf gegen die falsche Datenbank sofort auffällt, statt sich hinter einer
identischen Erfolgsmeldung zu verstecken):

```
Wende Migrationen aus drizzle/ an — Ziel: intern-postgres:5432/kassatrack …
Migrationen erfolgreich angewendet.
```

Ein erneuter Aufruf, wenn bereits alles angewendet ist, ist unschädlich (die
Migrationen sind in einer eigenen Tabelle `drizzle.__drizzle_migrations`
protokolliert und werden nicht doppelt ausgeführt).

**Bei einem Fehler ist der Lauf vollständig atomar — die Datenbank bleibt
unverändert, nichts ist „halb" migriert.** `drizzle-orm` wendet alle in einem
Lauf ausstehenden Migrationen in einer einzigen Datenbank-Transaktion an
(`node_modules/drizzle-orm/pg-core/dialect.js`, Zeile 60–71:
`await session.transaction(async (tx) => { for await (const migration of
migrations) { … } })` — sowohl die SQL-Anweisungen jeder Migration als auch
der Eintrag in `drizzle.__drizzle_migrations` laufen innerhalb dieser einen
Transaktion). Scheitert eine SQL-Anweisung in der dritten Migration, rollt
Postgres **auch die bereits erfolgreich gelaufenen erste und zweite
Migration samt ihrer Buchführungszeilen zurück** — keine der drei Dateien
unter `drizzle/` enthält nicht-transaktionale Anweisungen wie `CREATE INDEX
CONCURRENTLY` oder `ALTER TYPE … ADD VALUE`, die das verhindern würden.

Das Skript meldet „Migration fehlgeschlagen: …" mit der zugrundeliegenden
Ursache und beendet sich mit einem Exit-Code ungleich 0. Die richtige
Reaktion ist deshalb **nicht**, die Datenbank auf einen halb angewendeten
Zustand hin zu untersuchen — es gibt keinen. Stattdessen: den Fehlertext
lesen (meist ein SQL-Fehler auf der jeweiligen `.sql`-Datei unter
`drizzle/`, oder ein Verbindungsproblem), die Ursache beheben, und den
Befehl unverändert erneut ausführen.

## 7. Ersten Zugang freischalten

Da die Allowlist leer ist, kommt niemand herein — auch der Betreiber nicht.

**Coolify → Postgres-Service → Terminal öffnet in aller Regel eine
Shell im Datenbank-Container, keinen fertigen `psql`-Prompt** (das ist nicht
auf diesem Host verifiziert, sondern aus der Funktionsweise der
Terminal-Funktion geschlossen — im Zweifel zeigt sich das sofort: die
`insert`-Anweisung direkt eingetippt liefert `insert: not found` oder eine
ähnliche Shell-Fehlermeldung, statt eine Postgres-Antwort). Für den
üblichen Fall (Shell) `psql` selbst aufrufen, mit der Verbindungs-URL aus
Schritt 1:

```bash
psql "postgres://user:passwort@host:5432/datenbank" -c "
insert into allowed_email (id, email, ist_betreiber)
values (gen_random_uuid()::text, 'deine.adresse@example.at', true);
"
```

Landet man stattdessen direkt in einem `psql`-Prompt (die Zeile endet auf
`=#` statt auf ein Shell-Prompt-Zeichen wie `$` oder `#`), genügt die reine
SQL-Anweisung ohne den vorangestellten `psql`-Aufruf.

Danach nachprüfen, dass der Eintrag tatsächlich mit gesetztem Flag
angekommen ist, bevor man sich auf `/verwaltung/zugriff` verlässt:

```sql
select email, ist_betreiber from allowed_email;
```

Zwei Dinge sind bei der Einfügung zwingend, nicht optional:

- **`ist_betreiber` muss `true` sein.** Ohne dieses Flag kommt die Adresse
  zwar herein, aber niemand kann `/verwaltung/zugriff` öffnen — und weitere
  Personen einzuladen ginge dann nur noch über denselben SQL-Umweg, jedes
  Mal aufs Neue.
- **Die Adresse muss kleingeschrieben sein.** Die Tabelle erzwingt das über
  den Check `allowed_email_klein` — ein Insert mit Großbuchstaben in der
  Adresse wird von Postgres mit einer Constraint-Verletzung abgelehnt, nicht
  stillschweigend normalisiert.

Danach über `/verwaltung/zugriff` alle weiteren Personen einladen.

## 8. Rate-Limiting — was hier bewusst konfiguriert ist

`src/lib/auth.ts` schaltet Better Auths eingebaute Begrenzung ausdrücklich
ein (`{ enabled: true, window: 60, max: 20 }`) und benennt die Herkunfts-Kopfzeile
explizit (`advanced.ipAddress.ipAddressHeaders: ["x-forwarded-for"]`). Das ist
für den Betrieb hinter Coolifys mitgeliefertem Traefik korrekt — **unter der
Annahme**, dass Traefik dort einen von außen mitgebrachten
`X-Forwarded-For`-Kopf durch die tatsächliche Verbindung ersetzt, solange
niemand `trustedIPs`/`insecure` dafür einträgt (z. B. für ein
vorgeschaltetes CDN). Diese Annahme ist nicht in dieser Sitzung gegen eine
echte Coolify-Installation geprüft worden, sondern aus einer früheren
Quelltext-Prüfung von Traefik übernommen (Details und Fundstelle in
`src/lib/auth.ts`) — mit zwei Einschränkungen, die im Betrieb wichtig sind:

- **Größenordnung im degradierten Fall.** Better Auth verschärft die
  konfigurierten Werte für bestimmte Pfade automatisch
  (`getDefaultSpecialRules()` in
  `node_modules/better-auth/dist/api/rate-limiter/index.mjs`, Zeile 370–377):
  jeder Pfad, der mit `/sign-in` beginnt, bekommt **3 Anfragen pro 10
  Sekunden** statt der konfigurierten 20 pro 60 Sekunden. Das betrifft die
  Google-Anmeldung (`/sign-in/social`) unmittelbar. Für Passkeys gilt das
  **nicht** — deren Endpunkte liegen unter `/passkey/…` (z. B.
  `/passkey/verify-authentication`), das Plugin registriert keine eigene
  `rateLimit`-Regel, und sie fallen deshalb unter die allgemeine
  20-pro-60-Sekunden-Konfiguration. Kann die Herkunfts-Adresse nicht
  aufgelöst werden, teilen sich **alle** Personen einen einzigen Bucket pro
  Pfad — bei der Google-Anmeldung sind das dann 3 Anmeldeversuche pro 10
  Sekunden für die gesamte Installation. Mehrere Personen, die kurz
  hintereinander mit Google anmelden, würden sich in diesem Fall gegenseitig
  aussperren (429 „Too many requests").
- **Signal im Log, um genau das zu erkennen.** Kann Better Auth zur Laufzeit
  keine Herkunfts-Adresse auflösen, protokolliert es einmalig pro
  Prozessstart (nicht pro Anfrage — durch ein Modul-Flag begrenzt, `let
  ipWarningLogged = false` in derselben Datei, Zeile 274) die Meldung
  „Rate limiting could not determine a client IP and is falling back to a
  single shared per-path bucket. …". Nach dieser Zeile im Container-Log
  suchen (`docker logs` bzw. Coolifys Log-Ansicht), wenn ungeklärte
  429-Antworten auftreten — sie ist die eindeutige Bestätigung, dass
  `x-forwarded-for` gerade nicht aufgelöst wird, unabhängig davon, welche der
  beiden Ursachen (Traefik-Konfiguration oder ein zusätzlicher, hier nicht
  vorgesehener Sprung wie ein CDN) dahintersteckt.
- **Repliken.** Ohne eigene `secondaryStorage` verwendet Better Auth einen
  **In-Memory-Zähler je Prozess**. Bei genau einer Replik (der Standard für
  diese Anwendung) ist das unproblematisch. Wird die Anwendung in Coolify auf
  mehrere Repliken skaliert, bekommt **jede Replik ihr eigenes Kontingent** —
  das tatsächliche Limit wächst dann unbemerkt mit der Replik-Anzahl, ohne
  dass an der Konfiguration etwas geändert wurde.

**Solange nur eine Replik läuft, ist keine weitere Aktion nötig.** Wird später
skaliert, muss vorher eine geteilte Ablage (z. B. Redis über
`secondaryStorage`) für die Begrenzung eingerichtet werden — sonst rate-limitet
sich die Anwendung nicht mehr wirksam selbst.

## 9. Backups

Coolify → Postgres-Service → Backups aktivieren, Ziel S3, täglich.

## 10. Produktbilder — persistentes Volume

Plan 3 lädt Produktbilder von Open Food Facts herunter und speichert sie
im Verzeichnis, das `PRODUKTBILDER_VERZEICHNIS` benennt. Ohne ein
persistentes Volume an dieser Stelle gehen alle geladenen Bilder bei jedem
Neu-Deployment verloren — sie würden beim nächsten Scan derselben Produkte
lediglich erneut heruntergeladen, kein Datenverlust im Sinne der
Preishistorie, aber unnötiger Open-Food-Facts-Traffic.

1. In Coolify: Anwendung → Storages → „Add" → Pfad im Container z. B.
   `/app/daten/produktbilder`, ein eigenes Volume.
2. `PRODUKTBILDER_VERZEICHNIS=/app/daten/produktbilder` als
   Environment-Variable setzen (siehe Abschnitt 3).

**Besitzrechte, falls Bilder nicht geschrieben werden können.** Das
`Dockerfile` legt `/app/daten/produktbilder` im Image an und übergibt es
`nextjs` (dem Prozess-Benutzer, `USER nextjs`, uid 1001) — das reicht, damit
ein beim ersten Start noch leeres Docker-Volume Inhalt *und* Besitzrechte
dieses Pfads aus dem Image übernimmt. Legt Coolify das Volume stattdessen
als reines Verzeichnis auf dem Host an (Bind-Mount statt benanntes Volume —
in der Storages-Ansicht sichtbar) oder existiert es aus einem früheren
Versuch bereits root-eigen, gilt diese Übernahme nicht, und Schreibversuche
scheitern mit `EACCES` (sichtbar in `docker logs` beim ersten Bildabruf).
Abhilfe im Container-Terminal:

```bash
chown -R 1001:1001 /app/daten/produktbilder
```

## 11. Live verifizieren

Nach dem Deployment auf dem **Handy** durchspielen:

1. Domain öffnen → Weiterleitung auf `/anmelden`
2. Mit Google anmelden, mit einer Adresse, die **nicht** freigeschaltet ist →
   es erscheint die Fehlermeldung, es entsteht **kein** Account. In der
   Datenbank prüfen: `select count(*) from "user";` bleibt unverändert.
3. Adresse per SQL freischalten, erneut anmelden → Zugang funktioniert
4. Passkey registrieren, abmelden, mit Passkey anmelden
5. „Zum Startbildschirm hinzufügen" → App startet ohne Browserleiste
6. Lighthouse (Mobil) laufen lassen → Performance ≥ 90, PWA installierbar

## 12. Fehlerbehebung

**`docker build` schlägt mit `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (oder
„unable to verify the first certificate") fehl — nur relevant bei einem
lokalen Probe-Build vor dem Coolify-Deployment, betrifft den
Coolify-Server selbst nicht:** Das Zertifikat, das in diesem Fall abgelehnt
wird — sei es beim Herunterladen von Paketen durch `bun install`, oder beim
Laden von Google-Schriftarten durch `next/font` während `next build` — ist
nicht das echte Zertifikat der jeweiligen Gegenstelle, sondern eines, das
eine lokal laufende Antiviren-Software (beobachtet: Norton, Aussteller
„Norton Web/Mail Shield Root") beim Abfangen von HTTPS-Verbindungen einsetzt
(„TLS-Interception“/Web-Schutz). Der Fehler nennt das nicht beim Namen — er
sieht aus wie ein kaputtes Zertifikat der Gegenstelle, ist aber ein lokales
Netzwerkproblem dieser einen Maschine, keines des Repositories, der
Registry oder von Google. Der **Coolify-Build-Server ist davon nicht
betroffen** — dort läuft keine lokale Antiviren-Software zwischen Container
und Internet.

Abhilfe: den Web-/Mail-Schutz der Antiviren-Software vollständig
deaktivieren (ein einzelner Schalter reicht möglicherweise nicht — bei
Norton z. B. ist die „Intelligente Firewall“ ein separater Schalter vom
„Web Shield“) und danach **tatsächlich nachprüfen, welches Zertifikat
ankommt**, statt sich auf die Einstellungen-UI zu verlassen:

```bash
echo | openssl s_client -connect registry.npmjs.org:443 -servername registry.npmjs.org 2>/dev/null \
  | openssl x509 -noout -issuer
```

Ein Aussteller mit „Norton“ (oder einer anderen Sicherheits-Software) im
Namen bedeutet: die Abschaltung ist noch nicht wirksam. Ein Aussteller wie
„Google Trust Services" oder „Let's Encrypt" bedeutet: der Weg ist frei.
Diese Prüfung ist auch deshalb nötig, weil eine zeitlich befristete
Abschaltung (z. B. eine 15-Minuten-Pause) während eines längeren Builds
**mittendrin wieder aktiv werden kann** — ein Build, der zu Beginn durchkam,
kann später an genau derselben Stelle erneut scheitern. Diesen Fehler nicht
mit einem manuell eingespielten Zertifikat oder `--insecure`-Flags umgehen —
das verdeckt nur, dass der Datenverkehr weiterhin mitgelesen wird, und sagt
nichts über die tatsächliche Netzwerksituation auf dem Coolify-Server aus.

**Healthcheck bleibt `unhealthy`:** `docker logs <container>` prüfen. Startet
der Server gar nicht, liegt es meist an fehlenden/ungültigen
Environment-Variablen (siehe Schritt 3) — `src/lib/env.ts` bricht dann mit
einer klaren Fehlermeldung ab, bevor der Server überhaupt lauscht. Startet der
Server, aber `/api/health` antwortet nicht innerhalb der 5-Sekunden-Zeitgrenze,
ist das Problem im Container selbst zu suchen (nicht in der Datenbank) — die
Route fragt keine Datenbank ab.

**Migration schlägt fehl, aber die Anwendung startet trotzdem:** Erwartet.
Der Server wartet beim Start nicht auf eine erfolgreiche Migration
(`src/instrumentation.ts` wartet aus Absicht nicht auf die
Datenbank-Verbindung, sonst würde ein Coolify-Container, der vor Postgres
hochfährt, nie bereit werden). Ohne angewendete Migrationen schlagen einzelne
Datenbank-Abfragen der Anwendung fehl, sobald sie tatsächlich ausgeführt
werden — Schritt 6 vor der ersten Nutzung nicht überspringen.

**Anmeldung schlägt mit einer kryptischen Fehlermeldung in der URL fehl, statt
mit dem erwarteten deutschen Text:** Das ist kein Anzeichen für einen neuen
Fehler — `src/lib/auth.ts` dokumentiert ausführlich, warum Better Auth den
Abweisungs-Code in der URL trägt und nicht den für Menschen lesbaren Satz.
Der lesbare Text erscheint erst auf der Anmeldeseite selbst.

**Passkeys funktionieren nach einem Domain-Wechsel nicht mehr:** Erwartet,
siehe Schritt 5 — es gibt keinen Weg, bestehende Passkeys auf eine neue Domain
zu übertragen. Betroffene Personen müssen sie neu registrieren.

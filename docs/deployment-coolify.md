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
beim Start ausgeführt — das Image führt nur `bun server.js` aus. Vor dem
ersten Start und nach jedem Deployment, das neue Dateien unter `drizzle/`
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

Erfolg sieht so aus:

```
Wende Migrationen aus drizzle/ an …
Migrationen erfolgreich angewendet.
```

Ein erneuter Aufruf, wenn bereits alles angewendet ist, ist unschädlich (die
Migrationen sind in einer eigenen Tabelle `drizzle.__drizzle_migrations`
protokolliert und werden nicht doppelt ausgeführt). Bei einem Fehler
(z. B. nicht erreichbare Datenbank) meldet das Skript
„Migration fehlgeschlagen: …" mit der zugrundeliegenden Ursache und beendet
sich mit einem Exit-Code ungleich 0 — es rollt bereits angewendete
Migrationen dabei nicht zurück. Bei einem Abbruch mitten in einer Migration
den Fehlertext lesen (meist ein SQL-Fehler auf der jeweiligen `.sql`-Datei
unter `drizzle/`) und erst danach erneut versuchen, statt den Befehl blind zu
wiederholen.

## 7. Ersten Zugang freischalten

Da die Allowlist leer ist, kommt niemand herein — auch der Betreiber nicht.
Einmalig im Postgres-Terminal (Coolify → Postgres-Service → Terminal, oder
`psql` gegen die Verbindungs-URL aus Schritt 1):

```sql
insert into allowed_email (id, email, ist_betreiber)
values (gen_random_uuid()::text, 'deine.adresse@example.at', true);
```

Zwei Dinge sind hier zwingend, nicht optional:

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
für den Betrieb hinter Coolifys mitgeliefertem Traefik korrekt, aber mit einer
Einschränkung, die beim Skalieren wichtig wird:

- Ohne eigene `secondaryStorage` verwendet Better Auth einen **In-Memory-Zähler
  je Prozess**. Bei genau einer Replik (der Standard für diese Anwendung) ist
  das unproblematisch. Wird die Anwendung in Coolify auf mehrere Repliken
  skaliert, bekommt **jede Replik ihr eigenes Kontingent** — das tatsächliche
  Limit wächst dann unbemerkt mit der Replik-Anzahl, ohne dass an der
  Konfiguration etwas geändert wurde.
- Traefik in einer Standard-Coolify-Installation ersetzt einen von außen
  mitgebrachten `X-Forwarded-For`-Kopf durch die tatsächliche Verbindung,
  solange niemand `trustedIPs`/`insecure` dafür einträgt (z. B. für ein
  vorgeschaltetes CDN). Ohne einen solchen zusätzlichen Sprung reicht die
  aktuelle Konfiguration aus.

**Solange nur eine Replik läuft, ist keine weitere Aktion nötig.** Wird später
skaliert, muss vorher eine geteilte Ablage (z. B. Redis über
`secondaryStorage`) für die Begrenzung eingerichtet werden — sonst rate-limitet
sich die Anwendung nicht mehr wirksam selbst.

## 9. Backups

Coolify → Postgres-Service → Backups aktivieren, Ziel S3, täglich.

## 10. Live verifizieren

Nach dem Deployment auf dem **Handy** durchspielen:

1. Domain öffnen → Weiterleitung auf `/anmelden`
2. Mit Google anmelden, mit einer Adresse, die **nicht** freigeschaltet ist →
   es erscheint die Fehlermeldung, es entsteht **kein** Account. In der
   Datenbank prüfen: `select count(*) from "user";` bleibt unverändert.
3. Adresse per SQL freischalten, erneut anmelden → Zugang funktioniert
4. Passkey registrieren, abmelden, mit Passkey anmelden
5. „Zum Startbildschirm hinzufügen" → App startet ohne Browserleiste
6. Lighthouse (Mobil) laufen lassen → Performance ≥ 90, PWA installierbar

## 11. Fehlerbehebung

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

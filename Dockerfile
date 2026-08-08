FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.14-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Platzhalter nur für den Build — src/lib/env.ts prüft beim Modul-Laden, also
# schon während `next build` die Routen einsammelt, nicht erst zur Laufzeit.
# Zur Laufzeit kommen die echten Werte aus Coolify; diese hier sind
# unmöglich mit echten Zugangsdaten zu verwechseln.
ENV DATABASE_URL=postgres://bauzeit-platzhalter:bauzeit-platzhalter@bauzeit-platzhalter:5432/bauzeit-platzhalter \
    BETTER_AUTH_SECRET=bauzeit-platzhalter-nicht-echt-mindestens-32-zeichen-lang \
    BETTER_AUTH_URL=http://bauzeit-platzhalter.invalid:3000 \
    GOOGLE_CLIENT_ID=bauzeit-platzhalter \
    GOOGLE_CLIENT_SECRET=bauzeit-platzhalter
# `next build --webpack`, nicht `next build`: Serwist ist ein webpack-Plugin,
# und ohne das Flag baut Next mit Turbopack durch, aber schweigend ohne
# `public/sw.js` — siehe next.config.ts. `public/sw.js` ist gitignored, es
# entsteht nur hier im Builder, nie aus dem Repository.
RUN bun run build

# Baut das Migrationsskript zu einer einzigen, in sich geschlossenen Datei.
# Grund: `next build` bündelt `drizzle-orm` in die Next-eigenen Server-Bündel
# hinein (per `find` im fertigen Image selbst nachgeprüft: das Paket liegt
# unter `.next/standalone/node_modules` nirgends als eigener Ordner), weil
# Webpack reinen JS-Code direkt in die Ausgabe inline setzt. Ein eigenständiges
# Skript, das `drizzle-orm/node-postgres/migrator` importiert und außerhalb
# dieses Bündels mit `bun` läuft, fände das Paket zur Laufzeit also nicht.
# `bun build` löst dasselbe Problem für dieses eine Skript: `pg` bleibt extern
# (das echte Paket steht bereits über `next build` im Server-Bündel als
# Laufzeit-Abhängigkeit bereit, `pg`s natives Verbindungsverhalten lässt sich
# ohnehin nicht sinnvoll inline bündeln), `drizzle-orm` selbst landet
# vollständig in der Ausgabedatei.
RUN bun build ./scripts/migrieren.ts --target=bun --external pg --outfile=./scripts/migrieren.js

FROM oven/bun:1.3.14-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

# `-h`/`mkdir`/`chown`: ein System-User bekommt bei Busybox ohne diese Zeilen
# kein beschreibbares Home-Verzeichnis, und `bun` legt eigene Zustandsdateien
# (z. B. Install-Cache) unter `$HOME` ab. Ohne ein echtes, beschreibbares
# Home-Verzeichnis würde ein künftiger `bun`/`bunx`-Aufruf in diesem Container
# an einer Stelle scheitern, die nichts mit seinem eigentlichen Zweck zu tun
# hat — ein Fehler, der wie ein Datenbankproblem aussähe, aber keins wäre.
RUN addgroup -g 1001 -S nodejs \
  && adduser -S nextjs -u 1001 -h /home/nextjs \
  && mkdir -p /home/nextjs \
  && chown -R nextjs:nodejs /home/nextjs
ENV HOME=/home/nextjs

# `public` zuerst aus dem Builder, nicht aus dem Repository: Erst dort liegt
# das von Serwist erzeugte `public/sw.js` neben den eingecheckten Icons.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
# Das vorgebaute Migrationsskript (siehe oben) — kein `drizzle.config.ts`
# nötig: `drizzle-orm/node-postgres/migrator` liest `migrationsFolder` direkt
# vom Dateisystem und braucht dafür keine drizzle-kit-Konfiguration.
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrieren.js ./scripts/migrieren.js

USER nextjs
EXPOSE 3000

# Prüft den laufenden Server über echtes HTTP, nicht nur den Prozess:
# Ein hängender Server (siehe instrumentation.ts) fiele hier durch, ein
# abgestürzter erst recht.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "server.js"]

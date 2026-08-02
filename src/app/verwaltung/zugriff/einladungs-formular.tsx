"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";
import { ladeEin } from "./aktionen";
import { LEERER_ZUSTAND, type EinladungsZustand } from "./zustand";

/**
 * Adresse eintragen, Link herausbekommen, Link kopieren.
 *
 * Der eigentliche Zweck dieses Bildschirms ist der letzte Schritt: Der Link
 * wird per Nachricht weitergeschickt. Deshalb steht das Kopieren als eigene
 * Schaltfläche unmittelbar am Link und nicht als Symbol irgendwo daneben, und
 * deshalb bleibt der Link zugleich in voller Länge sichtbar und markierbar —
 * wenn die Zwischenablage nicht verfügbar ist (etwa über schlichtes HTTP), darf
 * das keine Sackgasse sein.
 */
export function EinladungsFormular() {
  const [zustand, absenden, laeuft] = useActionState(ladeEin, LEERER_ZUSTAND);
  const feldId = useId();
  const meldungsId = useId();

  return (
    <div className="flex flex-col gap-4">
      <form action={absenden} className="flex flex-col gap-2">
        <label htmlFor={feldId} className="text-sm font-medium">
          E-Mail-Adresse
        </label>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id={feldId}
            name="email"
            type="email"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="name@example.at"
            aria-describedby={zustand.art === "fehler" ? meldungsId : undefined}
            aria-invalid={zustand.art === "fehler" || undefined}
            className={
              "min-h-11 flex-1 rounded-klein border border-linie-stark bg-hintergrund px-3 " +
              "text-base placeholder:text-gedaempft aria-[invalid=true]:border-fehler"
            }
          />
          <Schaltflaeche type="submit" groesse="dicht" laedt={laeuft}>
            Einladung erstellen
          </Schaltflaeche>
        </div>

        {/*
          Unter dem Feld, nicht über dem Formular: Der Fehler gehört dorthin,
          wo er entstanden ist. `role="alert"` macht ihn hörbar.
        */}
        {zustand.art === "fehler" ? (
          <p id={meldungsId} role="alert" className="text-sm text-fehler">
            {zustand.text}
          </p>
        ) : null}
      </form>

      {zustand.art === "fertig" ? <Ergebnis zustand={zustand} /> : null}
    </div>
  );
}

function Ergebnis({ zustand }: { zustand: Extract<EinladungsZustand, { art: "fertig" }> }) {
  const [meldung, setMeldung] = useState<string | null>(null);

  // Beim nächsten erzeugten Link muss die alte Kopier-Rückmeldung weg — sonst
  // stünde „Link kopiert" unter einem Link, den niemand kopiert hat.
  useEffect(() => setMeldung(null), [zustand.link]);

  async function kopiere() {
    try {
      await navigator.clipboard.writeText(zustand.link);
      setMeldung("Link kopiert.");
    } catch {
      setMeldung("Kopieren hat nicht geklappt. Markier den Link und kopier ihn selbst.");
    }
  }

  return (
    <div data-auftritt className="flex animate-auftritt flex-col gap-3 rounded-block bg-flaeche p-4">
      <p className="text-sm text-gedaempft">
        <strong className="font-medium text-vordergrund">{zustand.email}</strong> ist
        freigeschaltet. Schick diesen Link weiter — er gilt bis {zustand.gueltigBis}.
      </p>

      {/*
        `break-all`, weil der Token 43 Zeichen ohne Trennstelle hat: Ohne das
        schöbe der Link auf dem Handy die ganze Seite in die Breite.

        Bewusst **nicht** in `--font-zahlen` (Martian Mono) gesetzt, obwohl eine
        Monospace die Zeichen besser unterscheidbar machte: Die Schrift ist sehr
        breit, und Herkunft plus Token ergeben rund 75 Zeichen. Auf einem Handy
        wären das sechs bis sieben Zeilen Adresssalat. Der Link wird kopiert und
        nicht abgetippt — Lesbarkeit Zeichen für Zeichen ist den Platz hier
        nicht wert.
      */}
      <code className="rounded-klein bg-hintergrund px-3 py-2.5 font-mono text-sm break-all select-all">
        {zustand.link}
      </code>

      <div className="flex flex-wrap items-center gap-3">
        <Schaltflaeche groesse="dicht" onClick={kopiere} symbol={<Klemmbrett />}>
          Link kopieren
        </Schaltflaeche>

        {/* Immer im Dokument, damit Hilfstechnik die Änderung als Änderung liest. */}
        <p role="status" className="text-sm text-gedaempft empty:hidden">
          {meldung ?? ""}
        </p>
      </div>
    </div>
  );
}

function Klemmbrett() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <rect x="7" y="7" width="9" height="10" rx="2" />
      <path d="M13 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1" />
    </svg>
  );
}

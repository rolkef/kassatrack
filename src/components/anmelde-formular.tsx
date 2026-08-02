"use client";

import { useId, useState, useTransition } from "react";
import { authClient } from "@/lib/auth-client";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";
import {
  ANMELDE_PFAD,
  deuteAntwort,
  KEINE_VERBINDUNG,
  type Meldung,
} from "@/lib/anmeldung";

type Weg = "passkey" | "google";

type Fehler = { message?: string; status?: number };
type Ergebnis = { error?: Fehler | null };

const TEXTE = {
  passkey: {
    beschriftung: "Mit Passkey anmelden",
    laufend: "Passkey wird geöffnet …",
  },
  google: {
    beschriftung: "Mit Google anmelden",
    laufend: "Weiterleitung zu Google …",
  },
} as const;

type Eigenschaften = {
  /**
   * Meldung, mit der die Seite startet. Der Google-Weg entscheidet erst im
   * OAuth-Callback und kommt als Rückleitung mit `?error=…` zurück — die
   * Abweisung liegt dann schon fest, bevor diese Komponente überhaupt lädt.
   * Die Seite liest den Parameter und reicht das Ergebnis hier herein.
   */
  anfangsMeldung?: Meldung | null;
  /**
   * Was nach einer erfolgreichen Anmeldung passiert. Voreinstellung ist ein
   * vollständiger Seitenwechsel, kein Router-Übergang: die Sitzung ist neu,
   * und ein echter Ladevorgang stellt sicher, dass Proxy, Server-Komponenten
   * und Cache sie alle sehen. Der Google-Weg verlässt die Seite ohnehin hart —
   * so verhalten sich beide Wege gleich.
   */
  nachErfolg?: () => void;
};

/**
 * Zwei Wege, kein Formular — und ein Erklärkasten, der immer da ist.
 *
 * Vor dem ersten Versuch sagt der Kasten, dass der Zugang eingeladen sein
 * muss; damit überrascht eine Abweisung niemanden. Während der Anmeldung sagt
 * er, was gerade passiert. Danach sagt er, was herausgekommen ist. Ein Ort,
 * drei Zustände — nichts, was unangekündigt aufspringt. Der Ton wechselt dabei
 * von ruhig auf Sand, nie auf Rot: wer nicht eingeladen ist, hat nichts falsch
 * gemacht.
 */
export function AnmeldeFormular({
  anfangsMeldung = null,
  nachErfolg = () => window.location.assign("/"),
}: Eigenschaften = {}) {
  const [meldung, setMeldung] = useState<Meldung | null>(anfangsMeldung);
  const [weg, setWeg] = useState<Weg | null>(null);
  const [laeuft, starte] = useTransition();
  const beschreibungId = useId();

  function anmelden(gewaehlt: Weg, ausfuehren: () => Promise<Ergebnis>) {
    setMeldung(null);
    setWeg(gewaehlt);

    starte(async () => {
      try {
        const ergebnis = await ausfuehren();
        if (ergebnis?.error) {
          setMeldung(deuteAntwort(ergebnis.error));
        } else {
          nachErfolg();
        }
      } catch {
        setMeldung({ text: KEINE_VERBINDUNG, abgewiesen: false });
      } finally {
        setWeg(null);
      }
    });
  }

  const arbeitet = laeuft && weg !== null;

  return (
    <div className="flex flex-col gap-5">
      <div
        data-auftritt
        className="flex animate-auftritt flex-col gap-3 [animation-delay:80ms]"
      >
        <Schaltflaeche
          variante="haupt"
          laedt={arbeitet && weg === "passkey"}
          disabled={arbeitet}
          aria-describedby={beschreibungId}
          symbol={<Fingerabdruck />}
          onClick={() => anmelden("passkey", () => authClient.signIn.passkey())}
        >
          {TEXTE.passkey.beschriftung}
        </Schaltflaeche>

        <Schaltflaeche
          variante="neben"
          laedt={arbeitet && weg === "google"}
          disabled={arbeitet}
          symbol={<GoogleMarke />}
          onClick={() =>
            anmelden("google", () =>
              authClient.signIn.social({
                provider: "google",
                callbackURL: "/",
                // Ohne das landet eine nicht freigeschaltete Adresse auf der
                // englischen Standard-Fehlerseite von Better Auth: Die
                // Entscheidung fällt erst im Callback, also serverseitig,
                // lange nachdem dieser Aufruf aufgelöst hat.
                errorCallbackURL: ANMELDE_PFAD,
              }),
            )
          }
        >
          {TEXTE.google.beschriftung}
        </Schaltflaeche>
      </div>

      <p
        id={beschreibungId}
        data-auftritt
        className="animate-auftritt text-base leading-relaxed text-gedaempft [animation-delay:140ms]"
      >
        Ein Passkey ist kein Passwort: Du bestätigst mit Fingerabdruck, Gesicht oder dem Code
        deines Geräts.
      </p>

      <div
        data-auftritt
        data-ton={meldung ? "hinweis" : "ruhig"}
        className={
          "animate-auftritt rounded-klein px-4 py-3.5 text-base leading-relaxed [animation-delay:200ms] " +
          "data-[ton=ruhig]:bg-flaeche data-[ton=ruhig]:text-gedaempft " +
          "data-[ton=hinweis]:bg-hinweis data-[ton=hinweis]:text-auf-hinweis"
        }
      >
        {meldung ? (
          <div role="alert" className="flex gap-3">
            <span aria-hidden="true" className="mt-0.5 shrink-0">
              <Merkzeichen />
            </span>
            <span>
              <span className="font-medium">{meldung.text}</span>
              {meldung.abgewiesen ? (
                <span className="mt-1 block">
                  Wende dich an die Person, die dich zu KassaTrack eingeladen hat.
                </span>
              ) : null}
            </span>
          </div>
        ) : arbeitet ? null : (
          <p>
            KassaTrack steht nur eingeladenen Adressen offen. Beide Wege prüfen zuerst, ob deine
            Adresse freigeschaltet ist.
          </p>
        )}

        {/*
          Immer im Dokument, damit Hilfstechnik die Änderung als Änderung liest
          und nicht als neu eingefügten Bereich.
        */}
        <p role="status" className="empty:hidden">
          {arbeitet && weg ? TEXTE[weg].laufend : ""}
        </p>
      </div>
    </div>
  );
}

function Fingerabdruck() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 10a2 2 0 0 0-2 2c0 2.5.3 4.6-.7 6.6" />
      <path d="M14 12a2 2 0 0 0-2-2" />
      <path d="M14 12c0 3 -.4 5.6-1.2 7.8" />
      <path d="M7.5 8.5a6 6 0 0 1 10.5 4c0 1.9-.2 3.8-.6 5.6" />
      <path d="M6 12a6 6 0 0 1 .4-2.2" />
      <path d="M6.6 16.2A9 9 0 0 1 6 13" />
      <path d="M3.5 8a10 10 0 0 1 17 1.7" />
      <path d="M21 13.5c0 2.1-.2 4.2-.6 6.2" />
    </svg>
  );
}

/** Offizielle Google-Bildmarke — die Farben sind Vorgabe, nicht Gestaltung. */
function GoogleMarke() {
  return (
    <svg viewBox="0 0 24 24" className="size-5">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

/** Kein Ausrufezeichen: die Meldung informiert, sie mahnt nicht. */
function Merkzeichen() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9.25v4.5" />
      <path d="M10 6.5h.01" />
    </svg>
  );
}

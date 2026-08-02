"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";
import { entziehe } from "./aktionen";
import { KEIN_ENTZUGSFEHLER } from "./zustand";

type Eigenschaften = {
  email: string;
  /** Schon auf dem Server formatiert — siehe `formatiereDatum`. */
  seit: string;
  hatKonto: boolean;
};

/**
 * Eine freigeschaltete Adresse — und der Ort, an dem diese Seite ihre Aufgabe
 * erfüllt: Folgen sichtbar zu machen, **bevor** geklickt wird.
 *
 * Das Entziehen läuft deshalb in zwei Schritten, und der zweite Schritt sagt in
 * ganzen Sätzen, was gleich passiert. Kein modaler Dialog: Der Satz gehört an
 * die Zeile, über die er spricht, nicht in ein Fenster darüber, das man
 * wegklickt, ohne es gelesen zu haben.
 *
 * Der Satz ist außerdem für **diese** Zeile wahr und nicht allgemein gehalten.
 * Die Allowlist wird nur beim Anlegen eines Kontos geprüft; wer bereits ein
 * Konto hat, kommt danach ohne erneute Prüfung herein. „Entziehen" sperrt also
 * nur diejenigen aus, die sich noch nie angemeldet haben. Das hier zu
 * verschweigen und „kann sich danach nicht mehr anmelden" hinzuschreiben, wäre
 * die bequemere, aber falsche Auskunft.
 */
export function ZugangsZeile({ email, seit, hatKonto }: Eigenschaften) {
  const [fragt, setFragt] = useState(false);
  const [zustand, absenden] = useActionState(entziehe, KEIN_ENTZUGSFEHLER);
  const folgenId = useId();

  return (
    <li className="py-3.5">
      {fragt ? (
        <div className="flex flex-col gap-3 rounded-klein bg-flaeche p-3.5">
          <p id={folgenId} className="text-sm leading-relaxed">
            <strong className="font-medium break-words">{email}</strong>{" "}
            {hatKonto ? (
              <>
                hat sich bereits angemeldet. Das Entziehen streicht nur die Einladung —{" "}
                <strong className="font-medium">das bestehende Konto bleibt bestehen</strong> und
                kann sich weiterhin anmelden.
              </>
            ) : (
              <>
                hat sich noch nie angemeldet. Nach dem Entziehen kommt diese Adresse{" "}
                <strong className="font-medium">nicht mehr herein</strong>.
              </>
            )}
          </p>

          <form action={absenden} className="flex flex-wrap gap-2">
            <input type="hidden" name="email" value={email} />
            <EntzugsSchaltflaeche beschreibung={folgenId} />
            <Schaltflaeche
              type="button"
              variante="neben"
              groesse="dicht"
              onClick={() => setFragt(false)}
            >
              Behalten
            </Schaltflaeche>
          </form>

          {zustand.fehler ? (
            <p role="alert" className="text-sm text-fehler">
              {zustand.fehler}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="break-words">{email}</span>
            <span className="text-sm text-gedaempft">
              {hatKonto ? "Konto angelegt" : "Noch nicht angemeldet"} · seit {seit}
            </span>
          </div>

          {/*
            Nicht rot. Rot wirkt, weil es selten ist — stünde es an jeder Zeile,
            wäre die Seite ein Alarmfeld und die Warnung im Moment der
            Entscheidung nichts mehr wert. Rot kommt einen Schritt später.
          */}
          {/*
            `self-start`, damit die Schaltfläche auf dem Handy nicht über die
            ganze Breite läuft: In der gestapelten Ansicht würde ein
            vollbreites „Zugang entziehen" pro Zeile die Seite dominieren und
            der eigentlichen Hauptaufgabe (einladen) den Rang ablaufen.
          */}
          <Schaltflaeche
            type="button"
            variante="neben"
            groesse="dicht"
            className="shrink-0 self-start"
            onClick={() => setFragt(true)}
          >
            Zugang entziehen
            <span className="sr-only"> für {email}</span>
          </Schaltflaeche>
        </div>
      )}
    </li>
  );
}

/**
 * Eigene Komponente, weil `useFormStatus` den Zustand des **umgebenden**
 * Formulars liest und dafür innerhalb davon stehen muss.
 */
function EntzugsSchaltflaeche({ beschreibung }: { beschreibung: string }) {
  const { pending } = useFormStatus();

  return (
    <Schaltflaeche
      type="submit"
      variante="gefahr"
      groesse="dicht"
      laedt={pending}
      aria-describedby={beschreibung}
    >
      Ja, Zugang entziehen
    </Schaltflaeche>
  );
}

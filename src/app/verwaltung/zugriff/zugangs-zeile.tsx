"use client";

import { useActionState, useEffect, useId, useRef, useState, type RefObject } from "react";
import { useFormStatus } from "react-dom";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";
import { KEIN_ENTZUGSFEHLER, type EntzugsAktion } from "./zustand";

type Eigenschaften = {
  email: string;
  /** Schon auf dem Server formatiert — siehe `formatiereDatum`. */
  seit: string;
  hatKonto: boolean;
  /** Darf selbst einladen und entziehen. */
  istBetreiber: boolean;
  /** Die eigene Zeile der gerade angemeldeten Person. */
  istManSelbst: boolean;
  /**
   * Die Server-Aktion, hereingereicht statt importiert.
   *
   * Server-Aktionen dürfen als Eigenschaft von einer Server- an eine
   * Client-Komponente gehen; genau dafür gibt es das Muster. Der Gewinn ist
   * hier ein doppelter: Der Test kann eine Attrappe übergeben, ohne das
   * Aktionsmodul global zu ersetzen — und weil `mock.module` in Bun für den
   * ganzen Lauf gilt, hätte so ein globaler Ersatz sonst den Tests, die die
   * echten Aktionen prüfen (`tests/verwaltung-aktionen.test.ts`), die Aktionen
   * unter den Füßen weggezogen. Genau das ist passiert.
   */
  aktion: EntzugsAktion;
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
 * Die Aussage ist für jede Zeile dieselbe, weil die Wirkung dieselbe ist:
 * `entzieheZugang` streicht die Freischaltung **und** beendet die Sitzungen,
 * und das Sitzungs-Gate in `src/lib/auth.ts` prüft die Liste bei jeder
 * Anmeldung. Früher galt hier eine Einschränkung — ein bestehendes Konto
 * überlebte den Entzug —, die es nicht mehr gibt; ein Satz, der sie noch
 * andeutete, wäre jetzt seinerseits falsch.
 *
 * Ob ein Konto besteht, steht weiterhin in der Zeile, aber nur noch als
 * Auskunft: Es ändert nichts mehr daran, ob jemand ausgesperrt wird, nur
 * daran, ob es eine laufende Anmeldung zu beenden gibt.
 *
 * Der Wahrheitsgehalt dieses Satzes hängt am Sitzungs-Gate. Fällt das weg,
 * schlägt „Entzug sperrt wirklich aus" in `tests/auth-gate.test.ts` fehl —
 * das ist die Klammer, die Text und Mechanik zusammenhält.
 */
export function ZugangsZeile({
  email,
  seit,
  hatKonto,
  istBetreiber,
  istManSelbst,
  aktion,
}: Eigenschaften) {
  const [fragt, setFragt] = useState(false);
  const [zustand, absenden] = useActionState(aktion, KEIN_ENTZUGSFEHLER);
  const folgenId = useId();

  const ausloeser = useRef<HTMLButtonElement>(null);
  const bestaetigung = useRef<HTMLButtonElement>(null);
  /*
   * Nur bei einem *bewussten* Abbruch soll der Fokus zurückspringen. Ohne
   * diese Merkmarke zöge die Zeile den Fokus auch beim ersten Aufbau an sich,
   * wenn irgendwo anders auf der Seite gearbeitet wird.
   */
  const zurueckZumAusloeser = useRef(false);

  /*
   * Ohne das ist dieser Bildschirm für Tastatur und Screenreader kaputt: Der
   * Auslöser wird beim Aufklappen ausgehängt, der Fokus fällt auf
   * `document.body`, und das nächste Tab beginnt wieder ganz oben im Dokument.
   * Der Folgensatz — der eigentliche Zweck der Seite — würde nie vorgelesen,
   * weil `aria-describedby` erst zählt, wenn der Fokus die Schaltfläche
   * erreicht.
   */
  useEffect(() => {
    if (fragt) {
      bestaetigung.current?.focus();
    } else if (zurueckZumAusloeser.current) {
      zurueckZumAusloeser.current = false;
      ausloeser.current?.focus();
    }
  }, [fragt]);

  function brichAb() {
    zurueckZumAusloeser.current = true;
    setFragt(false);
  }

  return (
    <li className="py-3.5">
      {fragt ? (
        <div
          className="flex flex-col gap-3 rounded-klein bg-flaeche p-3.5"
          // Escape bricht ab — was Tastaturnutzende an dieser Stelle erwarten.
          onKeyDown={(ereignis) => {
            if (ereignis.key === "Escape") brichAb();
          }}
        >
          <p id={folgenId} className="text-sm leading-relaxed">
            <strong className="font-medium break-words">{email}</strong> kann sich danach{" "}
            <strong className="font-medium">nicht mehr anmelden</strong>.
            {hatKonto
              ? " Die laufende Anmeldung wird sofort beendet. Das Konto selbst bleibt bestehen."
              : ""}
          </p>

          <form action={absenden} className="flex flex-wrap gap-2">
            <input type="hidden" name="email" value={email} />
            <EntzugsSchaltflaeche beschreibung={folgenId} innenRef={bestaetigung} />
            <Schaltflaeche type="button" variante="neben" groesse="dicht" onClick={brichAb}>
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
            <span className="flex flex-wrap items-baseline gap-x-2 break-words">
              {email}
              {istBetreiber ? (
                <span className="rounded-klein bg-flaeche px-1.5 py-0.5 text-xs font-medium text-gedaempft">
                  Betreiber
                </span>
              ) : null}
            </span>
            <span className="text-sm text-gedaempft">
              {hatKonto ? "Konto angelegt" : "Noch nicht angemeldet"} · seit {seit}
            </span>
          </div>

          {/*
            Die eigene Zeile bekommt den Knopf gar nicht erst. Ein Selbstentzug
            beendet die eigenen Sitzungen und streicht die eigene Freischaltung;
            zurück ginge es nur von Hand in der Datenbank. `entziehe` fängt den
            Fall zusätzlich ab, falls jemand die Aktion direkt aufruft — hier
            geht es darum, gar nicht erst in die Lage zu kommen.

            Die Schaltfläche ist nicht rot. Rot wirkt, weil es selten ist —
            stünde es an jeder Zeile, wäre die Seite ein Alarmfeld und die
            Warnung im Moment der Entscheidung nichts mehr wert. Rot kommt einen
            Schritt später.

            `self-start`, damit sie auf dem Handy nicht über die ganze Breite
            läuft: In der gestapelten Ansicht würde ein vollbreites „Zugang
            entziehen" pro Zeile die Seite dominieren und der eigentlichen
            Hauptaufgabe (einladen) den Rang ablaufen.
          */}
          {istManSelbst ? (
            <span className="shrink-0 self-start text-sm text-gedaempft">Das bist du</span>
          ) : (
            <Schaltflaeche
              ref={ausloeser}
              type="button"
              variante="neben"
              groesse="dicht"
              className="shrink-0 self-start"
              onClick={() => setFragt(true)}
            >
              Zugang entziehen
              <span className="sr-only"> für {email}</span>
            </Schaltflaeche>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Eigene Komponente, weil `useFormStatus` den Zustand des **umgebenden**
 * Formulars liest und dafür innerhalb davon stehen muss.
 */
function EntzugsSchaltflaeche({
  beschreibung,
  innenRef,
}: {
  beschreibung: string;
  innenRef: RefObject<HTMLButtonElement | null>;
}) {
  const { pending } = useFormStatus();

  return (
    <Schaltflaeche
      ref={innenRef}
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

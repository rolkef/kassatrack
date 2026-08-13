"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useFormStatus } from "react-dom";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";
import type { LoeschAktion } from "./zustand";

/**
 * Ein Zettel in der Übersicht — und die Stelle, an der diese Seite ihre
 * einzige zerstörende Handlung sichtbar macht, **bevor** sie ausgeführt wird.
 *
 * Löschen läuft deshalb in zwei Schritten. Der Grund steht im Schema:
 * `shopping_list_item` hängt mit `on delete cascade` an der Liste, eine
 * gelöschte Liste nimmt also jeden Eintrag darauf mit, und zurückholen lässt
 * sich nichts — die App kennt keinen Papierkorb. Ein einziger Tap darf das
 * nicht auslösen, schon gar nicht neben einem Verweis, den derselbe Daumen
 * trifft.
 *
 * Kein modaler Dialog: Der Satz gehört an die Zeile, über die er spricht, nicht
 * in ein Fenster darüber, das man wegklickt, ohne es gelesen zu haben. Dasselbe
 * Muster wie bei `ZugangsZeile` — und aus demselben Grund ist auch hier erst
 * die **Bestätigung** rot, nicht der Auslöser: Rot wirkt, weil es selten ist.
 * Stünde es an jeder Zeile, wäre die Übersicht ein Alarmfeld und die Warnung im
 * Moment der Entscheidung nichts mehr wert.
 */
export function ListenZeile({
  id,
  name,
  loesche,
}: {
  id: string;
  name: string;
  /** Schon an diese Liste gebunden — siehe `loescheListeAktion.bind` in `page.tsx`. */
  loesche: LoeschAktion;
}) {
  const [fragt, setFragt] = useState(false);
  const folgenId = useId();

  const ausloeser = useRef<HTMLButtonElement>(null);
  const bestaetigung = useRef<HTMLButtonElement>(null);
  /*
   * Nur bei einem *bewussten* Abbruch springt der Fokus zurück. Ohne diese
   * Merkmarke zöge die Zeile ihn auch beim ersten Aufbau an sich, während
   * woanders auf der Seite gearbeitet wird.
   */
  const zurueckZumAusloeser = useRef(false);

  /*
   * Ohne das ist die Rückfrage für Tastatur und Screenreader kaputt: Der
   * Auslöser wird beim Aufklappen ausgehängt, der Fokus fällt auf
   * `document.body`, und der Folgensatz wird nie vorgelesen —
   * `aria-describedby` zählt erst, wenn der Fokus die Schaltfläche erreicht.
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

  if (fragt) {
    return (
      <li className="py-2">
        <div
          className="flex flex-col gap-3 rounded-klein bg-flaeche p-3.5"
          // Escape bricht ab — was Tastaturnutzende an dieser Stelle erwarten.
          onKeyDown={(ereignis) => {
            if (ereignis.key === "Escape") brichAb();
          }}
        >
          <p id={folgenId} className="text-sm leading-relaxed">
            <strong className="font-medium break-words">{name}</strong> verschwindet mit{" "}
            <strong className="font-medium">allem, was daraufsteht</strong>. Zurückholen lässt sich
            das nicht.
          </p>

          <form action={loesche} className="flex flex-wrap gap-2">
            <LoeschSchaltflaeche beschreibung={folgenId} innenRef={bestaetigung} />
            <Schaltflaeche type="button" variante="neben" groesse="dicht" onClick={brichAb}>
              Behalten
            </Schaltflaeche>
          </form>
        </div>
      </li>
    );
  }

  return (
    /*
      `gap-4` und nicht weniger: Der Pfeil steht am rechten Ende des Verweises
      und damit unmittelbar neben „Löschen". Bei engem Abstand las er sich im
      Browser wie ein Teil der Schaltfläche statt als Ende der Zeile, in die er
      führt.
    */
    <li className="flex items-center gap-4">
      {/*
        Der ganze Eintrag ist die Fläche, nicht nur das Wort: Getippt wird mit
        dem Daumen, und ein Ziel von der Breite eines Namens trifft man dabei
        nicht. `min-h-14` hält die Zeile auch bei kurzen Namen über der
        Daumengrenze.
      */}
      <Link
        href={`/einkaufszettel/${id}`}
        className={
          "flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 rounded-klein px-1 py-3 " +
          "transition-colors duration-150 ease-ruhig hover:bg-flaeche"
        }
      >
        <span className="text-[1.0625rem] leading-snug font-medium break-words">{name}</span>
        <Pfeil />
      </Link>

      <Schaltflaeche
        ref={ausloeser}
        type="button"
        variante="neben"
        groesse="dicht"
        className="shrink-0"
        onClick={() => setFragt(true)}
      >
        Löschen
        {/*
          Mehrere Zeilen tragen denselben Auslöser. Ohne den Namen hieße jede
          von ihnen bloß „Löschen" — in einer vorgelesenen Liste von
          Schaltflächen wäre keine von der anderen zu unterscheiden.
        */}
        <span className="sr-only"> {name}</span>
      </Schaltflaeche>
    </li>
  );
}

/**
 * Eigene Komponente, weil `useFormStatus` den Zustand des **umgebenden**
 * Formulars liest und dafür innerhalb davon stehen muss.
 */
function LoeschSchaltflaeche({
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
      Ja, Liste löschen
    </Schaltflaeche>
  );
}

function Pfeil() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-4 shrink-0 text-gedaempft"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}

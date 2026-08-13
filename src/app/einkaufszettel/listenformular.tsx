"use client";

import { useActionState, useId, useState } from "react";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";
import type { ListenAktion, ListenErgebnis } from "./zustand";

/**
 * Ein Feld und eine Schaltfläche — mehr braucht ein neuer Zettel nicht.
 *
 * Der Name steht in einem eigenen Zustand statt im DOM, und zwar wegen der
 * Rückseite dieser Entscheidung: React setzt ein Formular nach **jeder**
 * abgeschlossenen Aktion selbst zurück, auch nach einer gescheiterten. Wer
 * „Wocheneinkauf" getippt hat und eine technische Fehlermeldung bekommt, stünde
 * dann vor einem leeren Feld und tippte noch einmal. Geleert wird deshalb von
 * Hand — genau dann, wenn die Liste wirklich steht. Ohne das Leeren wiederum
 * bliebe der eben angelegte Name stehen, und der nächste Griff ergäbe
 * stillschweigend eine zweite Liste desselben Namens.
 */
export function ListenFormular({ aktion }: { aktion: ListenAktion }) {
  const feldId = useId();
  const [name, setName] = useState("");

  const [ergebnis, absenden, laeuft] = useActionState<ListenErgebnis | undefined, FormData>(
    async (vorher, formular) => {
      const antwort = await aktion(vorher, formular);
      if (antwort.art === "erfolg") setName("");
      return antwort;
    },
    undefined,
  );

  return (
    <form action={absenden} className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <label htmlFor={feldId} className="text-sm font-medium">
          Name der Liste
        </label>
        <input
          id={feldId}
          name="name"
          type="text"
          value={name}
          onChange={(vorgang) => setName(vorgang.target.value)}
          placeholder="z. B. Wocheneinkauf"
          autoComplete="off"
          autoCapitalize="sentences"
          spellCheck={false}
          aria-invalid={ergebnis?.art === "fehler" ? true : undefined}
          className={
            "min-h-14 w-full rounded-klein border border-linie-stark bg-hintergrund px-3.5 " +
            // 16 px sind die Untergrenze, ab der iOS beim Hineintippen nicht
            // mehr in das Feld hineinzoomt. Darunter verrutscht die ganze Seite.
            "text-base placeholder:text-gedaempft aria-[invalid=true]:border-fehler"
          }
        />
        {ergebnis?.art === "fehler" ? (
          <p role="alert" className="text-[0.8125rem] leading-snug text-fehler">
            {ergebnis.meldung}
          </p>
        ) : null}
      </div>

      {/*
        Am Handy unter dem Feld über die volle Breite, ab `sm` daneben — und dort
        um die Höhe des Etiketts nach unten gerückt, damit ihre Oberkante mit der
        des Feldes fluchtet statt mit der Beschriftung darüber.
      */}
      <Schaltflaeche type="submit" laedt={laeuft} className="sm:mt-[1.75rem] sm:w-auto sm:shrink-0">
        Liste anlegen
      </Schaltflaeche>
    </form>
  );
}

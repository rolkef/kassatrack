"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { erzeugeListe, loescheListe } from "@/lib/einkaufszettel";
import { requireUser } from "@/lib/sitzung";
import type { ListenErgebnis } from "./zustand";

/*
 * Die beiden Aktionen der Zettel-Übersicht.
 *
 * `requireUser()` steht in beiden als **erste** Anweisung und außerhalb jedes
 * `try`. Zwei Gründe, wie in `src/app/erfassen/aktionen.ts`: Server-Aktionen
 * sind eigene Endpunkte und über ihre Kennung ohne die zugehörige Seite
 * aufrufbar — eine Prüfung nur in `page.tsx` schützt sie nicht. Und ohne
 * Sitzung arbeitet `requireUser` über `redirect`, also über einen geworfenen
 * Sonderfehler; gefangen und in eine Meldung verwandelt, bliebe die
 * Weiterleitung aus und man stünde vor einem Formular, das unerklärlich nichts
 * tut.
 *
 * Wem eine Liste „gehört", fragt hier bewusst niemand: KassaTrack ist eine
 * Haushalts-App ohne Besitzbegriff. Wer freigeschaltet ist, sieht und ändert
 * jedes Produkt und jeden Preis — für Zettel gilt dasselbe.
 */

export async function erzeugeListeAktion(
  _vorher: ListenErgebnis | undefined,
  formular: FormData,
): Promise<ListenErgebnis> {
  await requireUser();

  const name = String(formular.get("name") ?? "").trim();
  if (name === "") {
    return { art: "fehler", meldung: "Gib der Liste einen Namen — zum Beispiel „Wocheneinkauf“." };
  }

  let id: string;
  try {
    id = (await erzeugeListe(db, name)).id;
  } catch (ursache) {
    console.error("Liste konnte nicht angelegt werden:", ursache);
    return {
      art: "fehler",
      meldung: "Die Liste ließ sich nicht anlegen. Versuch es noch einmal.",
    };
  }

  /*
   * Eigenes `catch`, wie bei `erfasse`: Ab hier steht die Liste in der
   * Datenbank. Läge der Aufruf im `try` oben, machte ein Fehler beim Verwerfen
   * des Zwischenspeichers aus einem gelungenen Anlegen die Meldung „ließ sich
   * nicht anlegen" — und die zweite Eingabe ergäbe eine zweite Liste desselben
   * Namens.
   */
  try {
    revalidatePath("/einkaufszettel");
  } catch (ursache) {
    console.error("Zettel-Übersicht konnte nicht neu erzeugt werden:", ursache);
  }

  return { art: "erfolg", id };
}

export async function loescheListeAktion(id: string): Promise<void> {
  await requireUser();
  await loescheListe(db, id);
  revalidatePath("/einkaufszettel");
}

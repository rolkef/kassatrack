"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  aendereStueckzahl,
  entferneArtikel,
  fuegeFreitextArtikelHinzu,
  fuegeKatalogArtikelHinzu,
} from "@/lib/einkaufszettel";
import { sucheProdukte, type Produkt } from "@/lib/katalog";
import { requireUser } from "@/lib/sitzung";
import { STUECKZAHL_OBERGRENZE } from "./zustand";

/*
 * Die vier Aktionen des Listendetails.
 *
 * `requireUser()` steht in allen als **erste** Anweisung, wie in
 * `src/app/einkaufszettel/aktionen.ts`: Server-Aktionen sind eigene Endpunkte
 * und über ihre Kennung ohne die zugehörige Seite aufrufbar — eine Prüfung
 * nur in `page.tsx` schützt sie nicht.
 *
 * Wem ein Zettel „gehört", fragt hier bewusst niemand: KassaTrack ist eine
 * Haushalts-App ohne Besitzbegriff. Wer freigeschaltet ist, sieht und ändert
 * jedes Produkt und jeden Preis — für Zettel gilt dasselbe.
 *
 * Alle drei schreibenden Aktionen verwerfen den Zwischenspeicher der Seite.
 * `stueckzahlAktion` und `entferneArtikelAktion` bekommen die `listId`
 * ausschließlich dafür — sie brauchen sie zum Schreiben nicht, die
 * Artikelkennung genügt. Ohne das Verwerfen liefe die Anzeige auseinander:
 * `ZettelDetail` zeigt die Änderung sofort und gibt sie mit dem Ende des
 * Übergangs wieder frei (`useOptimistic`), und was dann sichtbar wird, sind
 * die Daten aus dem Server-Durchlauf. Wären die noch die alten, spränge die
 * eben erhöhte Stückzahl vor den Augen zurück. Der Optimierer aus Task 8
 * rechnet zudem mit genau diesen Stückzahlen; eine nicht verworfene Seite
 * zeigte danach eine Summe, die zur Liste darüber nicht passt.
 */

/**
 * Gemeinsame Prüfung für alles, was in `shopping_list_item.stueckzahl`
 * landet. Die Spalte ist `integer` mit der Bedingung `stueckzahl > 0`; ohne
 * diese Prüfung käme eine gebrochene, negative oder zu große Zahl bis dorthin
 * durch und bräche als technischer Datenbankfehler ab.
 */
function gepruefteStueckzahl(stueckzahl: number): number {
  if (
    !Number.isInteger(stueckzahl) ||
    stueckzahl < 1 ||
    stueckzahl > STUECKZAHL_OBERGRENZE
  ) {
    throw new Error(
      `Stückzahl muss eine ganze Zahl zwischen 1 und ${STUECKZAHL_OBERGRENZE} sein, war aber ${stueckzahl}.`,
    );
  }
  return stueckzahl;
}

export async function artikelHinzufuegenAktion(eingabe: {
  listId: string;
  produktId?: string;
  freitext?: string;
  stueckzahl?: number;
}): Promise<void> {
  await requireUser();

  const freitext = eingabe.freitext?.trim() ?? "";
  const stueckzahl = gepruefteStueckzahl(eingabe.stueckzahl ?? 1);

  /*
   * Beides zugleich weist die Datenbankbedingung `genau_eine_quelle` ohnehin
   * ab — aber erst, nachdem hier eines von beidem stillschweigend gewonnen
   * hätte. Ein Aufruf mit beidem ist eine Verwechslung des Aufrufers, keine
   * Absicht, und wird als solche beantwortet.
   */
  if (eingabe.produktId && freitext !== "") {
    throw new Error("Ein Artikel trägt entweder ein Produkt oder einen Freitext, nie beides.");
  }

  if (eingabe.produktId) {
    await fuegeKatalogArtikelHinzu(db, eingabe.listId, eingabe.produktId, stueckzahl);
  } else if (freitext !== "") {
    await fuegeFreitextArtikelHinzu(db, eingabe.listId, freitext, stueckzahl);
  } else {
    /*
     * Auch ein Freitext aus lauter Leerzeichen landet hier. Die
     * Datenbankbedingung fängt den **nicht** ab: Sie prüft auf `not null`,
     * und "" ist nicht null. Auf dem Zettel stünde sonst eine Zeile ohne
     * jeden Text, die niemand mehr zuordnen kann.
     */
    throw new Error("Ein Artikel braucht entweder ein Produkt oder einen Freitext.");
  }

  /*
   * Eigenes `catch`, wie bei `erzeugeListeAktion`: Ab hier steht der Artikel
   * in der Datenbank. Käme ein Fehler beim Verwerfen des Zwischenspeichers
   * bis zur Oberfläche durch, sähe der gelungene Aufruf wie ein
   * fehlgeschlagener aus — und der zweite Griff ergäbe denselben Artikel ein
   * zweites Mal. Bei den beiden Aktionen darunter ist das gefahrlos: Eine
   * wiederholte Stückzahl oder ein wiederholtes Entfernen ändert nichts.
   */
  try {
    revalidatePath(`/einkaufszettel/${eingabe.listId}`);
  } catch (ursache) {
    console.error("Zettel konnte nach dem Hinzufügen nicht neu erzeugt werden:", ursache);
  }
}

export async function stueckzahlAktion(
  itemId: string,
  stueckzahl: number,
  listId: string,
): Promise<void> {
  await requireUser();
  await aendereStueckzahl(db, itemId, gepruefteStueckzahl(stueckzahl));
  revalidatePath(`/einkaufszettel/${listId}`);
}

export async function entferneArtikelAktion(itemId: string, listId: string): Promise<void> {
  await requireUser();
  await entferneArtikel(db, itemId);
  revalidatePath(`/einkaufszettel/${listId}`);
}

export async function sucheProdukteAktion(begriff: string): Promise<Produkt[]> {
  await requireUser();
  return sucheProdukte(db, begriff);
}

"use server";

import { db } from "@/db";
import { holeProdukt, legeProduktAn, sucheProdukte, type Produkt } from "@/lib/katalog";
import { holeOffProdukt } from "@/lib/open-food-facts";
import { ladeUndSpeichereBild } from "@/lib/produktbilder";
import { findeProduktPerEan, verknuepfeEan } from "@/lib/produkt-ean";
import { requireUser } from "@/lib/sitzung";
import type { EanErgebnis, NeuesProdukt } from "./ean-zustand";

/**
 * Löst eine gescannte EAN auf. Drei Stufen, in dieser Reihenfolge:
 *
 * 1. `product_ean` kennt sie bereits — schnellster und einziger sicherer Weg.
 * 2. Open Food Facts kennt sie — liefert einen Vorschlag samt Ähnlichkeitssuche
 *    gegen den eigenen Katalog, damit „Butter 250 g" nicht doppelt entsteht,
 *    nur weil sie diesmal über einen Scan statt von Hand hereinkommt.
 * 3. Weder noch — die Oberfläche fällt auf die unveränderte manuelle
 *    Eingabe zurück.
 */
export async function loeseEanAuf(ean: string): Promise<EanErgebnis> {
  await requireUser();

  const bekannt = await findeProduktPerEan(db, ean);
  if (bekannt) return { art: "bekannt", produkt: bekannt };

  const kandidat = await holeOffProdukt(ean, fetch);
  if (!kandidat) return { art: "unbekannt" };

  const aehnliche = await sucheProdukte(db, kandidat.name);
  return { art: "vorschlag", kandidat, ean, aehnliche };
}

/**
 * Schließt eine Auflösung ab: entweder wird die EAN mit einem bestehenden
 * Produkt verknüpft, oder ein neues entsteht und wird verknüpft. In beiden
 * Fällen wird — falls vorhanden und das Produkt noch kein Bild trägt — das
 * Bild geladen. Ein Fehlschlag dabei ist nicht fatal (siehe
 * `ladeUndSpeichereBild`) und wird hier nicht weiter behandelt.
 */
export async function bestaetigeZuordnung(eingabe: {
  ean: string;
  produktId?: string;
  neu?: NeuesProdukt;
  bildUrl?: string | null;
}): Promise<Produkt> {
  await requireUser();

  /*
   * Erst prüfen, ob die EAN schon verknüpft ist — unabhängig davon, ob
   * `produktId` oder `neu` hereinkommt. Ohne diese Prüfung legte ein zweiter
   * Aufruf mit `neu` für dieselbe EAN ein zweites Produkt an: `verknuepfeEan`
   * schlägt zwar über `onConflictDoNothing` fehl und lässt die bestehende
   * Zuordnung stehen, das frisch angelegte Produkt bliebe aber als Leiche im
   * Katalog zurück.
   */
  let produkt: Produkt;
  const bereitsVerknuepft = await findeProduktPerEan(db, eingabe.ean);
  if (bereitsVerknuepft) {
    produkt = bereitsVerknuepft;
  } else if (eingabe.produktId) {
    const bestehend = await holeProdukt(db, eingabe.produktId);
    if (!bestehend) throw new Error(`Produkt ${eingabe.produktId} existiert nicht.`);
    produkt = bestehend;
  } else if (eingabe.neu) {
    produkt = await legeProduktAn(db, eingabe.neu);
  } else {
    throw new Error("Weder produktId noch neu übergeben.");
  }

  await verknuepfeEan(db, produkt.id, eingabe.ean);

  if (!produkt.bildSchluessel && eingabe.bildUrl) {
    const schluessel = await ladeUndSpeichereBild(db, produkt.id, eingabe.ean, eingabe.bildUrl, fetch);
    if (schluessel) produkt = { ...produkt, bildSchluessel: schluessel };
  }

  return produkt;
}

"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { findeProdukt, legeProduktAn, sucheProdukte, type Produkt } from "@/lib/katalog";
import { bestaetigeZuordnung, holeUngeklaerte, verwerfeUngeklaert } from "@/lib/ketten-abgleich";
import { requireUser } from "@/lib/sitzung";
import type { Ergebnis } from "./zustand";

/*
 * Die Aktionen der Prüfliste. Sie enthalten selbst keine Fachlogik: Zuordnen,
 * Anlegen und Verwerfen stehen in `@/lib/ketten-abgleich` und `@/lib/katalog`
 * und sind dort gegen eine echte Datenbank geprüft. Was hier passiert, ist
 * Anmeldung prüfen, den Eintrag nachschlagen und den Zwischenspeicher der
 * Seite verwerfen.
 *
 * Jede Aktion prüft die Anmeldung selbst. Server-Aktionen sind eigene
 * Endpunkte und über ihre Kennung auch ohne diese Seite aufrufbar — eine
 * Prüfung, die nur in `page.tsx` stünde, wäre keine.
 */

const NICHT_MEHR_DA = "Dieser Eintrag ist nicht mehr offen — vielleicht in einem anderen Reiter.";

/**
 * Der Eintrag zu einer Kennung, oder `null`.
 *
 * Liest die ganze (kurze) Prüfliste statt gezielt zu selektieren: Die Liste
 * ist der Arbeitsvorrat eines Menschen und damit klein, und so bleibt der
 * Zugriff auf `chain_sync_ungeklaert` an einer einzigen Stelle in
 * `@/lib/ketten-abgleich`. Wächst sie je über ein paar hundert Zeilen, gehört
 * eine gezielte Abfrage dorthin — nicht hierher.
 */
async function holeEintragOderNull(ungeklaertId: string) {
  const liste = await holeUngeklaerte(db);
  return liste.find((eintrag) => eintrag.id === ungeklaertId) ?? null;
}

export async function ordneBestehendemProduktZu(
  ungeklaertId: string,
  productId: string,
): Promise<Ergebnis> {
  await requireUser();

  const eintrag = await holeEintragOderNull(ungeklaertId);
  if (!eintrag) return { erfolg: false, meldung: NICHT_MEHR_DA };

  await bestaetigeZuordnung(db, {
    ungeklaertId,
    chainId: eintrag.chainId,
    feedId: eintrag.feedId,
    rohname: eintrag.rohname,
    productId,
  });

  revalidatePath("/produkte/abgleich");
  return { erfolg: true };
}

/**
 * Legt das Produkt an und bestätigt die Zuordnung in einem Zug.
 *
 * Menge und Einheit kommen aus dem Prüflisten-Eintrag und nicht aus dem
 * Formular: Sie sind die Angabe des Feeds und zugleich das Merkmal, an dem
 * `findeProdukt` „Butter 250 g" von „Butter 500 g" unterscheidet. Ließe man
 * sie eintippen, entstünde ein Produkt, dessen Gebinde nicht zu den Preisen
 * passt, die gleich darunter geschrieben werden.
 */
export async function legeAlsNeuesProduktAn(
  ungeklaertId: string,
  eingabe: { name: string; marke: string | null },
): Promise<Ergebnis> {
  await requireUser();

  const eintrag = await holeEintragOderNull(ungeklaertId);
  if (!eintrag) return { erfolg: false, meldung: NICHT_MEHR_DA };

  const name = eingabe.name.trim();
  if (name === "") {
    return { erfolg: false, meldung: "Ohne Namen lässt sich kein Produkt anlegen." };
  }

  /*
   * Erst suchen, dann anlegen — dieselbe Reihenfolge wie auf dem
   * Erfassungspfad (`src/app/erfassen/aktionen.ts`).
   *
   * „Als neues Produkt anlegen" ist die Absicht der Person, nicht die
   * Tatsache: Wer hier „Butter" tippt, weiß nicht unbedingt, dass es Butter
   * mit derselben Marke und demselben Gebinde schon gibt. Ohne diese Prüfung
   * entstünde ein zweites Produkt, und die Preisgeschichte der Ware zerfiele
   * still in zwei Hälften — mit je einer halb gefüllten Preismatrix. Genau
   * der Schaden, gegen den `findeProdukt` geschrieben ist.
   *
   * Menge und Einheit gehen ungeprüft aus dem Prüflisten-Eintrag ein und
   * trennen dabei mit: „Butter 250 g" und „Butter 500 g" bleiben zwei Waren.
   */
  const eingabeProdukt = {
    name,
    marke: eingabe.marke,
    menge: eintrag.menge,
    einheit: eintrag.einheit,
  };

  /*
   * In einer Transaktion, wie derselbe Ablauf auf dem Erfassungspfad: Bricht
   * es zwischen Anlegen und Zuordnen ab, bliebe sonst ein Produkt ohne jede
   * Ketten-Zuordnung im Katalog stehen — mit leerer Preismatrix und ohne
   * Prüflisten-Eintrag, der es je wieder anfassen würde.
   */
  await db.transaction(async (tx) => {
    const produkt = (await findeProdukt(tx, eingabeProdukt)) ?? (await legeProduktAn(tx, eingabeProdukt));

    await bestaetigeZuordnung(tx, {
      ungeklaertId,
      chainId: eintrag.chainId,
      feedId: eintrag.feedId,
      rohname: eintrag.rohname,
      productId: produkt.id,
    });
  });

  revalidatePath("/produkte/abgleich");
  return { erfolg: true };
}

/**
 * Nimmt den Eintrag von der Liste, ohne etwas zuzuordnen.
 *
 * Bewusst ohne Rückfrage und ohne rote Schaltfläche: Der Eintrag ist nicht
 * fort. `fuehreSyncAus` meldet jeden Artikel, der sich nicht von selbst
 * zuordnen lässt, bei jedem Lauf erneut über `meldeUngeklaert` — solange er
 * im Feed steht und kein Produkt trifft, steht er morgen wieder hier. Das ist
 * ein „nicht jetzt", keine Zerstörung, und `--color-fehler` ist in dieser App
 * ausdrücklich der Zerstörung vorbehalten.
 */
export async function verwerfe(ungeklaertId: string): Promise<void> {
  await requireUser();
  await verwerfeUngeklaert(db, ungeklaertId);
  revalidatePath("/produkte/abgleich");
}

export async function sucheKatalog(begriff: string): Promise<Produkt[]> {
  await requireUser();
  return sucheProdukte(db, begriff);
}

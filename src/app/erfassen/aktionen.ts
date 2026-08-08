"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { formatiereGrundpreis, grundpreis, zerlegeMenge, zerlegePreis } from "@/lib/einheiten";
import { findeProdukt, holeKetten, legeProduktAn, sichereKettenProdukt } from "@/lib/katalog";
import { schreibeBeobachtung } from "@/lib/preise";
import { requireUser } from "@/lib/sitzung";
import { istPreisart, type Ergebnis } from "./zustand";

/*
 * Der einzige Weg, auf dem in Plan 2 Daten in KassaTrack kommen.
 *
 * Zwei Zusagen trägt diese Datei, und beide sind in
 * `tests/erfassen-aktionen.test.ts` festgenagelt:
 *
 * Erstens wird **vor jedem Schreibvorgang vollständig geprüft**. Eine
 * abgewiesene Eingabe hinterlässt kein Geisterprodukt im Katalog und keine
 * halbe Zuordnung — die Tests zählen nach jeder Abweisung alle drei Tabellen
 * und nicht nur die Beobachtungen. Wer hier eine Prüfung nach hinten schiebt,
 * bricht das.
 *
 * Zweitens steht `requireUser()` als erste Anweisung. Server-Aktionen sind
 * eigene Endpunkte und über ihre Kennung ohne die zugehörige Seite aufrufbar;
 * eine Prüfung nur in `page.tsx` schützt sie nicht.
 */

function fehler(meldung: string): Ergebnis {
  return { art: "fehler", meldung };
}

export async function erfasse(_vorher: Ergebnis | undefined, formular: FormData): Promise<Ergebnis> {
  /*
   * Steht bewusst außerhalb des `try` weiter unten: Ohne Sitzung ruft
   * `requireUser` `redirect("/anmelden")` auf, und `redirect` arbeitet über
   * einen geworfenen Sonderfehler. Gefangen und in eine Meldung verwandelt,
   * bliebe die Weiterleitung aus und man stünde vor einem Formular, das
   * unerklärlich nichts tut.
   */
  await requireUser();

  const kuerzel = String(formular.get("kette") ?? "").trim();
  const name = String(formular.get("name") ?? "").trim();
  const marke = String(formular.get("marke") ?? "").trim();
  const preisart = String(formular.get("preisart") ?? "");
  const gueltigBis = String(formular.get("gueltigBis") ?? "").trim();

  if (name === "") {
    return fehler("Trag ein, um welches Produkt es geht — so, wie es am Etikett steht.");
  }

  const menge = zerlegeMenge(String(formular.get("menge") ?? ""));
  if (!menge) {
    return fehler(
      "Diese Mengenangabe versteht KassaTrack nicht. Schreib sie wie am Etikett: 250 g, 1,5 l oder 6 Stk.",
    );
  }

  const preis = zerlegePreis(String(formular.get("preis") ?? ""));
  if (preis === null) {
    return fehler("Der Preis muss eine Zahl über null sein — zum Beispiel 2,49.");
  }

  if (!istPreisart(preisart)) {
    return fehler("Diese Preisart kennt KassaTrack nicht.");
  }

  /*
   * Ohne Ende wäre eine Aktion kein Sonderfall, sondern der neue Normalpreis —
   * die Datenbank besteht seit Task 4 über `preis_aktion_hat_ende` darauf. Die
   * Prüfung hier gibt es, damit daraus ein Satz wird und kein technischer
   * Fehler.
   */
  let aktionGueltigBis: Date | null = null;
  if (preisart === "PROMO") {
    if (gueltigBis === "") {
      return fehler(
        "Eine Aktion braucht ein Ende. Trag ein, bis wann sie gilt — sonst wäre es der neue Normalpreis.",
      );
    }
    // Bis zum Ende des Tages: Wer „gilt bis 31.12." liest, meint diesen Tag
    // einschließlich. Mitternacht als Grenze schnitte ihn weg.
    const ende = new Date(`${gueltigBis}T23:59:59`);
    if (Number.isNaN(ende.getTime())) {
      return fehler("Dieses Datum lässt sich nicht lesen. Erwartet wird ein Tag aus dem Kalender.");
    }
    aktionGueltigBis = ende;
  }

  const kette = (await holeKetten(db)).find((eintrag) => eintrag.kuerzel === kuerzel);
  if (!kette) {
    return fehler("Wähl die Kette, in der du den Preis gesehen hast.");
  }

  // `grundpreis` liefert `null` bei Werten, die hier nicht mehr auftreten
  // können. Die Prüfung steht trotzdem: Sie ist die Stelle, an der der Typ
  // eingelöst wird, statt `null!` in die Datenbank zu schieben.
  const wert = grundpreis(preis, menge);
  if (wert === null) {
    return fehler("Aus diesem Preis und dieser Menge lässt sich kein Grundpreis rechnen.");
  }

  try {
    const vorhanden = await findeProdukt(db, {
      name,
      marke: marke || null,
      menge: menge.wert,
      einheit: menge.einheit,
    });

    const produkt =
      vorhanden ??
      (await legeProduktAn(db, {
        name,
        marke: marke || null,
        menge: menge.wert,
        einheit: menge.einheit,
      }));

    const storeProductId = await sichereKettenProdukt(db, {
      chainId: kette.id,
      productId: produkt.id,
    });

    await schreibeBeobachtung(db, {
      storeProductId,
      chainId: kette.id,
      productId: produkt.id,
      quelle: "MANUAL",
      preisart,
      /*
       * Einzelpreis und Zeilensumme sind hier dasselbe, und `menge` ist 1:
       * Erfasst wird ein Regalpreis, kein Beleg mit mehreren Packungen
       * derselben Ware. Die Unterscheidung bekommt erst die Belegerkennung in
       * Plan 4 mit Inhalt; die Spalten stehen schon, damit sie dann nicht
       * nachträglich befüllt werden müssen.
       */
      einzelpreis: preis,
      menge: 1,
      zeilensumme: preis,
      grundpreis: wert,
      aktionGueltigBis,
    });

    // Die Produktseite entsteht in Task 8. Der Aufruf steht schon hier, weil
    // eine neue Beobachtung genau diese Seite veraltet — und weil er nichts
    // kostet, solange es die Route noch nicht gibt.
    revalidatePath(`/produkte/${produkt.id}`);

    return {
      art: "erfolg",
      produktId: produkt.id,
      grundpreis: formatiereGrundpreis(wert, menge.einheit),
    };
  } catch (ursache) {
    console.error("Preis konnte nicht erfasst werden:", ursache);
    return fehler(
      "Der Preis ließ sich nicht speichern. Versuch es noch einmal — die Eingaben bleiben stehen.",
    );
  }
}

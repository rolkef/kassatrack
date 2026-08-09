"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  formatiereGrundpreis,
  GRUNDPREIS_OBERGRENZE,
  GRUNDPREIS_UNTERGRENZE,
  grundpreis,
  zerlegeMenge,
  zerlegePreis,
} from "@/lib/einheiten";
import { findeProdukt, holeKetten, legeProduktAn, sichereKettenProdukt } from "@/lib/katalog";
import { schreibeAngebot, schreibeBeobachtung } from "@/lib/preise";
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
    return fehler(
      "Der Preis muss eine Zahl zwischen 0,01 und 99.999,99 sein — zum Beispiel 2,49.",
    );
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
    /*
     * Ein Ende in der Vergangenheit hat zwei Gründe, abgelehnt zu werden. Der
     * kleinere: Eine abgelaufene Aktion beantwortet die Frage „ist das gerade
     * billig" nicht mehr. Der größere: Die Angebotszeile unten läuft von
     * *jetzt* bis zu diesem Ende und bräche an der Bedingung `offer_zeitraum`
     * ab — mitten in der Transaktion, als technischer Fehler statt als Satz.
     * Weil das Ende auf 23:59:59 des gewählten Tages fällt, bleibt der heutige
     * Tag zulässig.
     */
    if (ende.getTime() <= Date.now()) {
      return fehler(
        "Dieses Datum liegt in der Vergangenheit. Trag ein, bis wann die Aktion noch gilt — " +
          "eine abgelaufene sagt über den heutigen Preis nichts mehr.",
      );
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
  /*
   * Eine sehr kleine Menge zu einem sehr großen Preis sprengt die Spalte,
   * obwohl beide Werte für sich zulässig sind — 99.999 € auf ein Gramm sind
   * knapp 100 Millionen je Kilo. Maßgeblich ist dabei die engere der beiden
   * Spalten, in denen ein Grundpreis landet (`offer.preis`, `numeric(10,4)`);
   * die Begründung steht bei `GRUNDPREIS_OBERGRENZE`. Ohne diese Prüfung
   * hinge es an der Preisart, ob dieselbe Eingabe durchgeht.
   */
  if (wert >= GRUNDPREIS_OBERGRENZE) {
    return fehler(
      "Aus diesem Preis und dieser Menge ergäbe sich ein Grundpreis, den KassaTrack nicht " +
        "abbilden kann. Prüf, ob Menge und Preis zusammenpassen.",
    );
  }
  /*
   * Dasselbe am anderen Ende: Ein sehr kleiner Preis auf eine sehr große Menge
   * ergibt einen Grundpreis unterhalb der vierten Nachkommastelle. Der wird
   * beim Schreiben auf 0,0000 gerundet und läuft in `preis_positiv` — wieder
   * ein technischer Fehler, wo ein Satz hingehört. Die Begründung für die
   * Grenze steht bei `GRUNDPREIS_UNTERGRENZE`.
   */
  if (wert < GRUNDPREIS_UNTERGRENZE) {
    return fehler(
      "Aus diesem Preis und dieser Menge ergäbe sich ein Grundpreis von null. Prüf die Menge — " +
        "sie ist im Verhältnis zum Preis zu groß.",
    );
  }

  /*
   * Alle Schreibvorgänge in **einer** Transaktion.
   *
   * Der Grund ist nicht Ordnungsliebe, sondern der Median. Bräche etwa das
   * Angebot ab, nachdem die Beobachtung schon steht, meldete die Oberfläche
   * „nicht gespeichert" — obwohl der Preis liegt. Der Nutzer schickte noch
   * einmal, und die zweite Beobachtung verschöbe den Referenzpreis dieser
   * Kette. Dieselbe Überlegung deckt Produkt und Ketten-Zuordnung mit ab: Ein
   * unerwarteter Abbruch hinterlässt sonst ein Produkt ohne einen einzigen
   * Preis im Katalog, das niemand mehr zuordnen kann.
   */
  let produktId: string;
  try {
    produktId = await db.transaction(async (tx) => {
      const vorhanden = await findeProdukt(tx, {
        name,
        marke: marke || null,
        menge: menge.wert,
        einheit: menge.einheit,
      });

      const produkt =
        vorhanden ??
        (await legeProduktAn(tx, {
          name,
          marke: marke || null,
          menge: menge.wert,
          einheit: menge.einheit,
        }));

      const storeProductId = await sichereKettenProdukt(tx, {
        chainId: kette.id,
        productId: produkt.id,
      });

      await schreibeBeobachtung(tx, {
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

      /*
       * Die Beobachtung allein macht aus einer Aktion noch nichts Sichtbares:
       * `holePreisMatrix` schließt `PROMO` beim Referenzpreis ausdrücklich aus
       * und liest den laufenden Aktionspreis allein aus `offer`. Ohne diese
       * Zeile hätte „Aktion" ankreuzen gar keine Wirkung — und genau das ist
       * der Fall, für den Christopher die App gebaut hat: heute bei Hofer
       * billiger als sonst irgendwo.
       *
       * Nur `PROMO`. „Treuekarte" und „Mengenrabatt" sind an eine Bedingung
       * geknüpft, die nicht für jeden gilt; sie als laufenden Bestpreis
       * auszugeben, wäre eine Aussage über einen Preis, den man an der Kassa
       * womöglich nicht bekommt.
       */
      if (preisart === "PROMO" && aktionGueltigBis) {
        await schreibeAngebot(tx, {
          storeProductId,
          /*
           * Der **Grundpreis**, nicht der Regalpreis — nachgemessen an dem, was
           * `holePreisMatrix` damit tut: Es bildet `Math.min(aktion.preis,
           * referenzpreis)`, und `referenzpreis` ist der Median über
           * `price_observation.grundpreis`, also €/kg. Task 6 rechnet in
           * derselben Einheit (`tests/preise.test.ts:141-154` paart eine
           * Beobachtung mit `grundpreis: 11.16` mit einem Angebot zu `8.76` —
           * das sind 2,19 € je 250 g). Stünde hier der Regalpreis, vergliche
           * die Bestpreis-Rechnung 1,49 € mit 9,96 €/kg: Jede Aktion sähe nach
           * einem Jahrhundertangebot aus, und die Zahl, die als Bestpreis
           * ausgegeben wird, bedeutete gar nichts.
           */
          preis: wert,
          gueltigVon: new Date(),
          gueltigBis: aktionGueltigBis,
          quelle: "MANUAL",
        });
      }

      return produkt.id;
    });
  } catch (ursache) {
    console.error("Preis konnte nicht erfasst werden:", ursache);
    return fehler(
      "Der Preis ließ sich nicht speichern. Versuch es noch einmal — die Eingaben bleiben stehen.",
    );
  }

  /*
   * Ab hier steht der Preis in der Datenbank, und das darf keine Zeile mehr
   * widerrufen. Deshalb hat `revalidatePath` sein eigenes `catch`: Läge es im
   * `try` oben, machte ein Fehler beim Verwerfen des Zwischenspeichers aus
   * einem gelungenen Speichern die Meldung „nicht gespeichert" — der Nutzer
   * schickte noch einmal, und die doppelte Beobachtung verschöbe den Median.
   *
   * Die Produktseite entsteht erst in Task 8; solange es die Route nicht gibt,
   * kostet der Aufruf nichts.
   */
  try {
    revalidatePath(`/produkte/${produktId}`);
  } catch (ursache) {
    console.error("Produktseite konnte nicht neu erzeugt werden:", ursache);
  }

  return {
    art: "erfolg",
    produktId,
    grundpreis: formatiereGrundpreis(wert, menge.einheit),
  };
}

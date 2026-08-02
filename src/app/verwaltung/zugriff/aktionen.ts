"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { env } from "@/lib/env";
import { entzieheZugang, erzeugeEinladung } from "@/lib/einladung";
import { requireBetreiber } from "@/lib/sitzung";
import { NichtBetreiber, normalisiereEmail } from "@/lib/zugriff";
import {
  formatiereDatum,
  KEIN_ENTZUGSFEHLER,
  type EinladungsZustand,
  type EntzugsZustand,
} from "./zustand";

const PFAD = "/verwaltung/zugriff";

/*
 * Beide Aktionen beginnen mit `requireBetreiber()` — angemeldet **und**
 * berechtigt. Das ist keine Höflichkeit: Server-Aktionen sind eigene Endpunkte
 * und über ihre Kennung von außen aufrufbar, ganz ohne die Seite, auf der sie
 * stehen. Wer sich hier auf die Prüfung in `page.tsx` verließe, hätte eine
 * offene Schnittstelle zum Freischalten beliebiger Adressen — und, seit ein
 * Entzug wirklich aussperrt, auch eine zum Aussperren der betreibenden Person.
 */

/** Was jemand zu sehen bekommt, der angemeldet, aber nicht berechtigt ist. */
const NICHT_BERECHTIGT =
  "Nur die betreibende Person kann Zugänge verwalten. Wende dich an sie, wenn hier etwas geändert werden soll.";

/**
 * Grobe Formprüfung, bewusst großzügig. Ob eine Adresse wirklich zustellbar
 * ist, weiß ohnehin erst der Anmeldeversuch — hier geht es nur darum, einen
 * Tippfehler abzufangen, bevor er als freigeschaltete Adresse in der Liste
 * steht.
 */
const SIEHT_AUS_WIE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function ladeEin(
  _vorher: EinladungsZustand,
  formular: FormData,
): Promise<EinladungsZustand> {
  let benutzer;
  try {
    benutzer = await requireBetreiber();
  } catch (fehler) {
    if (fehler instanceof NichtBetreiber) return { art: "fehler", text: NICHT_BERECHTIGT };
    throw fehler;
  }

  const email = normalisiereEmail(String(formular.get("email") ?? ""));

  if (email === "") {
    return { art: "fehler", text: "Bitte eine E-Mail-Adresse eintragen." };
  }
  if (!SIEHT_AUS_WIE_EMAIL.test(email)) {
    return {
      art: "fehler",
      text: "Das sieht nicht nach einer E-Mail-Adresse aus. Beispiel: name@example.at",
    };
  }

  try {
    const { token, gueltigBis } = await erzeugeEinladung(db, { email, erstelltVon: benutzer.id });
    revalidatePath(PFAD);

    return {
      art: "fertig",
      email,
      // Absolut, nicht relativ: Der Link wird kopiert und in eine Nachricht
      // eingefügt. Ein „/einladung/…" ohne Herkunft wäre dort wertlos.
      link: new URL(`/einladung/${token}`, env.BETTER_AUTH_URL).toString(),
      gueltigBis: formatiereDatum(gueltigBis),
    };
  } catch (fehler) {
    console.error("Einladung konnte nicht angelegt werden:", fehler);
    return {
      art: "fehler",
      text: "Die Einladung konnte nicht angelegt werden. Versuch es noch einmal.",
    };
  }
}

export async function entziehe(
  _vorher: EntzugsZustand,
  formular: FormData,
): Promise<EntzugsZustand> {
  let benutzer;
  try {
    benutzer = await requireBetreiber();
  } catch (fehler) {
    if (fehler instanceof NichtBetreiber) return { fehler: NICHT_BERECHTIGT };
    throw fehler;
  }

  const email = normalisiereEmail(String(formular.get("email") ?? ""));

  /*
   * Genau der Fall, für den es die Rolle gibt: Ein Entzug sperrt seit
   * Fix-Runde 1 wirklich aus, und die betreibende Person hätte danach keinen
   * Weg mehr zurück in die eigene Anwendung — die Freischaltung wieder
   * einzutragen ginge nur noch von Hand in der Datenbank. Die Oberfläche bietet
   * den Knopf für die eigene Zeile deshalb gar nicht erst an; hier steht die
   * Prüfung, die auch einen Aufruf an der Oberfläche vorbei abfängt.
   */
  if (email === normalisiereEmail(benutzer.email)) {
    return {
      fehler:
        "Du kannst dir den Zugang nicht selbst entziehen — sonst käme niemand mehr in die Verwaltung.",
    };
  }

  try {
    await entzieheZugang(db, email);
    revalidatePath(PFAD);
    // Bei Erfolg braucht es keine Meldung: Die Zeile verschwindet, und das ist
    // die eindeutigste Rückmeldung, die diese Seite geben kann.
    return KEIN_ENTZUGSFEHLER;
  } catch (fehler) {
    console.error("Zugang konnte nicht entzogen werden:", fehler);
    /*
     * Kein pauschales „hat nicht geklappt": `entzieheZugang` streicht zuerst
     * die Freischaltung und beendet danach die Sitzungen. Bricht der zweite
     * Schritt ab, ist die Person sehr wohl entzogen — nur eben noch angemeldet.
     * Die Seite neu zu laden ist dann die richtige Auskunft (die Zeile ist
     * weg), und die Meldung darf nicht das Gegenteil behaupten.
     */
    revalidatePath(PFAD);
    return {
      fehler:
        "Der Entzug ist möglicherweise nur halb durchgelaufen. Lade die Seite neu und sieh nach: " +
        "Ist die Adresse noch in der Liste, versuch es noch einmal. Ist sie weg, kann eine bereits " +
        "laufende Anmeldung noch bis zu ihrem Ablauf bestehen.",
    };
  }
}

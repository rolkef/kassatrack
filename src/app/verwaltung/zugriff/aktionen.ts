"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { env } from "@/lib/env";
import { entzieheZugang, erzeugeEinladung } from "@/lib/einladung";
import { requireUser } from "@/lib/sitzung";
import { normalisiereEmail } from "@/lib/zugriff";
import {
  formatiereDatum,
  KEIN_ENTZUGSFEHLER,
  type EinladungsZustand,
  type EntzugsZustand,
} from "./zustand";

const PFAD = "/verwaltung/zugriff";

/*
 * Beide Aktionen beginnen mit `requireUser()`. Das ist keine Höflichkeit:
 * Server-Aktionen sind eigene Endpunkte und über ihre Kennung von außen
 * aufrufbar, ganz ohne die Seite, auf der sie stehen. Wer die Prüfung hier
 * wegließe, weil die Seite sie ohnehin macht, hätte eine offene Schnittstelle
 * zum Freischalten beliebiger Adressen.
 */

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
  const benutzer = await requireUser();
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
  await requireUser();

  try {
    await entzieheZugang(db, String(formular.get("email") ?? ""));
    revalidatePath(PFAD);
    // Bei Erfolg braucht es keine Meldung: Die Zeile verschwindet, und das ist
    // die eindeutigste Rückmeldung, die diese Seite geben kann.
    return KEIN_ENTZUGSFEHLER;
  } catch (fehler) {
    console.error("Zugang konnte nicht entzogen werden:", fehler);
    return { fehler: "Der Zugang konnte nicht entzogen werden. Versuch es noch einmal." };
  }
}

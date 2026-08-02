import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AnmeldeFormular } from "@/components/anmelde-formular";
import { db } from "@/db";
import { ANMELDE_PFAD, EINLADUNG_UNGUELTIG } from "@/lib/anmeldung";
import { EinladungUngueltig, loeseEinladungEin } from "@/lib/einladung";

export const metadata: Metadata = {
  title: "Einladung — KassaTrack",
  // Diese Seite löst beim Aufruf einen Token ein. Sie hat in keinem Index
  // etwas verloren.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Die ruhige Ebene, einmal gesehen und nie wieder.
 *
 * Wer hier landet, kommt aus einer Nachricht, steht vermutlich am Handy und
 * weiß nichts über KassaTrack — nicht einmal den Namen. Deshalb genau drei
 * Aussagen, in dieser Reihenfolge: was das ist, dass die Adresse jetzt gilt,
 * was zu tun ist. Danach dieselben zwei Anmeldewege wie überall.
 *
 * Maße und Rhythmus sind bewusst von `/anmelden` übernommen. Es ist derselbe
 * Moment, einen Schritt früher; zwei verschiedene Auftritte wären hier nur
 * Selbstzweck.
 */
export default async function EinladungSeite({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let email: string;
  try {
    ({ email } = await loeseEinladungEin(db, token));
  } catch (fehler) {
    /*
     * Die Umleitung trägt den Grund mit — über `?error=`, denn nur diesen
     * Parameter liest die Anmeldeseite. Ohne ihn stünde die Person vor einer
     * Anmeldeseite ohne jede Erklärung, warum ihr Link ins Leere lief.
     *
     * `redirect()` wirft selbst, um die Auslieferung abzubrechen. Der Aufruf
     * steht deshalb außerhalb des `try` — hier im `catch` — und wird nicht
     * versehentlich vom eigenen Fang wieder eingesammelt.
     */
    if (fehler instanceof EinladungUngueltig) {
      redirect(`${ANMELDE_PFAD}?error=${EINLADUNG_UNGUELTIG}`);
    }
    throw fehler;
  }

  return (
    <main
      className={
        "mx-auto flex min-h-dvh w-full max-w-[27rem] flex-1 flex-col justify-center gap-9 " +
        "px-6 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(4.5rem,env(safe-area-inset-bottom))] " +
        "sm:max-w-[30rem] sm:gap-11 sm:px-8"
      }
    >
      <header data-auftritt className="flex animate-auftritt flex-col gap-3">
        <h1 className="font-anzeige text-[clamp(2rem,8.5vw,2.75rem)] leading-[0.98] font-semibold tracking-[-0.04em]">
          Willkommen bei KassaTrack
        </h1>
        {/*
          Der eine Satz, der erklärt, was das hier ist. Er nennt die Ketten
          beim Namen, weil „Preisverfolgung für den Lebensmitteleinkauf" nichts
          bedeutet, „Billa, Spar, Hofer, Lidl und Penny" aber sofort.
        */}
        <p className="max-w-[34ch] text-[1.0625rem] leading-snug text-gedaempft sm:text-[1.125rem]">
          KassaTrack merkt sich, was Lebensmittel bei Billa, Spar, Hofer, Lidl und Penny kosten —
          damit du im Geschäft siehst, ob ein Preis gerade gut ist.
        </p>
      </header>

      <div
        data-auftritt
        className="flex animate-auftritt items-start gap-3 rounded-block bg-flaeche px-4 py-3.5 [animation-delay:60ms]"
      >
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-erfolg">
          <Haken />
        </span>
        <p className="text-base leading-relaxed">
          <strong className="font-medium break-words">{email}</strong> ist freigeschaltet. Melde
          dich mit dieser Adresse an — ein Passwort brauchst du nicht.
        </p>
      </div>

      <AnmeldeFormular />
    </main>
  );
}

/** Grün ist hier richtig: Es ist eine Bestätigung, keine Warnung. */
function Haken() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="10" cy="10" r="7.5" />
      <path d="m6.75 10.25 2.25 2.25 4.25-4.75" />
    </svg>
  );
}

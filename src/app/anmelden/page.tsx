import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AnmeldeFormular } from "@/components/anmelde-formular";
import { holeSitzung } from "@/lib/sitzung";

export const metadata: Metadata = {
  title: "Anmelden — KassaTrack",
};

/**
 * Die ruhige Ebene in Reinform: eine Aussage, zwei Wege, ein Erklärkasten.
 * Der Inhalt steht linksbündig in einer schmalen Spalte, die Spalte selbst
 * sitzt eine Spur über der Bildmitte — dort, wo das Auge sie erwartet.
 */
export default async function AnmeldeSeite() {
  if (await holeSitzung()) redirect("/");

  return (
    <main
      className={
        "mx-auto flex min-h-dvh w-full max-w-[27rem] flex-1 flex-col justify-center gap-10 " +
        "px-6 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(4.5rem,env(safe-area-inset-bottom))] " +
        "sm:max-w-[30rem] sm:gap-12 sm:px-8"
      }
    >
      <header data-auftritt className="flex animate-auftritt flex-col gap-3">
        <h1 className="font-anzeige text-[clamp(2.5rem,11vw,3.75rem)] leading-[0.92] font-semibold tracking-[-0.045em]">
          KassaTrack
        </h1>
        <p className="max-w-[30ch] text-[1.0625rem] leading-snug text-gedaempft sm:text-[1.125rem]">
          Preise vergleichen, statt sie zu schätzen.
        </p>
      </header>

      <AnmeldeFormular />
    </main>
  );
}

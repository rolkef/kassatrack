import type { Metadata } from "next";
import { db } from "@/db";
import { holeKetten } from "@/lib/katalog";
import { requireUser } from "@/lib/sitzung";
import { erfasse } from "./aktionen";
import { bestaetigeZuordnung, loeseEanAuf } from "./ean-aktionen";
import { ErfassungsFormular } from "./erfassungs-formular";

export const metadata: Metadata = {
  title: "Preis erfassen — KassaTrack",
};

/**
 * Der einzige Weg, auf dem in Plan 2 Daten in KassaTrack kommen.
 *
 * Die ruhige Ebene, aber mit sechs Feldern: großzügige Bedienelemente,
 * 16-px-Text (darunter zoomt iOS beim Hineintippen in das Feld hinein und
 * verschiebt die halbe Seite), ein Gedanke je Abschnitt statt je Bildschirm.
 * Das ist die Lage, für die diese Ebene gedacht ist — Einkaufswagen in der
 * einen Hand, Handy in der anderen.
 *
 * `requireUser` steht hier für die Anzeige. Die eigentliche Sperre sitzt in
 * `erfasse`: Server-Aktionen sind eigene Endpunkte und auch ohne diese Seite
 * aufrufbar.
 */
export default async function ErfassenSeite() {
  await requireUser();
  const ketten = await holeKetten(db);

  return (
    <main
      className={
        "mx-auto flex w-full max-w-xl flex-col gap-8 px-5 " +
        "pt-[max(2rem,env(safe-area-inset-top))] pb-[max(3rem,env(safe-area-inset-bottom))] " +
        "sm:px-8 sm:pt-12"
      }
    >
      <header data-auftritt className="flex animate-auftritt flex-col gap-2">
        <h1 className="font-anzeige text-[clamp(1.75rem,7vw,2.125rem)] leading-tight font-semibold tracking-[-0.03em]">
          Preis erfassen
        </h1>
        <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-gedaempft">
          Menge und Preis eintragen — den Preis je Kilo, Liter oder Stück rechnet KassaTrack mit.
          Erst der macht zwei Packungen vergleichbar.
        </p>
      </header>

      <div data-auftritt className="animate-auftritt [animation-delay:80ms]">
        {ketten.length === 0 ? (
          <OhneKetten />
        ) : (
          <ErfassungsFormular
            ketten={ketten}
            aktion={erfasse}
            loeseEanAuf={loeseEanAuf}
            bestaetigeZuordnung={bestaetigeZuordnung}
          />
        )}
      </div>
    </main>
  );
}

/**
 * Eine Installation, in der die Ketten fehlen — dann gibt es nichts zu wählen
 * und das Formular wäre eine Sackgasse.
 *
 * Sand statt Rot: Wer hier landet, hat nichts falsch gemacht; es fehlt ein
 * Schritt beim Aufsetzen. Deshalb steht auch dabei, welcher.
 */
function OhneKetten() {
  return (
    <div className="rounded-block bg-hinweis px-4 py-3.5 text-base leading-relaxed text-auf-hinweis">
      <p>
        In dieser Installation sind noch keine Supermarktketten eingetragen, deshalb lässt sich
        kein Preis zuordnen. Sie entstehen beim Aufsetzen über{" "}
        <code className="font-mono text-sm">legeKettenAn</code>.
      </p>
    </div>
  );
}

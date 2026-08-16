import type { Metadata } from "next";
import { db } from "@/db";
import { holeKetten } from "@/lib/katalog";
import { holeUngeklaerte } from "@/lib/ketten-abgleich";
import { requireUser } from "@/lib/sitzung";
import {
  legeAlsNeuesProduktAn,
  ordneBestehendemProduktZu,
  sucheKatalog,
  verwerfe,
} from "./aktionen";
import { UngeklaertZeile } from "./ungeklaert-zeile";

export const metadata: Metadata = {
  title: "Katalogabgleich — KassaTrack",
};

/*
 * Darf nicht zwischengespeichert werden: Die Seite zeigt einen Arbeitsvorrat,
 * der sich mit jeder Zuordnung ändert — auch durch den nächtlichen Sync. Eine
 * Antwort aus dem Cache wäre eine Aussage über gestern.
 */
export const dynamic = "force-dynamic";

/**
 * Die Nacharbeit zum täglichen Ketten-Sync: Artikel, die sich nicht von selbst
 * einem Katalogprodukt zuordnen ließen.
 *
 * Dichte Ebene wie die Zugriffsverwaltung — feste `rem`-Stufen, enge Zeilen,
 * kleine Bedienelemente —, weil hier gelesen und verglichen wird und nicht im
 * Geschäft einhändig getippt.
 *
 * Das Gate ist aber ein anderes: `requireUser()` wie bei `/produkte` und
 * `/erfassen`, **nicht** `holeBerechtigung()`. Diese Seite pflegt den Katalog,
 * und den pflegt in dieser App jede angemeldete Person — es gibt kein
 * Eigentum an Produkten. Die Betreiberrolle sperrt Zugänge, nicht Waren; sie
 * hier zu verlangen wäre eine Einschränkung ohne Gegenstand. Deshalb steht die
 * Seite auch unter `/produkte` und nicht unter `/verwaltung`.
 */
export default async function AbgleichSeite() {
  await requireUser();

  const [eintraege, ketten] = await Promise.all([holeUngeklaerte(db), holeKetten(db)]);
  const kettenNamen = new Map(ketten.map((kette) => [kette.id, kette.name]));

  return (
    <main
      className={
        "mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 " +
        "pt-[max(2rem,env(safe-area-inset-top))] pb-[max(3rem,env(safe-area-inset-bottom))] " +
        "sm:px-8 sm:pt-12"
      }
    >
      <header data-auftritt className="flex animate-auftritt flex-col gap-2">
        <h1 className="font-anzeige text-[1.75rem] leading-tight font-semibold tracking-[-0.03em]">
          Katalogabgleich
        </h1>
        <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-gedaempft">
          Der tägliche Abgleich mit den Ketten übernimmt Preise nur für Artikel, die er
          zweifelsfrei einem Produkt zuordnen kann. Alles andere sammelt sich hier und wartet auf
          eine Entscheidung.
        </p>
      </header>

      <section
        data-auftritt
        aria-labelledby="abgleich-offen"
        className="flex animate-auftritt flex-col gap-3 [animation-delay:80ms]"
      >
        <h2
          id="abgleich-offen"
          className="flex items-baseline gap-2 text-[0.8125rem] font-semibold tracking-[0.08em] text-gedaempft uppercase"
        >
          Offen
          <span className="zahlen text-xs font-normal tabular-nums">{eintraege.length}</span>
        </h2>

        {eintraege.length === 0 ? (
          <p className="rounded-block bg-flaeche px-4 py-5 text-[0.9375rem] leading-relaxed text-gedaempft">
            Nichts offen. Hier stehen künftig Artikel aus dem nächtlichen Ketten-Abgleich, deren
            Name im Feed zu keinem Produkt im Katalog passt — etwa „BUTT.EXTRA 250“ zu „Butter“.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-linie">
            {eintraege.map((eintrag) => (
              <UngeklaertZeile
                key={eintrag.id}
                eintrag={{
                  id: eintrag.id,
                  rohname: eintrag.rohname,
                  menge: eintrag.menge,
                  einheit: eintrag.einheit,
                  letzterPreis: eintrag.letzterPreis,
                  /*
                   * Fällt eine Kette aus der Tabelle, ist ihre Kennung immer
                   * noch eine Auskunft — besser als eine Zeile, die nicht
                   * sagt, woher der Artikel stammt.
                   */
                  kettenName: kettenNamen.get(eintrag.chainId) ?? eintrag.chainId,
                }}
                sucheKatalog={sucheKatalog}
                ordneZu={ordneBestehendemProduktZu}
                legeNeuAn={legeAlsNeuesProduktAn}
                verwerfe={verwerfe}
              />
            ))}
          </ul>
        )}

        {/*
          Der Satz gehört an die Liste, weil er die Folgen von „Verwerfen"
          trägt: Ohne ihn liest sich der Knopf wie endgültiges Löschen, und
          niemand träfe die Entscheidung mit dem Wissen, dass sie sich von
          selbst zurückholt.
        */}
        <p className="text-xs leading-relaxed text-gedaempft">
          Zugeordnete Artikel merkt sich KassaTrack über den Produktcode der Kette und fragt nicht
          wieder nach. Verworfene stehen beim nächsten Abgleich wieder hier, solange die Kette sie
          führt.
        </p>
      </section>
    </main>
  );
}

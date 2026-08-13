import type { Metadata } from "next";
import { db } from "@/db";
import { holeListen } from "@/lib/einkaufszettel";
import { requireUser } from "@/lib/sitzung";
import { erzeugeListeAktion, loescheListeAktion } from "./aktionen";
import { ListenFormular } from "./listenformular";
import { ListenZeile } from "./listenzeile";

export const metadata: Metadata = {
  title: "Einkaufszettel — KassaTrack",
};

/**
 * Der Einstieg in Plan 4: welche Zettel es gibt, einen neuen anlegen, einen
 * öffnen oder löschen.
 *
 * Das Anlegen steht **über** der Liste, nicht hinter einem Pluszeichen in der
 * Ecke. Zwei Gründe: Beim ersten Besuch ist es die einzige sinnvolle Handlung,
 * und ein Feld mit Beschriftung sagt ohne Umweg, was ein Zettel überhaupt
 * braucht — einen Namen. Dieselbe Anordnung wie auf `/produkte`, wo das
 * Suchfeld ebenfalls über den Treffern sitzt; zwei Listenseiten, die ihre
 * Hauptgeste an verschiedenen Stellen trügen, wären ohne Not verschieden.
 *
 * Kein Datum in der Zeile. Die Reihenfolge sagt es schon: `holeListen` liefert
 * das Jüngste zuoberst, und wer zwei Zettel „Wocheneinkauf" hat, meint den
 * obersten. Ein formatiertes Datum je Zeile wäre eine zweite graue Zeile, die
 * wiederholt, was die Anordnung ohnehin ausdrückt.
 */
export default async function EinkaufszettelSeite() {
  await requireUser();
  const listen = await holeListen(db);

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
          Einkaufszettel
        </h1>
        <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-gedaempft">
          Ein Zettel je Einkauf. KassaTrack vergleicht, was daraufsteht, über alle Ketten — damit
          vor dem Losfahren feststeht, wo der ganze Einkauf am wenigsten kostet.
        </p>
      </header>

      <div data-auftritt className="animate-auftritt [animation-delay:80ms]">
        <ListenFormular aktion={erzeugeListeAktion} />
      </div>

      <div data-auftritt className="animate-auftritt [animation-delay:140ms]">
        {listen.length === 0 ? (
          /*
            Auskunft, kein Fehler: Ein leerer Bildschirm sagt hier nicht „nichts
            da", sondern was künftig dasteht und woher es kommt. Sand statt Rot,
            weil niemand etwas falsch gemacht hat.
          */
          <div className="rounded-block bg-hinweis px-4 py-3.5 text-[0.9375rem] leading-relaxed text-auf-hinweis">
            <p>
              Noch kein Zettel angelegt. Gib oben einen Namen ein — „Wocheneinkauf“ oder „Fest am
              Samstag“ — und schreib danach drauf, was du brauchst.
            </p>
          </div>
        ) : (
          <section aria-labelledby="zettel-titel" className="flex flex-col gap-3">
            <h2
              id="zettel-titel"
              className="flex items-baseline gap-2 text-[0.8125rem] font-semibold tracking-[0.08em] text-gedaempft uppercase"
            >
              Zettel
              <span className="zahlen text-xs font-normal">{listen.length}</span>
            </h2>

            <ul aria-labelledby="zettel-titel" className="flex flex-col divide-y divide-linie">
              {listen.map((liste) => (
                <ListenZeile
                  key={liste.id}
                  id={liste.id}
                  name={liste.name}
                  // Angebunden statt als verstecktes Feld mitgeschickt: Die
                  // Zeile braucht dann gar kein Formularfeld, und die
                  // Client-Komponente kennt nur „löschen", nicht „was".
                  loesche={loescheListeAktion.bind(null, liste.id)}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

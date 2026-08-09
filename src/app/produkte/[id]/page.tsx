import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { formatierePackung } from "@/lib/einheiten";
import { holeProdukt, type Produkt } from "@/lib/katalog";
import { bestesAngebot, holePreisMatrix } from "@/lib/preise";
import { requireUser } from "@/lib/sitzung";
import { HeuteSieger } from "./heute-sieger";
import { PreisTabelle } from "./preis-tabelle";

/**
 * Die Antwort auf „Ist das gerade billig?" — und dahinter, auf Tap, die
 * Belege dafür.
 *
 * Zwei Ebenen, wie im Gestaltungskontext beschrieben, hier zum ersten Mal
 * wörtlich übereinander: Oben ein Preis, eine Kette, ein Satz. Darunter, hinter
 * einem Aufklapper, die Tabelle mit allen fünf Ketten, dem Datenalter und der
 * Zahl der Beobachtungen.
 *
 * Der Aufklapper ist ein `<details>` und kein aufgeklapptes Etwas mit
 * `useState`: Er braucht kein JavaScript, ist mit der Tastatur bedienbar,
 * meldet Hilfstechnik seinen Zustand von selbst — und kommt ohne eingebetteten
 * Handler aus, den die CSP dieser App ohnehin blockieren würde.
 *
 * Zwischenspeicher: Diese Seite wird bei jedem Aufruf neu erzeugt, weil
 * `requireUser` über `headers()` liest. `revalidatePath("/produkte/<id>")` aus
 * der Erfassung trifft damit den richtigen Pfad, hat aber nichts zu verwerfen.
 */

async function ladeProdukt(id: string): Promise<Produkt> {
  const produkt = await holeProdukt(db, id);
  if (!produkt) notFound();
  return produkt;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  // Auch hier, nicht nur in der Seite: `generateMetadata` läuft als eigener
  // Aufruf und würde sonst für jede Anfrage ohne Sitzung die Datenbank fragen.
  await requireUser();

  const produkt = await ladeProdukt((await params).id);
  return {
    title: `${produkt.name} — KassaTrack`,
  };
}

export default async function ProduktSeite({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();

  const produkt = await ladeProdukt((await params).id);
  const zeilen = await holePreisMatrix(db, produkt.id);
  const { heuteSieger, referenzSieger } = bestesAngebot(zeilen);

  return (
    <main
      className={
        "mx-auto flex w-full max-w-xl flex-col gap-8 px-5 " +
        "pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(3rem,env(safe-area-inset-bottom))] " +
        "sm:px-8 sm:pt-10"
      }
    >
      <div data-auftritt className="flex animate-auftritt flex-col gap-5">
        <Link
          href="/produkte"
          className="inline-flex min-h-11 w-fit items-center gap-1.5 -ml-1 pl-1 text-[0.9375rem] text-marke"
        >
          <Zurueck />
          Zur Suche
        </Link>

        <header className="flex flex-col gap-1.5">
          <h1 className="font-anzeige text-[clamp(1.75rem,7vw,2.125rem)] leading-tight font-semibold tracking-[-0.03em]">
            {produkt.name}
          </h1>
          <p className="text-[0.9375rem] text-gedaempft">
            {produkt.marke ? `${produkt.marke} · ` : ""}
            {formatierePackung(produkt.menge, produkt.einheit)}
          </p>
        </header>
      </div>

      <div data-auftritt className="animate-auftritt [animation-delay:80ms]">
        {heuteSieger === null ? (
          <NochKeinPreis produkt={produkt} />
        ) : (
          <HeuteSieger
            sieger={heuteSieger}
            referenzSieger={referenzSieger}
            zeilen={zeilen}
            einheit={produkt.einheit}
          />
        )}
      </div>

      <details
        data-auftritt
        className="group animate-auftritt border-t border-linie pt-1 [animation-delay:140ms]"
      >
        <summary
          className={
            "flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 " +
            "text-[0.9375rem] font-medium " +
            "[&::-webkit-details-marker]:hidden"
          }
        >
          Alle fünf Ketten
          <Chevron />
        </summary>

        <div className="pt-2 pb-1">
          <PreisTabelle zeilen={zeilen} einheit={produkt.einheit} />
        </div>
      </details>
    </main>
  );
}

/**
 * Der Zustand, der am Anfang für jedes Produkt gilt.
 *
 * Sand statt Rot, und mit dem nächsten Schritt daneben: Ein Produkt ohne Preis
 * ist kein Fehler, sondern ein Katalogeintrag, dem noch eine Beobachtung fehlt.
 * Die Tabelle darunter bleibt trotzdem stehen — sie zeigt, was hier künftig
 * ausgefüllt wird.
 */
function NochKeinPreis({ produkt }: { produkt: Produkt }) {
  return (
    <div className="rounded-block bg-hinweis px-4 py-3.5 text-[0.9375rem] leading-relaxed text-auf-hinweis">
      <p>
        Für {produkt.name} ({formatierePackung(produkt.menge, produkt.einheit)}) ist noch kein
        Preis erfasst — weder ein Normalpreis noch eine laufende Aktion.{" "}
        <Link href="/erfassen" className="text-auf-hinweis underline underline-offset-4">
          Trag den ersten ein
        </Link>
        , dann steht hier, wo diese Ware am günstigsten ist.
      </p>
    </div>
  );
}

function Zurueck() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 3 5 8l5 5" />
    </svg>
  );
}

/** Dreht sich beim Aufklappen — der einzige Zustandshinweis, den das Element hat. */
function Chevron() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={
        "size-4 shrink-0 text-gedaempft transition-transform duration-200 ease-ruhig " +
        "group-open:rotate-180 motion-reduce:transition-none"
      }
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 6 5 5 5-5" />
    </svg>
  );
}

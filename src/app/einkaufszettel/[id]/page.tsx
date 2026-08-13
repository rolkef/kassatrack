import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { holeArtikel, holeListe, type Liste } from "@/lib/einkaufszettel";
import { holeKetten } from "@/lib/katalog";
import { berechneOptimierung } from "@/lib/optimierer";
import { requireUser } from "@/lib/sitzung";
import {
  artikelHinzufuegenAktion,
  entferneArtikelAktion,
  erfassePreisAktion,
  stueckzahlAktion,
  sucheProdukteAktion,
} from "./aktionen";
import { OptimiererAnzeige } from "./optimierer-anzeige";
import { ZettelDetail } from "./zettel-detail";

/**
 * Ein Zettel, die Antwort darauf, wo er am wenigsten kostet, und was
 * daraufsteht — in dieser Reihenfolge.
 *
 * Der Optimierer steht **über** der Liste, obwohl das Eingabefeld dann
 * weiter unten sitzt. Der Grund ist der Ort: Wer diesen Bildschirm im Geschäft
 * öffnet, hat den Zettel längst geschrieben und will die Antwort. Wer ihn
 * zuhause öffnet, um etwas draufzuschreiben, scrollt einmal — und sieht dabei,
 * dass sich die Summe geändert hat.
 *
 * Zwischenspeicher: Die Seite wird bei jedem Aufruf neu erzeugt, weil
 * `requireUser` über `headers()` liest. Das `revalidatePath` der Aktionen hat
 * damit nichts zu verwerfen — es wird trotzdem gebraucht, weil es den
 * laufenden Server-Durchlauf anstößt, aus dem `ZettelDetail` seine Liste
 * bekommt. Begründung in `aktionen.ts`.
 */

async function ladeListe(id: string): Promise<Liste> {
  const liste = await holeListe(db, id);
  if (!liste) notFound();
  return liste;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  // Auch hier, nicht nur in der Seite: `generateMetadata` läuft als eigener
  // Aufruf und würde sonst für jede Anfrage ohne Sitzung die Datenbank fragen.
  await requireUser();

  const liste = await ladeListe((await params).id);
  return {
    title: `${liste.name} — KassaTrack`,
  };
}

export default async function ListendetailSeite({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();

  const liste = await ladeListe((await params).id);
  const artikel = await holeArtikel(db, liste.id);
  const ketten = await holeKetten(db);
  const optimierung = await berechneOptimierung(db, liste.id);

  /*
   * Artikelkennung → Kettenkürzel, direkt aus der optimalen Aufteilung: Sie
   * hält je Kette die Artikel, die dort am günstigsten wären. Genau das ist
   * die Vorauswahl, die das Abhak-Formular braucht — die Zeile bekommt eine
   * Zeichenkette statt der ganzen Rechnung.
   */
  const empfohleneKetten = Object.fromEntries(
    optimierung.aufteilung.flatMap((zeile) =>
      zeile.artikel.map((eintrag) => [eintrag.artikel.id, zeile.kette.kuerzel]),
    ),
  );

  return (
    <main
      className={
        "mx-auto flex w-full max-w-xl flex-col gap-8 px-5 " +
        "pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(3rem,env(safe-area-inset-bottom))] " +
        "sm:px-8 sm:pt-10"
      }
    >
      <div data-auftritt className="flex animate-auftritt flex-col gap-5">
        {/*
          Der Weg zurück gehört an die Seite selbst und nicht allein in die
          App-Navigation: Diese Ansicht wird aus der Übersicht heraus geöffnet,
          und wer sie am Handy erreicht, sucht den Rückweg oben links.
        */}
        <Link
          href="/einkaufszettel"
          className="inline-flex min-h-11 w-fit items-center gap-1.5 -ml-1 pl-1 text-[0.9375rem] text-marke"
        >
          <Zurueck />
          Alle Zettel
        </Link>

        <h1 className="font-anzeige text-[clamp(1.75rem,7vw,2.125rem)] leading-tight font-semibold tracking-[-0.03em] break-words">
          {liste.name}
        </h1>
      </div>

      {/*
        Kein Optimierer über einem leeren Zettel: Er hätte nichts zu vergleichen
        und stünde der einen Sache im Weg, die hier dann zu tun ist.
      */}
      {artikel.length > 0 ? (
        <div data-auftritt className="animate-auftritt [animation-delay:80ms]">
          <OptimiererAnzeige optimierung={optimierung} />
        </div>
      ) : null}

      <div data-auftritt className="animate-auftritt [animation-delay:140ms]">
        <ZettelDetail
          listId={liste.id}
          artikel={artikel}
          ketten={ketten}
          empfohleneKetten={empfohleneKetten}
          artikelHinzufuegen={artikelHinzufuegenAktion}
          stueckzahlAendern={stueckzahlAktion}
          entferneArtikel={entferneArtikelAktion}
          sucheProdukte={sucheProdukteAktion}
          erfassePreis={erfassePreisAktion}
        />
      </div>
    </main>
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

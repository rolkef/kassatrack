import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { holeArtikel, holeListe, type Liste } from "@/lib/einkaufszettel";
import { requireUser } from "@/lib/sitzung";
import {
  artikelHinzufuegenAktion,
  entferneArtikelAktion,
  stueckzahlAktion,
  sucheProdukteAktion,
} from "./aktionen";
import { ZettelDetail } from "./zettel-detail";

/**
 * Ein Zettel und was daraufsteht.
 *
 * Der Optimierer — welche Kette den ganzen Zettel am billigsten macht — ist
 * bewusst noch nicht hier: Er gehört zu Task 8 und setzt voraus, dass etwas
 * daraufsteht. Diese Seite hat genau eine Aufgabe, nämlich das Draufschreiben,
 * und zeigt deshalb oben ein Feld und darunter die Liste.
 *
 * Zwischenspeicher: Die Seite wird bei jedem Aufruf neu erzeugt, weil
 * `requireUser` über `headers()` liest. Das `revalidatePath` der drei Aktionen
 * hat damit nichts zu verwerfen — es wird trotzdem gebraucht, weil es den
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

      <div data-auftritt className="animate-auftritt [animation-delay:80ms]">
        <ZettelDetail
          listId={liste.id}
          artikel={artikel}
          artikelHinzufuegen={artikelHinzufuegenAktion}
          stueckzahlAendern={stueckzahlAktion}
          entferneArtikel={entferneArtikelAktion}
          sucheProdukte={sucheProdukteAktion}
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

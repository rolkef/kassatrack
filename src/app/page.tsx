import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/db";
import { formatiereGrundpreis, formatierePackung } from "@/lib/einheiten";
import { holeLetzteErfassungen, type LetzteErfassung } from "@/lib/preise";
import { requireUser } from "@/lib/sitzung";

export const metadata: Metadata = {
  title: "Übersicht — KassaTrack",
};

/**
 * Der Einstieg: was zuletzt passiert ist, und der Weg zum nächsten Preis.
 *
 * Bewusst keine Kennzahlen-Kacheln. Die Frage beim Öffnen lautet nicht „wie
 * viele Beobachtungen habe ich?", sondern „läuft das hier, und wo war ich
 * stehengeblieben?" — und darauf antwortet eine Liste, die man auch wieder
 * antippen kann, besser als jede große Zahl.
 *
 * Die Reihenfolge folgt der Absicht, nicht der Menge: Erfassen steht oben, weil
 * das der Grund ist, aus dem jemand die App im Geschäft überhaupt aufmacht. Die
 * Liste darunter ist Rückschau und Einsprung zugleich — jede Zeile führt auf
 * das Produkt, zu dem sie gehört.
 */
export default async function StartSeite() {
  const benutzer = await requireUser();
  const erfassungen = await holeLetzteErfassungen(db);

  return (
    <main
      className={
        "mx-auto flex w-full max-w-xl flex-col gap-8 px-5 " +
        "pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(3rem,env(safe-area-inset-bottom))] " +
        "sm:px-8 sm:pt-12"
      }
    >
      <header data-auftritt className="flex animate-auftritt flex-col gap-2">
        <h1 className="font-anzeige text-[clamp(1.75rem,7vw,2.125rem)] leading-tight font-semibold tracking-[-0.03em]">
          Servus, {benutzer.name}
        </h1>
        <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-gedaempft">
          Trag ein, was etwas kostet — KassaTrack rechnet den Preis je Kilo, Liter oder Stück und
          sagt dir, wo die Ware am günstigsten ist.
        </p>
      </header>

      {/*
        Ein Link und keine Schaltfläche: Das hier wechselt die Seite, also
        gehört es zu den Dingen, die man in einem neuen Reiter öffnen und
        kopieren können muss. Gestalt und Maß sind die der `ruhig`-Schaltfläche
        — im Supermarkt mit dem Daumen zu treffen.
      */}
      <Link
        href="/erfassen"
        data-auftritt
        className={
          "flex min-h-14 animate-auftritt items-center justify-center gap-3 rounded-block " +
          "bg-marke px-6 text-[1.0625rem] leading-tight font-medium tracking-[-0.01em] " +
          "text-auf-marke transition-[background-color,translate] duration-150 ease-ruhig " +
          "hover:bg-marke-hell active:translate-y-px sm:min-h-16 sm:text-[1.125rem] " +
          "[animation-delay:80ms]"
        }
      >
        <PlusSymbol />
        Preis erfassen
      </Link>

      <section
        data-auftritt
        aria-labelledby="zuletzt-titel"
        className="flex animate-auftritt flex-col gap-3 [animation-delay:140ms]"
      >
        <h2
          id="zuletzt-titel"
          className="flex items-baseline gap-2 text-[0.8125rem] font-semibold tracking-[0.08em] text-gedaempft uppercase"
        >
          Zuletzt erfasst
          {erfassungen.length === 0 ? null : (
            <span className="zahlen text-xs font-normal">{erfassungen.length}</span>
          )}
        </h2>

        {erfassungen.length === 0 ? <NochNichts /> : <Liste eintraege={erfassungen} />}
      </section>
    </main>
  );
}

/**
 * Ein leerer Einstieg erklärt sich, statt „keine Daten" zu sagen.
 *
 * Sand und nicht Rot: Eine frische Installation ist kein Fehler. Und es steht
 * dabei, was hier künftig steht und wodurch es entsteht — sonst bliebe offen,
 * ob die Liste leer ist oder kaputt.
 */
function NochNichts() {
  return (
    <div className="rounded-block bg-hinweis px-4 py-3.5 text-[0.9375rem] leading-relaxed text-auf-hinweis">
      <p>
        Noch kein Preis erfasst. Sobald du den ersten einträgst, stehen hier die letzten Einträge —
        jeder führt auf das Produkt mit dem Vergleich über alle Ketten.
      </p>
    </div>
  );
}

function Liste({ eintraege }: { eintraege: LetzteErfassung[] }) {
  const jetzt = new Date();

  return (
    <ul className="flex flex-col divide-y divide-linie">
      {eintraege.map((eintrag) => (
        <li key={eintrag.id}>
          {/*
            Die ganze Zeile ist die Fläche, nicht nur der Name — dieselbe
            Entscheidung wie auf der Trefferliste, aus demselben Grund: Vor dem
            Regal wird mit dem Daumen getippt.
          */}
          <Link
            href={`/produkte/${eintrag.produktId}`}
            className={
              "flex min-h-14 items-center justify-between gap-4 py-3 " +
              "transition-colors duration-150 ease-ruhig hover:bg-flaeche"
            }
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[0.9375rem] font-medium break-words">
                {eintrag.name}
                {eintrag.marke ? (
                  <span className="font-normal text-gedaempft"> · {eintrag.marke}</span>
                ) : null}
              </span>
              <span className="text-xs text-gedaempft">
                {formatierePackung(eintrag.menge, eintrag.einheit)} bei {eintrag.kette} ·{" "}
                {formatiereWann(eintrag.beobachtetAm, jetzt)}
              </span>
            </span>
            <span className="zahlen shrink-0 text-[0.9375rem] text-marke">
              {formatiereGrundpreis(eintrag.grundpreis, eintrag.einheit)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/*
 * Fest auf Wien gestellt, aus demselben Grund wie in der Verwaltung: Ein Server
 * in UTC ordnete einen Eintrag von gestern 23:30 sonst dem heutigen Tag zu.
 */
const WIEN = "Europe/Vienna";

/** Sortierbarer Tagesschlüssel — mit Jahr, sonst gälte der 9. August 2025 als heute. */
const tagesSchluessel = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: WIEN,
});

const tagUndMonat = new Intl.DateTimeFormat("de-AT", {
  day: "2-digit",
  month: "2-digit",
  timeZone: WIEN,
});

/**
 * „heute", „gestern" oder das Datum.
 *
 * Ein Datum ist genau, aber die Frage beim Überfliegen lautet „ist das frisch?"
 * — und darauf antwortet „heute" schneller als „09.08.". Ab vorgestern ist die
 * Antwort ohnehin dieselbe, dann steht wieder das Datum.
 */
function formatiereWann(wert: Date, jetzt: Date): string {
  const tag = tagesSchluessel.format(wert);
  if (tag === tagesSchluessel.format(jetzt)) return "heute";
  if (tag === tagesSchluessel.format(new Date(jetzt.getTime() - 86_400_000))) return "gestern";
  return tagUndMonat.format(wert);
}

function PlusSymbol() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

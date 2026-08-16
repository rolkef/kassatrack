import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";
import { db } from "@/db";
import { formatierePackung } from "@/lib/einheiten";
import { sucheProdukte, type Produkt } from "@/lib/katalog";
import { requireUser } from "@/lib/sitzung";

export const metadata: Metadata = {
  title: "Produkte — KassaTrack",
};

/**
 * Der Weg zu einem Preis: ein Feld, eine Liste, ein Tap.
 *
 * Die Trefferliste nennt bewusst **keinen** Preis. Das ist keine Auslassung,
 * sondern eine Rechnung: `holePreisMatrix` stellt je Produkt rund sechzehn
 * Abfragen; über zwanzig Treffer wären das dreihundert Abfragen für eine
 * Zahl, die niemand vergleicht, weil er sie erst auf der Detailseite in
 * Beziehung setzen kann. Was die Liste stattdessen zeigt, ist das, wonach hier
 * wirklich ausgewählt wird: Marke und Gebindegröße. „Butter 250 g" und
 * „Butter 500 g" sind für KassaTrack zwei Waren — ohne die Größe wäre die
 * Wahl zwischen zwei gleichnamigen Zeilen ein Ratespiel.
 *
 * `next/form` statt eines nackten `<form method="get">`: Es schickt dieselben
 * Suchparameter, wechselt aber ohne vollen Seitenaufbau und lädt die
 * Zielansicht vor. Ein `onSubmit` bräuchte es dafür nicht — was hier zählt,
 * weil die CSP keine eingebetteten Handler zulässt.
 */
export default async function ProduktSuchSeite({
  searchParams,
}: {
  searchParams: Promise<{ [schluessel: string]: string | string[] | undefined }>;
}) {
  await requireUser();

  const roh = (await searchParams).q;
  // Ein wiederholter Parameter (`?q=a&q=b`) kommt als Feld an. Der erste Wert
  // ist der, den das Formular geschickt hat.
  const begriff = (Array.isArray(roh) ? roh[0] : roh)?.trim() ?? "";
  const treffer = await sucheProdukte(db, begriff);

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
          Produkte
        </h1>
        <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-gedaempft">
          Such nach Name oder Marke — Tippfehler machen nichts aus.
        </p>
      </header>

      <Form
        action="/produkte"
        data-auftritt
        className="flex animate-auftritt flex-col gap-3 [animation-delay:80ms] sm:flex-row"
      >
        <label htmlFor="produkt-suche" className="sr-only">
          Produkt suchen
        </label>
        <input
          id="produkt-suche"
          name="q"
          type="search"
          defaultValue={begriff}
          placeholder="z. B. Butter"
          autoComplete="off"
          autoCapitalize="sentences"
          spellCheck={false}
          className={
            "min-h-14 w-full min-w-0 flex-1 rounded-klein border border-linie-stark " +
            // 16 px sind die Untergrenze, ab der iOS beim Hineintippen nicht in
            // das Feld hineinzoomt. Darunter verrutscht die ganze Seite.
            "bg-hintergrund px-3.5 text-base placeholder:text-gedaempft"
          }
        />
        <Schaltflaeche type="submit" className="sm:w-auto sm:shrink-0">
          Suchen
        </Schaltflaeche>
      </Form>

      <div data-auftritt className="animate-auftritt [animation-delay:140ms]">
        {begriff === "" ? (
          <Hinweis>
            <p>
              Hier stehen die Produkte, zu denen schon einmal ein Preis erfasst wurde. Tipp oben
              ein, wonach du suchst — der Katalog wächst mit jedem Preis, den du einträgst.
            </p>
          </Hinweis>
        ) : treffer.length === 0 ? (
          <Hinweis>
            <p>
              Zu „{begriff}“ steht noch nichts im Katalog. Prüf die Schreibweise, such kürzer
              („Butter“ statt „Butter Kärntnermilch“), oder{" "}
              <Link href="/erfassen" className="text-auf-hinweis underline underline-offset-4">
                trag den ersten Preis dazu ein
              </Link>
              .
            </p>
          </Hinweis>
        ) : (
          <Trefferliste treffer={treffer} begriff={begriff} />
        )}
      </div>

      {/*
        Der einzige Weg zum Katalogabgleich. Er steht hier und nicht in der
        Navigationsleiste, weil er keine der drei Alltagsaufgaben ist, sondern
        Nacharbeit am Katalog — und der Katalog ist dieser Bildschirm.
        `istAktiv` in der Leiste greift über `startsWith("/produkte/")`, „Produkte"
        bleibt dort also hervorgehoben.

        Ganz unten und gedämpft: Wer im Geschäft steht, sucht einen Preis und
        soll hier nicht abbiegen. Wer nacharbeitet, hat Zeit zu scrollen.

        Bewusst ohne Anzahl daneben — die wäre eine zusätzliche Abfrage auf
        jedem Aufruf der meistbenutzten Seite, für eine Zahl, die auf der
        Zielseite ohnehin steht.
      */}
      <p
        data-auftritt
        className="animate-auftritt text-[0.8125rem] leading-relaxed text-gedaempft [animation-delay:200ms]"
      >
        <Link href="/produkte/abgleich" className="text-marke underline underline-offset-4">
          Katalogabgleich
        </Link>{" "}
        — Artikel aus dem täglichen Ketten-Abgleich, die noch zu keinem Produkt gehören.
      </p>
    </main>
  );
}

function Trefferliste({ treffer, begriff }: { treffer: Produkt[]; begriff: string }) {
  return (
    <section aria-labelledby="treffer-titel" className="flex flex-col gap-3">
      <h2
        id="treffer-titel"
        className="flex items-baseline gap-2 text-[0.8125rem] font-semibold tracking-[0.08em] text-gedaempft uppercase"
      >
        Treffer für „{begriff}“
        <span className="zahlen text-xs font-normal">{treffer.length}</span>
      </h2>

      <ul className="flex flex-col divide-y divide-linie">
        {treffer.map((produkt) => (
          <li key={produkt.id}>
            {/*
              Der ganze Eintrag ist die Fläche, nicht nur der Name: Vor dem
              Regal wird mit dem Daumen getippt, und ein Ziel von der Breite
              eines Wortes trifft man dabei nicht. `min-h-14` hält die Zeile
              auch dann über der Daumengrenze, wenn Name und Größe kurz sind.
            */}
            <Link
              href={`/produkte/${produkt.id}`}
              className={
                "flex min-h-14 items-center justify-between gap-4 py-3 " +
                "transition-colors duration-150 ease-ruhig hover:bg-flaeche"
              }
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[0.9375rem] font-medium break-words">{produkt.name}</span>
                <span className="text-xs text-gedaempft">
                  {produkt.marke ? `${produkt.marke} · ` : ""}
                  {formatierePackung(produkt.menge, produkt.einheit)}
                </span>
              </span>
              <Pfeil />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Auskunft, kein Fehler: Ein leerer Katalog und eine erfolglose Suche sind
 * beides Lagen, in denen niemand etwas falsch gemacht hat. Deshalb Sand und
 * nicht Rot — und deshalb steht in beiden Fällen dabei, was als Nächstes geht.
 */
function Hinweis({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-block bg-hinweis px-4 py-3.5 text-[0.9375rem] leading-relaxed text-auf-hinweis">
      {children}
    </div>
  );
}

function Pfeil() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-4 shrink-0 text-gedaempft"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}

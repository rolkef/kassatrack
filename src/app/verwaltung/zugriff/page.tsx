import type { Metadata } from "next";
import { db } from "@/db";
import { AUFBEWAHRUNG_TAGE, benenneWeg, holeAbweisungen } from "@/lib/abweisung";
import { holeZugaenge } from "@/lib/einladung";
import { requireUser } from "@/lib/sitzung";
import { EinladungsFormular } from "./einladungs-formular";
import { ZugangsZeile } from "./zugangs-zeile";
import { formatiereDatum, formatiereZeitpunkt } from "./zustand";

export const metadata: Metadata = {
  title: "Zugriff verwalten — KassaTrack",
};

/*
 * Diese Seite darf nicht zwischengespeichert werden: Sie zeigt, wer gerade
 * hereindarf. Eine Antwort aus dem Cache wäre eine Aussage über die
 * Vergangenheit.
 */
export const dynamic = "force-dynamic";

/**
 * Die dichte Ebene in Reinform — ein Werkzeug für genau eine Person.
 *
 * Feste `rem`-Stufen statt fließender Größen, enge Zeilen, kleine Bedienelemente
 * (aber nie unter 44 px). Das ist der bewusste Gegenpol zur Anmeldeseite: Dort
 * ein Gedanke pro Bildschirm, hier drei Abschnitte übereinander, die man im
 * Ganzen überblickt.
 *
 * Die Reihenfolge folgt der Arbeit, nicht der Wichtigkeit: einladen (das tut
 * man aktiv), dann sehen, wer darf, dann nachsehen, wer nicht durchkam.
 */
export default async function ZugriffSeite() {
  await requireUser();

  const [zugaenge, abweisungen] = await Promise.all([
    holeZugaenge(db),
    holeAbweisungen(db),
  ]);

  return (
    <main
      className={
        "mx-auto flex w-full max-w-2xl flex-col gap-10 px-5 " +
        "pt-[max(2rem,env(safe-area-inset-top))] pb-[max(3rem,env(safe-area-inset-bottom))] " +
        "sm:px-8 sm:pt-12"
      }
    >
      <header data-auftritt className="flex animate-auftritt flex-col gap-2">
        <h1 className="font-anzeige text-[1.75rem] leading-tight font-semibold tracking-[-0.03em]">
          Zugriff
        </h1>
        <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-gedaempft">
          KassaTrack steht nur eingeladenen Adressen offen. Hier kommen sie dazu — und hier siehst
          du, wer abgewiesen wurde.
        </p>
      </header>

      <Abschnitt titel="Einladen">
        <EinladungsFormular />
      </Abschnitt>

      <Abschnitt titel="Freigeschaltet" anzahl={zugaenge.length}>
        {zugaenge.length === 0 ? (
          <Leer>
            Noch niemand freigeschaltet. Trag oben eine Adresse ein — den Link, den du dann
            bekommst, schickst du per Nachricht weiter.
          </Leer>
        ) : (
          <ul className="flex flex-col divide-y divide-linie">
            {zugaenge.map((zugang) => (
              <ZugangsZeile
                key={zugang.id}
                email={zugang.email}
                seit={formatiereDatum(zugang.erstelltAm)}
                hatKonto={zugang.hatKonto}
              />
            ))}
          </ul>
        )}
      </Abschnitt>

      <Abschnitt titel="Abgewiesen" anzahl={abweisungen.length}>
        {abweisungen.length === 0 ? (
          <Leer>
            Noch keine abgewiesenen Versuche. Hier steht künftig, wer sich ohne Freischaltung
            anzumelden versucht hat — auch jemand, den du nicht kennst.
          </Leer>
        ) : (
          <ul className="flex flex-col divide-y divide-linie">
            {abweisungen.map((eintrag) => (
              <li
                key={eintrag.id}
                className="flex flex-col gap-0.5 py-2.5 sm:grid sm:grid-cols-[7.5rem_1fr_auto] sm:items-baseline sm:gap-4"
              >
                {/*
                  Die einzige Stelle, an der Martian Mono (`zahlen`) seinen
                  Platz verdient: zwölf Zeichen, die untereinander stehen sollen.
                  Bei den Adressen daneben wäre dieselbe Schrift eine Zumutung —
                  sie ist sehr breit, und Adressen sind lang.
                */}
                <span className="zahlen text-xs text-gedaempft">
                  {formatiereZeitpunkt(eintrag.zeitpunkt)}
                </span>
                <span className="text-[0.9375rem] break-words">
                  {eintrag.email ?? <span className="text-gedaempft">Ohne Adresse</span>}
                </span>
                <span className="text-xs text-gedaempft">{benenneWeg(eintrag.weg)}</span>
              </li>
            ))}
          </ul>
        )}

        {/*
          Die Zusage deckt sich mit der Mechanik: Gelöscht wird beim Start des
          Servers, danach täglich, bei jedem Aufruf dieser Seite und bei jedem
          neuen Eintrag (siehe `raeumeAbweisungenAuf`). Es gibt keinen
          Betriebszustand, in dem hier etwas Älteres liegen bleibt.
        */}
        <p className="text-xs leading-relaxed text-gedaempft">
          Hier stehen E-Mail-Adressen von Personen, die keine Nutzer sind. Einträge werden nach{" "}
          {AUFBEWAHRUNG_TAGE} Tagen automatisch gelöscht.
        </p>
      </Abschnitt>
    </main>
  );
}

/**
 * Ein Abschnitt der dichten Ebene: kleine Überschrift in Versalien, darunter
 * der Inhalt. Der Größensprung von 1,75 rem auf 0,8125 rem ist Absicht — in
 * einer dichten Ansicht trägt der Kontrast die Gliederung, nicht der Platz.
 */
function Abschnitt({
  titel,
  anzahl,
  children,
}: {
  titel: string;
  anzahl?: number;
  children: React.ReactNode;
}) {
  return (
    <section
      data-auftritt
      className="flex animate-auftritt flex-col gap-3 [animation-delay:80ms]"
      aria-labelledby={`abschnitt-${titel}`}
    >
      <h2
        id={`abschnitt-${titel}`}
        className="flex items-baseline gap-2 text-[0.8125rem] font-semibold tracking-[0.08em] text-gedaempft uppercase"
      >
        {titel}
        {anzahl === undefined ? null : (
          <span className="zahlen text-xs font-normal tabular-nums">{anzahl}</span>
        )}
      </h2>
      {children}
    </section>
  );
}

/** Ein leerer Bereich sagt, was hier künftig steht und woher es kommt. */
function Leer({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-block bg-flaeche px-4 py-5 text-[0.9375rem] leading-relaxed text-gedaempft">
      {children}
    </p>
  );
}

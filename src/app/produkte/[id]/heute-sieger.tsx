import { bezugsName, formatiereBetrag, formatiereGrundpreis, type Basiseinheit } from "@/lib/einheiten";
import type { PreisZeile } from "@/lib/preise";

/**
 * Die ruhige Ebene: ein Preis, groß genug, um ihn im Vorbeigehen zu lesen.
 *
 * Steht in einer eigenen Datei und nicht in `page.tsx`, weil sie sich sonst
 * nicht prüfen ließe: Eine Seitendatei darf in Next nur bestimmte Exporte
 * tragen, und ein Test müsste stattdessen `@/db` und `@/lib/sitzung` über
 * `mock.module` ersetzen — was in Bun für den **ganzen** Lauf gilt und diesem
 * Projekt schon zweimal fremde Tests zerschossen hat. Dieselbe Aufteilung wie
 * bei `preis-tabelle.tsx`.
 *
 * Die Ersparnis steht gegen die **teuerste** Kette und nicht gegen den
 * Durchschnitt: Wer vor dem Regal steht, entscheidet zwischen zwei Läden, nicht
 * gegen ein Mittel.
 */
export function HeuteSieger({
  sieger,
  referenzSieger,
  zeilen,
  einheit,
}: {
  sieger: PreisZeile;
  referenzSieger: PreisZeile | null;
  zeilen: PreisZeile[];
  einheit: Basiseinheit;
}) {
  const mitPreis = zeilen.filter((zeile) => zeile.bestpreis !== null);
  const teuerste = mitPreis.reduce((a, b) => (b.bestpreis! > a.bestpreis! ? b : a));
  const ersparnis = teuerste.bestpreis! - sieger.bestpreis!;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5 rounded-block bg-flaeche px-5 py-5">
        <p className="text-[0.75rem] font-semibold tracking-[0.1em] text-gedaempft uppercase">
          Heute am günstigsten
        </p>
        <p className="text-[1.0625rem] font-medium">{sieger.kette.name}</p>
        {/*
          Zahl und Einheit getrennt gesetzt, nicht als ein Stück aus
          `formatiereGrundpreis`: In Martian Mono bei 2,375 rem wiegt „€/kg"
          genauso schwer wie der Betrag, und die Zeile hat dann zwei
          gleich laute Hälften statt einer Zahl mit einer Angabe dahinter.
          Nachgemessen im Browser — als ein Stück gesetzt sah es aus wie eine
          Überschrift, nicht wie ein Preis.
        */}
        <p className="flex items-baseline gap-1.5 text-marke">
          <span className="zahlen text-[clamp(1.75rem,8vw,2.375rem)] leading-none tracking-[-0.055em]">
            {formatiereBetrag(sieger.bestpreis!)}
          </span>
          <span className="text-[1.0625rem] leading-none font-medium">
            €/{bezugsName(einheit)}
          </span>
        </p>

        {sieger.aktion ? (
          <p className="text-[0.8125rem] leading-relaxed text-gedaempft">
            Aktionspreis, gültig bis {langesDatum(sieger.aktion.gueltigBis)}. Danach zählt wieder
            der Normalpreis.
          </p>
        ) : null}

        {/*
          Drei Lagen, und die Unterscheidung hängt an der **Zahl der Ketten**,
          nicht an der Höhe der Ersparnis.
          Vorher stand hier nur `ersparnis > 0`: Liegen zwei Ketten zum selben
          Bestpreis, ist die Ersparnis null, und der Bildschirm behauptete
          „bisher ist nur Spar erfasst" — während die Tabelle direkt darunter
          mehrere Ketten mit Preisen zeigte. Gleiche Listenpreise bei zwei
          Ketten sind kein Randfall, sondern genau die Lage, in der jemand
          nachsieht.
        */}
        {mitPreis.length === 1 ? (
          <p className="text-[0.8125rem] leading-relaxed text-gedaempft">
            Bisher ist nur {sieger.kette.name} erfasst. Ein Vergleich entsteht, sobald ein Preis
            aus einer zweiten Kette dazukommt.
          </p>
        ) : ersparnis > 0 ? (
          <p className="text-[0.8125rem] leading-relaxed text-gedaempft">
            {formatiereGrundpreis(ersparnis, einheit)} günstiger als bei {teuerste.kette.name} —
            der teuersten Kette mit erfasstem Preis.
          </p>
        ) : (
          <p className="text-[0.8125rem] leading-relaxed text-gedaempft">
            Alle erfassten Ketten liegen heute gleichauf.
          </p>
        )}
      </div>

      {/*
        Eine Zeile, keine zweite Kachel. Beide Sieger als gleich große Blöcke
        nebeneinander wären zwei Antworten auf eine Frage — und die Frage im
        Geschäft lautet „heute", nicht „auf Dauer".
      */}
      {referenzSieger === null ? null : (
        <p className="text-[0.9375rem] leading-relaxed text-gedaempft">
          {referenzSieger.kette.kuerzel === sieger.kette.kuerzel ? (
            <>
              {referenzSieger.kette.name} ist auch sonst die günstigste Kette:{" "}
              <Referenzpreis wert={referenzSieger.referenzpreis!} einheit={einheit} /> als
              Referenzpreis.
            </>
          ) : (
            <>
              Auf Dauer am günstigsten ist {referenzSieger.kette.name} mit{" "}
              <Referenzpreis wert={referenzSieger.referenzpreis!} einheit={einheit} /> als
              Referenzpreis.
            </>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Bewusst **nicht** `zahlen`: Martian Mono ist sehr breit, und mitten in einem
 * Satz reißt sie die Zeile auseinander — im Browser brach „9,16 €/kg" zwischen
 * Betrag und Einheit um. Die Tabellenschrift gehört dorthin, wo Ziffern
 * untereinander stehen, nicht in einen Fließtext.
 */
function Referenzpreis({ wert, einheit }: { wert: number; einheit: Basiseinheit }) {
  return (
    <span className="font-semibold text-vordergrund">{formatiereGrundpreis(wert, einheit)}</span>
  );
}

/*
 * Von Hand statt über `Intl`: Das Ergebnis hinge sonst davon ab, welche
 * Gebietsdaten die Laufzeit mitbringt, und ein Datum, das im Bau anders
 * aussieht als in der Entwicklung, fällt erst im Betrieb auf.
 */
function langesDatum(datum: Date): string {
  const tag = String(datum.getDate()).padStart(2, "0");
  const monat = String(datum.getMonth() + 1).padStart(2, "0");
  return `${tag}.${monat}.${datum.getFullYear()}`;
}

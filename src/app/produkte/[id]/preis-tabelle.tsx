import { bezugsName, formatiereBetrag, type Basiseinheit } from "@/lib/einheiten";
import type { PreisZeile } from "@/lib/preise";

/**
 * Die dichte Ebene dieses Bildschirms: alle fünf Ketten nebeneinander, mit dem,
 * was die ruhige Ebene darüber bewusst weglässt — worauf eine Zahl beruht und
 * wie alt sie ist.
 *
 * Drei Spalten und nicht fünf. Am Handy stehen 350 px zur Verfügung; Martian
 * Mono ist eine sehr breite Schrift, und schon „11,16" braucht darin spürbar
 * mehr Platz als in der Textschrift. Beobachtungszahl und Datenalter stehen
 * deshalb nicht in eigenen Spalten, sondern als Kleinzeile unter dem
 * Kettennamen — dort ist der Platz, weil Kettennamen kurz sind.
 *
 * Keine Hervorhebung der günstigsten Zeile. Wer gewinnt, steht groß und in
 * Worten darüber; eine zweite, farbige Antwort in der Tabelle wiederholte sie
 * nur und wäre zudem eine Aussage allein über die Farbe.
 */

/**
 * Ab wann ein Wert nicht mehr für sich steht.
 *
 * Das Beobachtungsfenster von `holePreisMatrix` liegt bei 180 Tagen — bis
 * dahin geht eine Beobachtung noch in den Median ein. Diese Frist hier ist die
 * strengere Hälfte davon und beantwortet eine andere Frage: nicht „zählt der
 * Wert noch", sondern „darf man ihn ungeprüft glauben". Ein Referenzpreis aus
 * einer 170 Tage alten Beobachtung ist etwas anderes als einer von gestern,
 * und ohne diese Kennzeichnung stünden beide als gleich belastbare Zahl
 * nebeneinander.
 */
export const VERALTET_TAGE = 90;

export function PreisTabelle({
  zeilen,
  einheit,
}: {
  zeilen: PreisZeile[];
  einheit: Basiseinheit;
}) {
  const bezug = `€/${bezugsName(einheit)}`;

  return (
    <table className="w-full table-fixed border-collapse text-left">
      <caption className="caption-bottom pt-4 text-left text-xs leading-relaxed text-gedaempft">
        Der Referenzpreis ist der Median der letzten fünf Normalpreise einer Kette; die Zeitangabe
        nennt den jüngsten davon. Eine Aktion steht hier nur, wenn sie den Referenzpreis
        unterbietet.
      </caption>

      <thead>
        <tr className="border-b border-linie-stark">
          <th
            scope="col"
            className="w-[42%] pb-2 text-[0.8125rem] font-semibold tracking-[0.04em] text-gedaempft uppercase"
          >
            Kette
          </th>
          <Zahlenkopf bezug={bezug}>Referenz</Zahlenkopf>
          <Zahlenkopf bezug={bezug}>Heute</Zahlenkopf>
        </tr>
      </thead>

      <tbody className="divide-y divide-linie">
        {zeilen.map((zeile) => (
          <Zeile key={zeile.kette.id} zeile={zeile} />
        ))}
      </tbody>
    </table>
  );
}

/** Spaltenkopf mit der Einheit darunter — einmal statt in jeder Zelle. */
function Zahlenkopf({ bezug, children }: { bezug: string; children: string }) {
  return (
    <th scope="col" className="w-[29%] pb-2 pl-2 text-right">
      <span className="flex flex-col items-end gap-0.5">
        <span className="text-[0.8125rem] font-semibold tracking-[0.04em] text-gedaempft uppercase">
          {children}
        </span>
        <span className="text-[0.6875rem] font-normal text-gedaempft">{bezug}</span>
      </span>
    </th>
  );
}

function Zeile({ zeile }: { zeile: PreisZeile }) {
  /*
   * `letzteBeobachtung` ist die jüngste **geholte** Zeile, nicht die jüngste,
   * die in die Rechnung eingegangen ist: Ein als "NaN" abgelegter `numeric`
   * kommt durch jede Datenbank-Bedingung und wird erst beim Median
   * ausgesiebt. `anzahl` und `referenzpreis` zählen dann null beziehungsweise
   * nichts, während der Zeitstempel danebensteht. Eine Zeitangabe wäre hier
   * eine Aussage über eine Zahl, die es nicht gibt — „vor 3 Tagen" neben
   * „keine Daten" liest sich wie ein frischer Preis. Deshalb hängt die
   * Kleinzeile am Referenzpreis und nicht am Zeitstempel.
   */
  const stand =
    zeile.referenzpreis !== null && zeile.letzteBeobachtung !== null
      ? tageSeit(zeile.letzteBeobachtung)
      : null;

  const ohneDaten = zeile.referenzpreis === null && zeile.bestpreis === null;

  return (
    <tr>
      <th scope="row" className="py-3 pr-2 align-top font-medium">
        <span className="flex flex-col gap-1">
          <span className="text-[0.9375rem]">{zeile.kette.name}</span>
          {stand === null ? null : (
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-normal text-gedaempft">
              <span>
                {zeile.anzahl} {zeile.anzahl === 1 ? "Preis" : "Preise"}
              </span>
              <span aria-hidden="true">·</span>
              <span>{benenneStand(stand)}</span>
              {stand > VERALTET_TAGE ? (
                /*
                 * Sand, nicht Rot: Ein alter Wert ist kein Fehler, sondern eine
                 * Auskunft — es hat seither niemand nachgesehen. Und ein Wort
                 * statt bloß einer Farbe, weil die Aussage sonst für jeden
                 * verloren wäre, der Farben nicht unterscheidet.
                 */
                <span className="rounded-[0.25rem] bg-hinweis px-1.5 py-0.5 text-[0.6875rem] font-medium text-auf-hinweis">
                  veraltet
                </span>
              ) : null}
            </span>
          )}
        </span>
      </th>

      {ohneDaten ? (
        /*
         * Eine Zeile statt zweimal derselben Auskunft — und ausgeschrieben
         * statt als Strich oder Null. Eine 0,00 an dieser Stelle wäre der
         * günstigste Wert der ganzen Tabelle und damit eine Lüge, die genau in
         * die Richtung zeigt, in der jemand handelt.
         */
        <td colSpan={2} className="py-3 pl-2 text-right align-top text-[0.9375rem] text-gedaempft">
          keine Daten
        </td>
      ) : (
        <>
          <Zahlenzelle wert={zeile.referenzpreis} />
          <Zahlenzelle wert={zeile.bestpreis}>
            {zeile.aktion ? (
              // `whitespace-nowrap`: Ohne die Angabe brach „Aktion bis 15.08."
              // in der schmalen Zahlenspalte zwischen Wort und Datum um — im
              // Browser nachgemessen. Das Datum gehört an den Preis, nicht in
              // eine eigene Zeile darunter.
              <span className="text-[0.6875rem] whitespace-nowrap text-gedaempft">
                Aktion bis {kurzdatum(zeile.aktion.gueltigBis)}
              </span>
            ) : null}
          </Zahlenzelle>
        </>
      )}
    </tr>
  );
}

function Zahlenzelle({ wert, children }: { wert: number | null; children?: React.ReactNode }) {
  return (
    <td className="py-3 pl-2 text-right align-top">
      <span className="flex flex-col items-end gap-0.5">
        {wert === null ? (
          <span className="text-[0.9375rem] text-gedaempft">keine Daten</span>
        ) : (
          <span className="zahlen text-[0.9375rem] tracking-[-0.03em]">
            {formatiereBetrag(wert)}
          </span>
        )}
        {children}
      </span>
    </td>
  );
}

function tageSeit(datum: Date): number {
  return Math.floor((Date.now() - datum.getTime()) / 86_400_000);
}

function benenneStand(tage: number): string {
  if (tage <= 0) return "heute";
  if (tage === 1) return "gestern";
  return `vor ${tage} Tagen`;
}

/*
 * Von Hand statt über `Intl`: Das Ergebnis hängt sonst davon ab, welche
 * Gebietsdaten die Laufzeit mitbringt — im Bau und im Test können das
 * verschiedene sein, und die Aktion stünde einmal als „14.08." und einmal als
 * „8/14" da.
 */
function kurzdatum(datum: Date): string {
  const tag = String(datum.getDate()).padStart(2, "0");
  const monat = String(datum.getMonth() + 1).padStart(2, "0");
  return `${tag}.${monat}.`;
}

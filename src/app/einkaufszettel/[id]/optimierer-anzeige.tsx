import type { ReactNode } from "react";
import { formatiereBetrag, formatierePackung } from "@/lib/einheiten";
import type { ZettelArtikel } from "@/lib/einkaufszettel";
import type { AufteilungsZeile, KettenSumme, Optimierung } from "@/lib/optimierer";

/**
 * Die Antwort auf „wo kostet dieser Zettel am wenigsten?" — und dahinter, auf
 * Tap, die Rechnung dazu.
 *
 * Dieselben zwei Ebenen wie auf der Produktseite, und aus demselben Grund: Im
 * Geschäft liest man einen Satz und eine Zahl. Die fünf Ketten mit ihren
 * Summen und die Artikel darunter sind die Belege — sie beweisen den Satz,
 * aber sie beantworten die Frage nicht schneller. Der Aufklapper ist ein
 * natives `<details>`: kein JavaScript, mit der Tastatur bedienbar, meldet
 * seinen Zustand selbst und kommt ohne den eingebetteten Handler aus, den die
 * CSP dieser App blockieren würde.
 *
 * **Welche Zahl groß ist, hängt von der Lage ab.** Bringt Aufteilen etwas, ist
 * die betonte Zahl die *Ersparnis* — sie ist die Neuigkeit, die Summen sind
 * der Beleg. Bringt es nichts, ist es die *Summe* beim günstigsten Geschäft,
 * denn dann lautet die Antwort „geh dorthin". Beide Male stehen die
 * Vergleichswerte klein daneben; eine Zahl ohne ihren Gegenwert ist eine
 * Behauptung.
 *
 * Ohne `"use client"`, wie `heute-sieger.tsx`: Die Komponente rechnet nichts
 * und hört auf nichts. Sie am Server zu zeichnen spart dem Handy das
 * JavaScript dafür.
 */
export function OptimiererAnzeige({ optimierung }: { optimierung: Optimierung }) {
  const {
    aufteilung,
    aufteilungSumme,
    einzelmaerkte,
    guenstigsterEinzelmarkt,
    ersparnis,
    katalogArtikelAnzahl,
  } = optimierung;

  /*
   * Zwei Lagen mit derselben leeren Aufteilung, aber gegensätzlichem nächsten
   * Schritt — deshalb zwei Sätze und nicht einer.
   *
   * Ein Zettel aus lauter Freitext bekommt nie eine Rechnung: Freitexte gehen
   * strukturell in keine der beiden Summen ein. Stünde hier „noch keine Preise
   * erfasst", läse sich das nach dem Abhaken und Eintragen wie ein
   * fehlgeschlagenes Speichern — und die zweite, überflüssige Eingabe
   * verschöbe den Median.
   */
  if (katalogArtikelAnzahl === 0) {
    return (
      <div className="rounded-block bg-hinweis px-4 py-3.5 text-[0.9375rem] leading-relaxed text-auf-hinweis">
        <p>
          Für diesen Zettel gibt es nichts zu vergleichen — Freitexte gehen in die Rechnung nicht
          ein. Such einen Artikel im Katalog, dann steht hier, wo er am wenigsten kostet.
        </p>
      </div>
    );
  }

  /*
   * Kein einziger Artikel trägt irgendwo einen Preis. Eine Summe von null wäre
   * hier das schlechteste Ergebnis: Sie sähe aus wie ein Vergleich und wäre
   * keiner. Also Sand statt Zahl — wer noch nichts erfasst hat, hat nichts
   * falsch gemacht, und der nächste Schritt steht dabei.
   */
  if (aufteilung.length === 0) {
    return (
      <div className="rounded-block bg-hinweis px-4 py-3.5 text-[0.9375rem] leading-relaxed text-auf-hinweis">
        <p>
          Noch keine Preise erfasst. Hak beim Einkaufen einen Artikel ab und trag ein, was er
          gekostet hat — dann steht hier, in welchem Geschäft dieser Zettel am wenigsten kostet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        data-testid="optimierer-kern"
        className="flex flex-col gap-1.5 rounded-block bg-flaeche px-5 py-5"
      >
        {guenstigsterEinzelmarkt === null ? (
          <Unvollstaendig summe={aufteilungSumme} ketten={aufteilung.length} />
        ) : ersparnis !== null && ersparnis > 0 ? (
          <Aufteilen
            ersparnis={ersparnis}
            aufteilungSumme={aufteilungSumme}
            ketten={aufteilung.length}
            einzelmarkt={guenstigsterEinzelmarkt}
          />
        ) : (
          <EinGeschaeft einzelmarkt={guenstigsterEinzelmarkt} />
        )}
      </div>

      <details className="group border-t border-linie pt-1">
        <summary
          className={
            "flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 " +
            "text-[0.9375rem] font-medium " +
            "[&::-webkit-details-marker]:hidden"
          }
        >
          Ketten im Detail
          <Chevron />
        </summary>

        <div className="flex flex-col gap-6 pt-2 pb-1">
          <EinzelmarktTabelle
            einzelmaerkte={einzelmaerkte}
            guenstigster={guenstigsterEinzelmarkt}
          />
          <AufteilungsListe aufteilung={aufteilung} summe={aufteilungSumme} />
        </div>
      </details>
    </div>
  );
}

/** „Aufgeteilt sparst du 0,31 €" — die Ersparnis als betonte Zahl. */
function Aufteilen({
  ersparnis,
  aufteilungSumme,
  ketten,
  einzelmarkt,
}: {
  ersparnis: number;
  aufteilungSumme: number;
  ketten: number;
  einzelmarkt: KettenSumme;
}) {
  return (
    <>
      <Eyebrow>Optimale Aufteilung</Eyebrow>
      <p className="text-[1.0625rem] font-medium">Aufgeteilt sparst du</p>
      <Betrag wert={ersparnis} />
      <p className="text-[0.8125rem] leading-relaxed text-gedaempft">
        {betragMitEinheit(aufteilungSumme)} auf {ketten} {ketten === 1 ? "Kette" : "Ketten"} statt{" "}
        {betragMitEinheit(einzelmarkt.summe)} bei {einzelmarkt.kette.name} — dem günstigsten
        Geschäft, das alles führt.
      </p>
    </>
  );
}

/** „Am günstigsten: alles bei Spar" — ein Weg, ein Geschäft. */
function EinGeschaeft({ einzelmarkt }: { einzelmarkt: KettenSumme }) {
  return (
    <>
      <Eyebrow>Bester Einzelmarkt</Eyebrow>
      <p className="text-[1.0625rem] font-medium">Alles bei {einzelmarkt.kette.name}</p>
      <Betrag wert={einzelmarkt.summe} />
      <p className="text-[0.8125rem] leading-relaxed text-gedaempft">
        Aufteilen brächte hier nichts. Ein Weg, ein Geschäft.
      </p>
    </>
  );
}

/**
 * Keine Kette trägt für jeden Artikel einen Preis.
 *
 * Die Aufteilung steht trotzdem da — sie rechnet nur mit dem, was erfasst ist,
 * und bleibt damit richtig. Eine Einzelmarkt-Summe wäre dagegen falsch: Sie
 * ließe die Lücken weg, und die Kette mit den meisten Lücken sähe am
 * billigsten aus. Deshalb sagt der Satz darunter, was fehlt, statt eine Zahl
 * zu zeigen, die niemand nachrechnen kann.
 */
function Unvollstaendig({ summe, ketten }: { summe: number; ketten: number }) {
  return (
    <>
      <Eyebrow>Optimale Aufteilung</Eyebrow>
      <p className="text-[1.0625rem] font-medium">
        Auf {ketten} {ketten === 1 ? "Kette" : "Ketten"} verteilt
      </p>
      <Betrag wert={summe} />
      <p className="text-[0.8125rem] leading-relaxed text-gedaempft">
        Was der Zettel in einem einzigen Geschäft kostet, steht noch nicht fest — keine Kette trägt
        bisher zu allem einen Preis. Gerechnet wird nur mit dem, was schon dasteht.
      </p>
    </>
  );
}

/**
 * Alle Ketten mit ihrer Summe — der „Bester Einzelmarkt"-Vergleich in voller
 * Länge.
 *
 * Die unvollständigen Ketten bleiben in der Tabelle stehen, statt zu
 * verschwinden: Dass Hofer hier fehlt, ist selbst eine Auskunft — sie sagt,
 * wo noch ein Preis zu erfassen wäre.
 */
function EinzelmarktTabelle({
  einzelmaerkte,
  guenstigster,
}: {
  einzelmaerkte: KettenSumme[];
  guenstigster: KettenSumme | null;
}) {
  return (
    <table data-testid="optimierer-einzelmaerkte" className="w-full text-[0.9375rem]">
      <caption className="pb-2 text-left text-[0.75rem] font-semibold tracking-[0.1em] text-gedaempft uppercase">
        Alles in einem Geschäft
      </caption>
      <tbody className="divide-y divide-linie">
        {einzelmaerkte.map((zeile) => {
          const gewinnt = zeile.kette.id === guenstigster?.kette.id;
          return (
            <tr key={zeile.kette.id}>
              <th
                scope="row"
                className={`py-2 text-left font-normal ${gewinnt ? "font-semibold" : ""}`}
              >
                {zeile.kette.name}
                {gewinnt ? <span className="sr-only"> — am günstigsten</span> : null}
              </th>
              <td className={`py-2 text-right ${gewinnt ? "text-marke" : "text-gedaempft"}`}>
                {zeile.vollstaendig ? (
                  <span className="zahlen">{betragMitEinheit(zeile.summe)}</span>
                ) : (
                  <span className="text-[0.8125rem]">nicht alles hier erfasst</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Was in welchem Geschäft zu kaufen wäre — die Aufteilung, Zeile für Zeile. */
function AufteilungsListe({
  aufteilung,
  summe,
}: {
  aufteilung: AufteilungsZeile[];
  summe: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.75rem] font-semibold tracking-[0.1em] text-gedaempft uppercase">
        Aufgeteilt — {betragMitEinheit(summe)}
      </p>

      {aufteilung.map((zeile) => (
        <div key={zeile.kette.id} className="flex flex-col gap-1 border-t border-linie pt-2">
          <p className="flex items-baseline justify-between gap-3 text-[0.9375rem] font-semibold">
            {zeile.kette.name}
            <span className="zahlen font-normal">{betragMitEinheit(zeile.summe)}</span>
          </p>
          <ul className="flex flex-col gap-0.5">
            {zeile.artikel.map((eintrag) => (
              <li
                key={eintrag.artikel.id}
                className="flex items-baseline justify-between gap-3 text-[0.8125rem] text-gedaempft"
              >
                <span className="min-w-0 break-words">{beschreibe(eintrag.artikel)}</span>
                <span className="zahlen shrink-0">{betragMitEinheit(eintrag.preis)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Die eine große Zahl.
 *
 * Betrag und Währungszeichen getrennt gesetzt, wie bei `HeuteSieger`: In der
 * Ziffernschrift bei 2,375 rem wiegt ein mitgesetztes „€" genauso schwer wie
 * der Betrag, und die Zeile hätte zwei gleich laute Hälften statt einer Zahl
 * mit einer Angabe dahinter.
 */
function Betrag({ wert }: { wert: number }) {
  return (
    <p className="flex items-baseline gap-1.5 text-marke">
      <span className="zahlen text-[clamp(1.75rem,8vw,2.375rem)] leading-none tracking-[-0.055em]">
        {formatiereBetrag(wert)}
      </span>
      <span className="text-[1.0625rem] leading-none font-medium">€</span>
    </p>
  );
}

/**
 * „Butter 250 g" oder „Milch 1 l · 2 ×".
 *
 * Die Stückzahl steht dabei, sobald sie über eins liegt: Ohne sie ließe sich
 * die Zeilensumme nicht nachrechnen, und genau das ist der Zweck dieser Ebene.
 */
function beschreibe(artikel: ZettelArtikel): string {
  const name = artikel.produkt
    ? `${artikel.produkt.name} ${formatierePackung(artikel.produkt.menge, artikel.produkt.einheit)}`
    : (artikel.freitext ?? "Artikel");

  return artikel.stueckzahl > 1 ? `${name} · ${artikel.stueckzahl} ×` : name;
}

/**
 * Bewusst **nicht** in der Ziffernschrift, wo der Betrag mitten in einem Satz
 * steht: Martian Mono ist sehr breit und reißt die Zeile auseinander. Dieselbe
 * Unterscheidung wie bei `Referenzpreis` auf der Produktseite — die
 * Ziffernschrift gehört in die Spalten des Aufklappers, nicht in den Fließtext
 * darüber.
 */
function betragMitEinheit(wert: number): string {
  return `${formatiereBetrag(wert)} €`;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[0.75rem] font-semibold tracking-[0.1em] text-gedaempft uppercase">
      {children}
    </p>
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

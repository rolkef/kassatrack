// Muss zuerst stehen: registriert happy-dom. `screen` kommt aus derselben
// Datei — siehe Begründung in tests/dom.ts.
import { screen } from "./dom";

import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ZettelArtikel } from "@/lib/einkaufszettel";
import type { Kette } from "@/lib/katalog";
import type { Optimierung } from "@/lib/optimierer";
import { OptimiererAnzeige } from "@/app/einkaufszettel/[id]/optimierer-anzeige";

const SPAR: Kette = { id: "c1", name: "Spar", kuerzel: "spar" };
const HOFER: Kette = { id: "c2", name: "Hofer", kuerzel: "hofer" };

const BUTTER: ZettelArtikel = {
  id: "a1",
  listId: "l1",
  produkt: {
    id: "p1",
    name: "Butter",
    marke: null,
    menge: 250,
    einheit: "G",
    bildSchluessel: null,
  },
  freitext: null,
  stueckzahl: 1,
  abgehaktAm: null,
};

const MILCH: ZettelArtikel = {
  id: "a2",
  listId: "l1",
  produkt: {
    id: "p2",
    name: "Milch",
    marke: null,
    menge: 1000,
    einheit: "ML",
    bildSchluessel: null,
  },
  freitext: null,
  stueckzahl: 2,
  abgehaktAm: null,
};

function optimierung(ueberschreibung: Partial<Optimierung> = {}): Optimierung {
  return {
    aufteilung: [
      { kette: SPAR, artikel: [{ artikel: BUTTER, preis: 2.29 }], summe: 2.29 },
      { kette: HOFER, artikel: [{ artikel: MILCH, preis: 1.39 }], summe: 1.39 },
    ],
    aufteilungSumme: 3.68,
    einzelmaerkte: [
      { kette: SPAR, summe: 3.99, vollstaendig: true },
      { kette: HOFER, summe: 4.18, vollstaendig: true },
    ],
    guenstigsterEinzelmarkt: { kette: SPAR, summe: 3.99, vollstaendig: true },
    ersparnis: 0.31,
    katalogArtikelAnzahl: 2,
    ...ueberschreibung,
  };
}

/** Die ruhige Ebene — alles außerhalb des Aufklappers. */
function kern(): HTMLElement {
  return screen.getByTestId("optimierer-kern");
}

function aufklapper(): HTMLDetailsElement {
  return document.body.querySelector("details")!;
}

afterEach(cleanup);

describe("OptimiererAnzeige — die eine Aussage", () => {
  it("nennt die Ersparnis, wenn Aufteilen etwas bringt", () => {
    render(<OptimiererAnzeige optimierung={optimierung()} />);

    expect(screen.getByText(/sparst du/i)).toBeDefined();
    // Die Ersparnis ist die betonte Zahl, nicht eine der beiden Summen.
    expect(kern().textContent).toContain("0,31");
    // Beide Vergleichswerte stehen daneben — ohne sie ist „0,31 €" keine
    // überprüfbare Aussage, sondern eine Behauptung.
    expect(kern().textContent).toContain("3,68");
    expect(kern().textContent).toContain("3,99");
    expect(kern().textContent).toContain("Spar");
  });

  /*
   * Der häufigere Alltagsfall: Ein Geschäft, ein Weg. Die App darf ihn nicht
   * als Ausnahme behandeln, nur weil sie aufteilen könnte.
   */
  it("nennt den günstigsten Einzelmarkt, wenn Aufteilen nichts bringt", () => {
    render(
      <OptimiererAnzeige optimierung={optimierung({ ersparnis: 0, aufteilungSumme: 3.99 })} />,
    );

    expect(kern().textContent).toContain("Spar");
    expect(kern().textContent).toContain("3,99");
    expect(screen.queryByText(/sparst du/i)).toBeNull();
  });

  /*
   * Keine Kette trägt für jeden Artikel einen Preis. Eine Einzelmarkt-Summe
   * wäre hier eine Lüge: Sie ließe die Lücken einfach weg und sähe deshalb
   * billiger aus als die Wahrheit. Also nur die Aufteilung — und der Grund,
   * warum daneben nichts steht.
   */
  it("zeigt nur die Aufteilung, wenn keine Kette vollständig ist", () => {
    render(
      <OptimiererAnzeige
        optimierung={optimierung({
          einzelmaerkte: [
            { kette: SPAR, summe: 2.29, vollstaendig: false },
            { kette: HOFER, summe: 1.39, vollstaendig: false },
          ],
          guenstigsterEinzelmarkt: null,
          ersparnis: null,
        })}
      />,
    );

    expect(kern().textContent).toContain("3,68");
    expect(kern().textContent).toContain("steht noch nicht fest");
    expect(screen.queryByText(/sparst du/i)).toBeNull();
  });

  /*
   * Eine Liste ohne einen einzigen erfassten Preis. Eine Summe von null wäre
   * das schlechteste aller Ergebnisse: Sie sähe aus wie ein Vergleich und
   * wäre keiner.
   */
  it("sagt bei einer Liste ohne Preise, dass noch keine erfasst sind", () => {
    render(
      <OptimiererAnzeige
        optimierung={optimierung({
          aufteilung: [],
          aufteilungSumme: 0,
          einzelmaerkte: [
            { kette: SPAR, summe: 0, vollstaendig: false },
            { kette: HOFER, summe: 0, vollstaendig: false },
          ],
          guenstigsterEinzelmarkt: null,
          ersparnis: null,
        })}
      />,
    );

    expect(screen.getByText(/noch keine Preise/i)).toBeDefined();
    expect(document.body.querySelector("details")).toBeNull();
  });

  /*
   * Ein Zettel aus lauter Freitext. „Noch keine Preise erfasst" wäre hier
   * falsch und obendrein irreführend: Der Satz verspricht, dass sich etwas
   * ändert, sobald man abhakt — und genau das tut es nie. Wer daraufhin ein
   * zweites Mal speichert, verschiebt den Median.
   */
  it("sagt bei einem Zettel ohne Katalogartikel, dass es nichts zu vergleichen gibt", () => {
    render(
      <OptimiererAnzeige
        optimierung={optimierung({
          aufteilung: [],
          aufteilungSumme: 0,
          einzelmaerkte: [
            { kette: SPAR, summe: 0, vollstaendig: false },
            { kette: HOFER, summe: 0, vollstaendig: false },
          ],
          guenstigsterEinzelmarkt: null,
          ersparnis: null,
          katalogArtikelAnzahl: 0,
        })}
      />,
    );

    expect(screen.getByText(/nichts zu vergleichen/i)).toBeDefined();
    expect(screen.queryByText(/noch keine Preise/i)).toBeNull();
  });
});

describe("OptimiererAnzeige — die dichte Ebene", () => {
  /*
   * Warum hier auf `open` geprüft wird und nicht darauf, ob der Text
   * auffindbar ist: happy-dom bringt das Nutzeragenten-Stylesheet nicht mit,
   * das den Inhalt eines geschlossenen `<details>` ausblendet. Der Text steht
   * im Testbaum also auch zugeklappt da, und `queryByText(...)` wäre hier
   * eine Prüfung, die nie fehlschlägt. Geprüft wird deshalb zweierlei, das
   * sehr wohl fehlschlagen kann: dass die dichten Zahlen **nicht** in der
   * ruhigen Ebene stehen, und dass der Aufklapper zu beginnt und auf einen
   * Tap aufgeht.
   */
  it("hält die Ketten-Aufschlüsselung zugeklappt bereit", async () => {
    render(<OptimiererAnzeige optimierung={optimierung()} />);

    expect(kern().textContent).not.toContain("4,18");
    expect(aufklapper().textContent).toContain("4,18");
    expect(aufklapper().open).toBe(false);

    await userEvent.click(screen.getByText("Ketten im Detail"));
    expect(aufklapper().open).toBe(true);
  });

  /*
   * Der Kern des „Bester Einzelmarkt"-Zweigs: Eine Kette mit einer Lücke
   * bekommt keine Summe, sondern einen Satz. Stünde dort eine Zahl, wäre sie
   * die Summe über die Artikel, die es dort gibt — und damit die billigste
   * Kette der Liste, weil ihr am meisten fehlt.
   */
  it("schreibt bei einer unvollständigen Kette keine Summe, sondern warum", () => {
    render(
      <OptimiererAnzeige
        optimierung={optimierung({
          einzelmaerkte: [
            { kette: SPAR, summe: 3.99, vollstaendig: true },
            { kette: HOFER, summe: 1.39, vollstaendig: false },
          ],
        })}
      />,
    );

    const tabelle = screen.getByTestId("optimierer-einzelmaerkte");
    expect(tabelle.textContent).toContain("nicht alles hier erfasst");
    /*
     * Ausdrücklich auf der Einzelmarkt-Tabelle geprüft und nicht auf dem
     * ganzen Aufklapper: 1,39 € ist Hofers Summe über die Artikel, die es
     * dort gibt, und steht in der Aufteilung darunter völlig zu Recht. Falsch
     * wäre sie nur hier — als Antwort auf „was kostet der ganze Zettel bei
     * Hofer", wo sie die fehlenden Artikel stillschweigend wegließe.
     */
    expect(tabelle.textContent).not.toContain("1,39");
  });

  it("führt je Kette auf, was dort zu kaufen wäre", () => {
    render(<OptimiererAnzeige optimierung={optimierung()} />);

    const dicht = aufklapper().textContent ?? "";
    expect(dicht).toContain("Butter");
    expect(dicht).toContain("Milch");
    // Zwei Packungen Milch — ohne die Stückzahl ließe sich die Zeilensumme
    // nicht nachrechnen.
    expect(dicht).toContain("2 ×");
  });
});

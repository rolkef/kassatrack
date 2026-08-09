// Muss zuerst stehen: registriert happy-dom. `screen` kommt aus derselben
// Datei — siehe Begründung in tests/dom.ts.
import "./dom";

import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { PreisZeile } from "@/lib/preise";
import { HeuteSieger } from "@/app/produkte/[id]/heute-sieger";

function zeile(kuerzel: string, name: string, bestpreis: number | null): PreisZeile {
  return {
    kette: { id: `c-${kuerzel}`, name, kuerzel },
    referenzpreis: bestpreis,
    anzahl: bestpreis === null ? 0 : 1,
    letzteBeobachtung: bestpreis === null ? null : new Date(),
    aktion: null,
    bestpreis,
  };
}

function zeichne(zeilen: PreisZeile[], referenzSieger: PreisZeile | null = null) {
  const mitPreis = zeilen.filter((z) => z.bestpreis !== null);
  const sieger = mitPreis.reduce((a, b) => (b.bestpreis! < a.bestpreis! ? b : a));
  return render(
    <HeuteSieger
      sieger={sieger}
      referenzSieger={referenzSieger}
      zeilen={zeilen}
      einheit="G"
    />,
  );
}

afterEach(cleanup);

describe("HeuteSieger", () => {
  /*
   * Der Befund aus Review-Runde 1. Die Unterscheidung hing an `ersparnis > 0`
   * statt an der Zahl der Ketten: Liegen zwei Ketten zum selben Bestpreis, ist
   * die Ersparnis null, und der Bildschirm behauptete „bisher ist nur Spar
   * erfasst" — während die Tabelle direkt darunter zwei Ketten mit Preisen
   * zeigte. Gleiche Listenpreise bei zwei Ketten sind kein Randfall.
   */
  it("sagt bei Preisgleichstand nicht, es sei nur eine Kette erfasst", () => {
    zeichne([
      zeile("spar", "Spar", 9.16),
      zeile("hofer", "Hofer", 9.16),
      zeile("lidl", "Lidl", null),
    ]);

    const text = document.body.textContent ?? "";
    expect(text).toContain("gleichauf");
    expect(text).not.toContain("Bisher ist nur");
    // „günstiger als" wäre hier ebenso falsch: Es gibt nichts zu sparen.
    expect(text).not.toContain("günstiger als");
  });

  it("nennt die Ersparnis, wenn die Ketten auseinanderliegen", () => {
    zeichne([
      zeile("spar", "Spar", 9.16),
      zeile("penny", "Penny", 12.4),
    ]);

    const text = document.body.textContent ?? "";
    expect(text).toContain("3,24 €/kg günstiger als bei Penny");
    expect(text).not.toContain("gleichauf");
    expect(text).not.toContain("Bisher ist nur");
  });

  it("sagt bei genau einer erfassten Kette, dass der Vergleich noch fehlt", () => {
    zeichne([
      zeile("spar", "Spar", 9.16),
      zeile("hofer", "Hofer", null),
      zeile("lidl", "Lidl", null),
    ]);

    const text = document.body.textContent ?? "";
    expect(text).toContain("Bisher ist nur Spar erfasst");
    expect(text).not.toContain("gleichauf");
    expect(text).not.toContain("günstiger als");
  });

  it("zeigt Kette und Preis des Siegers", () => {
    zeichne([zeile("hofer", "Hofer", 8.76), zeile("penny", "Penny", 12.4)]);

    const text = document.body.textContent ?? "";
    expect(text).toContain("Hofer");
    expect(text).toContain("8,76");
    expect(text).toContain("€/kg");
  });

  it("nennt bei einer Aktion des Siegers, bis wann sie gilt", () => {
    const hofer = zeile("hofer", "Hofer", 8.76);
    hofer.aktion = { preis: 8.76, gueltigBis: new Date(2026, 7, 15) };

    zeichne([hofer, zeile("penny", "Penny", 12.4)]);
    expect(document.body.textContent).toContain("gültig bis 15.08.2026");
  });

  it("nennt den Referenz-Sieger als eigene Zeile, wenn es eine andere Kette ist", () => {
    const spar = zeile("spar", "Spar", 9.16);
    zeichne([zeile("hofer", "Hofer", 8.76), spar], spar);

    expect(document.body.textContent).toContain("Auf Dauer am günstigsten ist Spar mit 9,16 €/kg");
  });

  it("sagt es anders, wenn Heute-Sieger und Referenz-Sieger dieselbe Kette sind", () => {
    const hofer = zeile("hofer", "Hofer", 1.29);
    zeichne([hofer, zeile("billa", "Billa", 1.59)], hofer);

    const text = document.body.textContent ?? "";
    expect(text).toContain("Hofer ist auch sonst die günstigste Kette");
    expect(text).not.toContain("Auf Dauer am günstigsten ist");
  });
});

// Muss zuerst stehen: registriert happy-dom. `screen` kommt aus derselben
// Datei — siehe Begründung in tests/dom.ts.
import { screen } from "./dom";

import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { KETTEN } from "@/lib/katalog";
import type { PreisZeile } from "@/lib/preise";
import { PreisTabelle, VERALTET_TAGE } from "@/app/produkte/[id]/preis-tabelle";

const TAG = 86_400_000;

function vorTagen(tage: number): Date {
  return new Date(Date.now() - tage * TAG);
}

/** Eine Zeile ohne jede Beobachtung — der Ausgangszustand jeder Kette. */
function leereZeile(kuerzel: string, name: string): PreisZeile {
  return {
    kette: { id: `c-${kuerzel}`, name, kuerzel },
    referenzpreis: null,
    anzahl: 0,
    letzteBeobachtung: null,
    aktion: null,
    bestpreis: null,
  };
}

/** Alle fünf Ketten, leer — darüber legen die Tests einzelne Zeilen. */
function alleKetten(ueberschreibungen: Partial<Record<string, Partial<PreisZeile>>> = {}) {
  return KETTEN.map((eintrag) => ({
    ...leereZeile(eintrag.kuerzel, eintrag.name),
    ...(ueberschreibungen[eintrag.kuerzel] ?? {}),
  }));
}

function zeichne(zeilen: PreisZeile[]) {
  return render(<PreisTabelle zeilen={zeilen} einheit="G" />);
}

afterEach(cleanup);

describe("PreisTabelle", () => {
  it("zeigt alle fünf Ketten", () => {
    zeichne(alleKetten());

    for (const eintrag of KETTEN) {
      expect(screen.getByRole("rowheader", { name: new RegExp(eintrag.name) })).toBeDefined();
    }
  });

  /*
   * Der wichtigste Zustand dieses Bildschirms. „Keine Daten" ist eine Aussage,
   * kein Fehler — und sie muss sich von „teuer" unterscheiden lassen. Eine 0,00
   * an derselben Stelle wäre der billigste Preis der Tabelle und damit eine
   * Lüge, die genau in die Richtung zeigt, in der jemand handelt.
   */
  it("sagt „keine Daten“, wo nichts erfasst ist — und schreibt dort keine Null", () => {
    zeichne(alleKetten());

    expect(document.body.textContent).toContain("keine Daten");
    expect(document.body.textContent).not.toContain("0,00");
  });

  it("zeigt den Referenzpreis, wo einer da ist", () => {
    zeichne(
      alleKetten({
        spar: { referenzpreis: 9.96, anzahl: 3, letzteBeobachtung: vorTagen(4), bestpreis: 9.96 },
      }),
    );

    expect(document.body.textContent).toContain("9,96");
  });

  it("nennt, auf wie vielen Beobachtungen der Referenzpreis beruht", () => {
    zeichne(
      alleKetten({
        spar: { referenzpreis: 9.96, anzahl: 3, letzteBeobachtung: vorTagen(4), bestpreis: 9.96 },
      }),
    );

    expect(document.body.textContent).toContain("3 Preise");
  });

  /*
   * Ein Referenzpreis aus einer 170 Tage alten Beobachtung ist etwas anderes
   * als einer von gestern. Ohne die Kennzeichnung stünden beide als gleich
   * belastbare Zahl nebeneinander.
   */
  it("kennzeichnet einen Wert, der älter als die Frist ist, als veraltet", () => {
    zeichne(
      alleKetten({
        billa: {
          referenzpreis: 8.4,
          anzahl: 1,
          letzteBeobachtung: vorTagen(VERALTET_TAGE + 80),
          bestpreis: 8.4,
        },
      }),
    );

    expect(document.body.textContent).toContain("veraltet");
  });

  it("kennzeichnet einen frischen Wert nicht als veraltet", () => {
    zeichne(
      alleKetten({
        billa: { referenzpreis: 8.4, anzahl: 1, letzteBeobachtung: vorTagen(1), bestpreis: 8.4 },
      }),
    );

    expect(document.body.textContent).not.toContain("veraltet");
  });

  it("nennt bei einer laufenden Aktion, bis wann sie gilt", () => {
    const ende = new Date(Date.now() + 5 * TAG);
    zeichne(
      alleKetten({
        hofer: {
          referenzpreis: 11.16,
          anzahl: 2,
          letzteBeobachtung: vorTagen(3),
          aktion: { preis: 8.76, gueltigBis: ende },
          bestpreis: 8.76,
        },
      }),
    );

    const tag = String(ende.getDate()).padStart(2, "0");
    const monat = String(ende.getMonth() + 1).padStart(2, "0");
    expect(document.body.textContent).toContain(`bis ${tag}.${monat}.`);
    expect(document.body.textContent).toContain("8,76");
  });

  /*
   * Der Fall aus dem Ledger: `letzteBeobachtung` ist die jüngste **geholte**
   * Zeile, nicht die jüngste endliche. Über eine als "NaN" abgelegte
   * `numeric`-Zahl kann `anzahl` bei 0 stehen und `referenzpreis` bei null,
   * während ein Zeitstempel danebensteht. Eine Zeitangabe wäre dann eine
   * Aussage über eine Zahl, die es nicht gibt — „vor 3 Tagen" neben „keine
   * Daten" liest sich wie ein frischer Preis.
   */
  it("nennt keine Zeitangabe, wenn keine brauchbare Beobachtung eingegangen ist", () => {
    zeichne(
      alleKetten({
        penny: { referenzpreis: null, anzahl: 0, letzteBeobachtung: vorTagen(3), bestpreis: null },
      }),
    );

    expect(document.body.textContent).not.toContain("vor 3 Tagen");
    expect(document.body.textContent).toContain("keine Daten");
  });

  /*
   * Die Zahlenspalten tragen die Einheit nicht in jeder Zelle, sondern einmal
   * im Kopf — sonst stünde „€/kg" fünfmal untereinander und die Spalte wäre am
   * Handy nicht mehr zu lesen.
   */
  it("nennt die Bezugseinheit im Spaltenkopf", () => {
    zeichne(alleKetten());
    expect(screen.getByRole("columnheader", { name: /Referenz.*€\/kg/ })).toBeDefined();
  });

  /*
   * Ohne diesen Satz wäre die leere Aktionsspalte doppeldeutig: `aktion` ist
   * auch dann null, wenn eine Aktion läuft, aber den Referenzpreis nicht
   * unterbietet. Der Bildschirm kann diese beiden Lagen nicht auseinanderhalten
   * — also behauptet er auch nicht, es zu können.
   */
  it("sagt, unter welcher Bedingung eine Aktion überhaupt in der Tabelle steht", () => {
    zeichne(alleKetten());
    expect(document.body.textContent).toContain("unterbietet");
  });
});

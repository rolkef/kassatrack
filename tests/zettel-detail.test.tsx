// Muss zuerst stehen: registriert happy-dom. `screen` kommt aus derselben
// Datei — siehe Begründung in tests/dom.ts.
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ZettelArtikel } from "@/lib/einkaufszettel";
import type { Produkt } from "@/lib/katalog";

/*
 * Die vier Aktionen werden hereingereicht, nicht per `mock.module` ersetzt —
 * gleiche Begründung wie in `tests/listenzeile.test.tsx`: Ein globaler Ersatz
 * gälte in Bun für den ganzen Lauf und nähme
 * `tests/einkaufszettel-detail-aktionen.test.ts` die echten Aktionen weg.
 */

const BUTTER: Produkt = {
  id: "p1",
  name: "Butter",
  marke: "Berglandmilch",
  menge: 250,
  einheit: "G",
  bildSchluessel: null,
};

const ARTIKEL: ZettelArtikel[] = [
  { id: "a1", listId: "l1", produkt: BUTTER, freitext: null, stueckzahl: 1, abgehaktAm: null },
];

const FREITEXT_ARTIKEL: ZettelArtikel[] = [
  { id: "a2", listId: "l1", produkt: null, freitext: "Salz", stueckzahl: 2, abgehaktAm: null },
];

/** Was die Suchattrappe zurückgibt — je Test gesetzt. */
let suchTreffer: Produkt[] = [];

const artikelHinzufuegen = mock(
  async (_eingabe: {
    listId: string;
    produktId?: string;
    freitext?: string;
    stueckzahl?: number;
  }): Promise<void> => {},
);
/*
 * Damit ein Test die Aktion offen halten kann. `useOptimistic` gibt seine
 * Änderung frei, sobald der Übergang endet — was danach zu sehen ist, sind
 * die Daten vom Server. Die gibt es hier nicht, also lässt sich „sofort
 * sichtbar" nur prüfen, solange die Aktion noch läuft. Genau das ist auch
 * die Zusage: Die Zahl springt vor der Antwort um, nicht nach ihr.
 */
let stueckzahlHaengt = false;
let stueckzahlFreigabe: (() => void) | null = null;

const stueckzahlAendern = mock(
  async (_itemId: string, _stueckzahl: number, _listId: string): Promise<void> => {
    if (!stueckzahlHaengt) return;
    await new Promise<void>((aufloesen) => {
      stueckzahlFreigabe = aufloesen;
    });
  },
);
const entferneArtikel = mock(async (_itemId: string, _listId: string): Promise<void> => {});
const sucheProdukte = mock(async (begriff: string): Promise<Produkt[]> =>
  begriff.trim() === "" ? [] : suchTreffer,
);

const { ZettelDetail } = await import("@/app/einkaufszettel/[id]/zettel-detail");

afterEach(() => {
  cleanup();
  stueckzahlHaengt = false;
  stueckzahlFreigabe?.();
  stueckzahlFreigabe = null;
  suchTreffer = [];
  artikelHinzufuegen.mockClear();
  stueckzahlAendern.mockClear();
  entferneArtikel.mockClear();
  sucheProdukte.mockClear();
});

function zeichne(artikel: ZettelArtikel[] = ARTIKEL) {
  return render(
    <ZettelDetail
      listId="l1"
      artikel={artikel}
      artikelHinzufuegen={artikelHinzufuegen}
      stueckzahlAendern={stueckzahlAendern}
      entferneArtikel={entferneArtikel}
      sucheProdukte={sucheProdukte}
    />,
  );
}

const FELD = "Artikel hinzufügen";

describe("ZettelDetail — was daraufsteht", () => {
  it("zeigt jeden Artikel mit Namen", () => {
    zeichne();
    expect(screen.getByText("Butter")).toBeDefined();
  });

  /*
   * Marke und Gebindegröße sind hier kein Beiwerk, sondern das
   * Unterscheidungsmerkmal: „Butter 250 g" und „Butter 500 g" sind für
   * KassaTrack zwei Waren mit zwei Preisen.
   */
  it("nennt Marke und Gebindegröße eines Katalogartikels", () => {
    zeichne();
    expect(screen.getByText(/Berglandmilch/)).toBeDefined();
    expect(screen.getByText(/250 g/)).toBeDefined();
  });

  /*
   * Der Unterschied, um den es auf diesem Bildschirm geht: Ein Katalogartikel
   * wird über alle Ketten verglichen, ein Freitext ist bloß eine Notiz. Ohne
   * diesen Hinweis stünde man in Task 8 vor einer Summe, die eine Zeile
   * stillschweigend auslässt.
   */
  it("sagt bei einem Freitext-Artikel, dass er nicht verglichen wird", () => {
    zeichne(FREITEXT_ARTIKEL);
    expect(screen.getByText("Salz")).toBeDefined();
    expect(screen.getByText(/kein Preisvergleich/i)).toBeDefined();
  });

  it("erklärt einen leeren Zettel, statt ihn leer zu lassen", () => {
    zeichne([]);
    expect(document.body.textContent).toContain("Noch nichts daraufgeschrieben");
  });
});

describe("ZettelDetail — hinzufügen", () => {
  it("fügt einen Freitext-Artikel über das Eingabefeld hinzu", async () => {
    zeichne();
    await userEvent.type(screen.getByRole("searchbox", { name: FELD }), "Salz");
    await userEvent.click(screen.getByRole("button", { name: "Als Freitext hinzufügen" }));

    await waitFor(() => {
      expect(artikelHinzufuegen).toHaveBeenCalledWith(
        expect.objectContaining({ listId: "l1", freitext: "Salz" }),
      );
    });
  });

  it("leert das Feld nach dem Hinzufügen und behält den Fokus dort", async () => {
    zeichne();
    const feld = screen.getByRole("searchbox", { name: FELD });
    await userEvent.type(feld, "Salz");
    await userEvent.click(screen.getByRole("button", { name: "Als Freitext hinzufügen" }));

    await waitFor(() => {
      expect((feld as HTMLInputElement).value).toBe("");
      expect(document.activeElement).toBe(feld);
    });
  });

  it("bietet beim Tippen Katalogtreffer an und fügt den gewählten hinzu", async () => {
    suchTreffer = [BUTTER];
    zeichne([]);
    await userEvent.type(screen.getByRole("searchbox", { name: FELD }), "Butt");

    const treffer = await screen.findByRole("button", { name: /Butter.*Berglandmilch.*250 g/ });
    await userEvent.click(treffer);

    await waitFor(() => {
      expect(artikelHinzufuegen).toHaveBeenCalledWith(
        expect.objectContaining({ listId: "l1", produktId: "p1" }),
      );
    });
    // Ein Katalogtreffer wird als Produkt hinzugefügt, nicht als Freitext —
    // sonst verglichen ihn Optimierer und Preisseite nie.
    expect(artikelHinzufuegen.mock.calls[0]?.[0]?.freitext).toBeUndefined();
  });

  /*
   * Ohne Treffer ist der Freitext der Ausweg, nicht eine Sackgasse. Die
   * Meldung muss deshalb dorthin zeigen, statt bloß „nichts gefunden" zu
   * sagen.
   */
  it("weist bei fehlenden Treffern auf den Freitext hin", async () => {
    suchTreffer = [];
    zeichne([]);
    await userEvent.type(screen.getByRole("searchbox", { name: FELD }), "Zahnstocher");

    await waitFor(() => {
      expect(document.body.textContent).toContain("Nichts im Katalog");
    });
    expect(screen.getByRole("button", { name: "Als Freitext hinzufügen" })).toBeDefined();
  });

  /*
   * Im Browser aufgefallen: Zeigte `aria-labelledby` des Abschnitts auf das
   * Eingabefeld statt auf dessen Beschriftung, nahm der Abschnitt den *Wert*
   * des Felds als Namen — er hieß beim Tippen „Butter" und wechselte mit jedem
   * Tastendruck. Ein Abschnitt, dessen Name sich unter der Hand ändert, ist in
   * einer vorgelesenen Übersicht nicht wiederzufinden.
   */
  it("behält den Namen des Abschnitts, während getippt wird", async () => {
    suchTreffer = [];
    zeichne([]);
    expect(screen.getByRole("region", { name: FELD })).toBeDefined();

    await userEvent.type(screen.getByRole("searchbox", { name: FELD }), "Butter");
    // Erst die Suche auslaufen lassen, sonst liefe ihr Zeitgeber in den
    // nächsten Test hinein.
    await waitFor(() => {
      expect(document.body.textContent).toContain("Nichts im Katalog");
    });

    expect(screen.getByRole("region", { name: FELD })).toBeDefined();
  });

  it("sucht nicht, solange das Feld leer ist", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("searchbox", { name: FELD }));

    expect(sucheProdukte).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Als Freitext hinzufügen" })).toBeNull();
  });
});

describe("ZettelDetail — Stückzahl", () => {
  it("erhöht die Stückzahl", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Eins mehr/ }));

    await waitFor(() => {
      expect(stueckzahlAendern).toHaveBeenCalledWith("a1", 2, "l1");
    });
  });

  it("verringert die Stückzahl", async () => {
    zeichne(FREITEXT_ARTIKEL);
    await userEvent.click(screen.getByRole("button", { name: /Eins weniger/ }));

    await waitFor(() => {
      expect(stueckzahlAendern).toHaveBeenCalledWith("a2", 1, "l1");
    });
  });

  /*
   * Null Stück ist nicht „entfernt", sondern eine Zeile, die nichts verlangt
   * — und `stueckzahlAktion` wiese sie ohnehin ab. Entfernen ist eine eigene
   * Handlung mit einem eigenen Knopf.
   */
  it("lässt nicht unter eins zählen", async () => {
    zeichne();
    const weniger = screen.getByRole("button", { name: /Eins weniger/ }) as HTMLButtonElement;

    expect(weniger.disabled).toBe(true);
    await userEvent.click(weniger);
    expect(stueckzahlAendern).not.toHaveBeenCalled();
  });

  /*
   * Der Kern des Zählers. Wer im Geschäft auf „+" tippt, darf nicht auf eine
   * Serverantwort warten, um zu sehen, dass es angekommen ist. Geprüft wird
   * deshalb, während die Aktion noch offen ist.
   */
  it("zeigt die geänderte Stückzahl schon vor der Serverantwort an", async () => {
    stueckzahlHaengt = true;
    zeichne();

    await userEvent.click(screen.getByRole("button", { name: /Eins mehr/ }));

    await waitFor(() => {
      expect(screen.getByTestId("stueckzahl-a1").textContent).toContain("2");
    });
    expect(stueckzahlAendern).toHaveBeenCalledWith("a1", 2, "l1");
  });
});

describe("ZettelDetail — entfernen", () => {
  it("entfernt einen Artikel", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /entfernen/i }));

    await waitFor(() => {
      expect(entferneArtikel).toHaveBeenCalledWith("a1", "l1");
    });
  });

  /*
   * Mehrere Zeilen tragen dieselben drei Knöpfe. Ohne den Namen der Ware im
   * zugänglichen Namen hieße jeder von ihnen bloß „Entfernen" — in einer
   * vorgelesenen Liste wäre keiner vom anderen zu unterscheiden.
   */
  it("nennt die Ware im Namen der Zeilen-Knöpfe", () => {
    zeichne();
    expect(screen.getByRole("button", { name: /Entfernen.*Butter/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Eins mehr.*Butter/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Eins weniger.*Butter/ })).toBeDefined();
  });
});

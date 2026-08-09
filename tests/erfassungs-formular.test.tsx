// Muss zuerst stehen: registriert happy-dom. `screen` kommt aus derselben
// Datei — siehe Begründung in tests/dom.ts.
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { Ergebnis } from "@/app/erfassen/zustand";
import type { Kette } from "@/lib/katalog";

/*
 * Die Aktion wird hereingereicht, nicht per `mock.module` ersetzt: Der Ersatz
 * gälte in Bun für den ganzen Lauf und nähme `tests/erfassen-aktionen.test.ts`
 * die echte Aktion weg. Dieselbe Begründung wie bei `ZugangsZeile`.
 */
const erfasse = mock(
  async (_vorher: Ergebnis | undefined, _formular: FormData): Promise<Ergebnis> => ({
    art: "erfolg",
    produktId: "p1",
    grundpreis: "9,96 €/kg",
  }),
);

const KETTEN: Kette[] = [
  { id: "c1", name: "Billa", kuerzel: "billa" },
  { id: "c2", name: "Spar", kuerzel: "spar" },
  { id: "c3", name: "Hofer", kuerzel: "hofer" },
];

const { ErfassungsFormular } = await import("@/app/erfassen/erfassungs-formular");

afterEach(() => {
  cleanup();
  erfasse.mockClear();
});

function zeichne() {
  return render(<ErfassungsFormular ketten={KETTEN} aktion={erfasse} />);
}

/** Füllt das Formular so aus, wie es vor dem Regal ausgefüllt würde. */
async function fuelleAus(felder: Partial<Record<string, string>> = {}) {
  await userEvent.click(screen.getByRole("radio", { name: felder.kette ?? "Billa" }));
  await userEvent.type(screen.getByLabelText("Produkt"), felder.name ?? "Butter");
  await userEvent.type(screen.getByLabelText("Menge"), felder.menge ?? "250 g");
  await userEvent.type(screen.getByLabelText("Preis"), felder.preis ?? "2,49");
}

describe("ErfassungsFormular", () => {
  it("bietet jede Kette als eigene Auswahl an", () => {
    zeichne();
    for (const kette of KETTEN) {
      expect(screen.getByRole("radio", { name: kette.name })).toBeDefined();
    }
  });

  it("hat sichtbare Etiketten an allen Feldern, nicht nur Platzhalter", () => {
    zeichne();
    expect(screen.getByLabelText("Produkt")).toBeDefined();
    // Der Zusatz „optional" gehört zum Etikett und damit zum zugänglichen
    // Namen: Wer die Seite hört, soll ebenfalls erfahren, dass dieses Feld
    // leer bleiben darf.
    expect(screen.getByLabelText(/^Marke/)).toBeDefined();
    expect(screen.getByLabelText("Menge")).toBeDefined();
    expect(screen.getByLabelText("Preis")).toBeDefined();
  });

  /*
   * Der Kern dieses Bildschirms: Der Grundpreis steht da, **bevor** gespeichert
   * wird. Er ist die Information, wegen der man überhaupt tippt — erst er sagt,
   * ob 2,49 € für 250 g ein guter Preis ist.
   */
  it("rechnet den Grundpreis live aus, sobald Menge und Preis stehen", async () => {
    zeichne();
    await userEvent.type(screen.getByLabelText("Menge"), "250 g");
    await userEvent.type(screen.getByLabelText("Preis"), "2,49");

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("9,96 €/kg");
    });
    expect(erfasse).not.toHaveBeenCalled();
  });

  it("rechnet auf Liter um, wenn die Menge in Millilitern steht", async () => {
    zeichne();
    await userEvent.type(screen.getByLabelText("Menge"), "1,5 l");
    await userEvent.type(screen.getByLabelText("Preis"), "1,29");

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("0,86 €/l");
    });
  });

  it("sagt vor der ersten Eingabe, was an dieser Stelle stehen wird", () => {
    zeichne();
    expect(screen.getByRole("status").textContent).toContain("Grundpreis");
  });

  it("schickt die eingetragenen Felder an die Aktion", async () => {
    zeichne();
    await fuelleAus({ kette: "Hofer" });
    await userEvent.click(screen.getByRole("button", { name: /Preis speichern/i }));

    await waitFor(() => expect(erfasse).toHaveBeenCalledTimes(1));
    const daten = erfasse.mock.calls[0]?.[1];
    expect(daten.get("kette")).toBe("hofer");
    expect(daten.get("name")).toBe("Butter");
    expect(daten.get("menge")).toBe("250 g");
    expect(daten.get("preis")).toBe("2,49");
    expect(daten.get("preisart")).toBe("NORMAL");
  });

  /*
   * Ein Einkauf bedeutet mehrere Preise hintereinander. Bliebe die Kette nach
   * dem Speichern nicht stehen, kostete jedes weitere Produkt einen Griff mehr
   * als das erste — und zwar denselben, immer wieder.
   */
  it("lässt die Kette nach dem Speichern gewählt", async () => {
    zeichne();
    await fuelleAus({ kette: "Spar" });
    await userEvent.click(screen.getByRole("button", { name: /Preis speichern/i }));

    await waitFor(() => expect(erfasse).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect((screen.getByRole("radio", { name: "Spar" }) as HTMLInputElement).checked).toBe(true);
    });
  });

  it("leert die Produktfelder nach dem Speichern", async () => {
    zeichne();
    await fuelleAus();
    await userEvent.click(screen.getByRole("button", { name: /Preis speichern/i }));

    await waitFor(() => {
      expect((screen.getByLabelText("Produkt") as HTMLInputElement).value).toBe("");
    });
    expect((screen.getByLabelText("Menge") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Preis") as HTMLInputElement).value).toBe("");
  });

  /*
   * Eine Bestätigung, die verschwindet, wäre die schwächste Antwort. Was
   * erfasst wurde, bleibt stehen — mit dem Grundpreis, der aus der Datenbank
   * zurückkam.
   */
  it("stellt das Erfasste mit seinem Grundpreis hin, statt es verschwinden zu lassen", async () => {
    zeichne();
    await fuelleAus({ kette: "Hofer" });
    await userEvent.click(screen.getByRole("button", { name: /Preis speichern/i }));

    const liste = await screen.findByRole("list", { name: /erfasst/i });
    await waitFor(() => {
      expect(liste.textContent).toContain("Butter");
    });
    expect(liste.textContent).toContain("9,96 €/kg");
    expect(liste.textContent).toContain("Hofer");
  });

  it("sammelt mehrere Preise desselben Einkaufs untereinander", async () => {
    zeichne();
    await fuelleAus();
    await userEvent.click(screen.getByRole("button", { name: /Preis speichern/i }));
    await waitFor(() => expect(erfasse).toHaveBeenCalledTimes(1));

    erfasse.mockImplementationOnce(async () => ({
      art: "erfolg",
      produktId: "p2",
      grundpreis: "1,29 €/l",
    }));
    await userEvent.type(screen.getByLabelText("Produkt"), "Vollmilch");
    await userEvent.type(screen.getByLabelText("Menge"), "1 l");
    await userEvent.type(screen.getByLabelText("Preis"), "1,29");
    await userEvent.click(screen.getByRole("button", { name: /Preis speichern/i }));

    const liste = await screen.findByRole("list", { name: /erfasst/i });
    await waitFor(() => expect(liste.querySelectorAll("li").length).toBe(2));
    // Das Jüngste zuoberst: Wer gerade etwas erfasst hat, sucht es nicht unten.
    expect(liste.querySelectorAll("li")[0]?.textContent).toContain("Vollmilch");
  });

  /*
   * Fortschreitende Enthüllung: Das Feld für das Aktionsende hat nur dann einen
   * Sinn, wenn es um eine Aktion geht — und dann ist es Pflicht, weil sonst die
   * Bedingung `preis_aktion_hat_ende` aus Task 4 greift und der technische
   * Fehler an die Stelle der Erklärung tritt.
   */
  it("zeigt das Aktionsende erst, wenn Aktion gewählt ist", async () => {
    zeichne();
    expect(screen.queryByLabelText("Gültig bis")).toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: "Aktion" }));

    expect(await screen.findByLabelText("Gültig bis")).toBeDefined();
  });

  it("schickt Preisart und Aktionsende mit", async () => {
    zeichne();
    await fuelleAus();
    await userEvent.click(screen.getByRole("radio", { name: "Aktion" }));
    await userEvent.type(await screen.findByLabelText("Gültig bis"), "2099-12-31");
    await userEvent.click(screen.getByRole("button", { name: /Preis speichern/i }));

    await waitFor(() => expect(erfasse).toHaveBeenCalledTimes(1));
    const daten = erfasse.mock.calls[0]?.[1];
    expect(daten.get("preisart")).toBe("PROMO");
    expect(daten.get("gueltigBis")).toBe("2099-12-31");
  });

  it("meldet einen Fehler der Aktion an Hilfstechnik und lässt die Eingaben stehen", async () => {
    erfasse.mockImplementationOnce(async () => ({
      art: "fehler",
      meldung: "Der Preis ließ sich nicht speichern. Versuch es noch einmal.",
    }));

    zeichne();
    await fuelleAus();
    await userEvent.click(screen.getByRole("button", { name: /Preis speichern/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("nicht speichern");
    });
    // Die Eingaben dürfen nicht weg sein — sonst tippt man alles noch einmal.
    expect((screen.getByLabelText("Produkt") as HTMLInputElement).value).toBe("Butter");
    expect(screen.queryByRole("list", { name: /erfasst/i })).toBeNull();
  });

  /*
   * Im Browser gefunden, nicht am Schreibtisch: React setzt das Formular nach
   * **jeder** abgeschlossenen Aktion zurück, auch nach einer abgewiesenen.
   * Die Kette verschwand dabei aus der sichtbaren Auswahl, während der Zustand
   * sie weiter führte. Wer die Menge verbesserte und noch einmal abschickte,
   * verschickte damit gar keine Kette mehr und bekam „Wähl die Kette" — für
   * eine Kette, die er sehr wohl gewählt hatte. Eine Sackgasse, die genau in
   * dem Moment auftritt, in dem ohnehin schon etwas schiefgegangen ist.
   */
  it("behält die gewählte Kette auch nach einer Abweisung", async () => {
    erfasse.mockImplementationOnce(async () => ({ art: "fehler", meldung: "Abgewiesen." }));

    zeichne();
    await fuelleAus({ kette: "Spar" });
    await userEvent.click(screen.getByRole("button", { name: /Preis speichern/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect((screen.getByRole("radio", { name: "Spar" }) as HTMLInputElement).checked).toBe(true);
  });

  it("schickt die Kette beim zweiten Versuch nach einer Abweisung wieder mit", async () => {
    erfasse.mockImplementationOnce(async () => ({ art: "fehler", meldung: "Abgewiesen." }));

    zeichne();
    await fuelleAus({ kette: "Spar" });
    await userEvent.click(screen.getByRole("button", { name: /Preis speichern/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());

    await userEvent.click(screen.getByRole("button", { name: /Preis speichern/i }));

    await waitFor(() => expect(erfasse).toHaveBeenCalledTimes(2));
    expect(erfasse.mock.calls[1]?.[1].get("kette")).toBe("spar");
  });

  /*
   * Beim Tippen wäre eine Fehlermeldung sinnlos: „2" ist auf dem Weg zu
   * „250 g" zwangsläufig unvollständig. Erst wenn das Feld verlassen wird,
   * steht fest, dass die Eingabe so gemeint war.
   */
  it("beanstandet eine unverständliche Menge erst beim Verlassen des Feldes", async () => {
    zeichne();
    const feld = screen.getByLabelText("Menge");
    await userEvent.type(feld, "ein bisschen");

    expect(feld.getAttribute("aria-invalid")).toBeNull();

    await userEvent.tab();

    await waitFor(() => expect(feld.getAttribute("aria-invalid")).toBe("true"));
    const beschreibung = feld.getAttribute("aria-describedby");
    // Zahl und Einheit hängen an einem geschützten Leerzeichen zusammen, damit
    // die Zeile im schmalen Feld nicht mitten in „1,5 l" umbricht. Für den
    // Vergleich wird es zurückgesetzt.
    const text = document.getElementById(beschreibung!)?.textContent?.replaceAll(" ", " ");
    expect(text).toContain("250 g");
  });

  it("nimmt die Beanstandung zurück, sobald die Menge stimmt", async () => {
    zeichne();
    const feld = screen.getByLabelText("Menge");
    await userEvent.type(feld, "ein bisschen");
    await userEvent.tab();
    await waitFor(() => expect(feld.getAttribute("aria-invalid")).toBe("true"));

    await userEvent.clear(feld);
    await userEvent.type(feld, "250 g");

    await waitFor(() => expect(feld.getAttribute("aria-invalid")).toBeNull());
  });

  it("schickt ein leeres Formular gar nicht erst ab", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Preis speichern/i }));

    expect(erfasse).not.toHaveBeenCalled();
  });
});

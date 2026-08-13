// Muss zuerst stehen: registriert happy-dom. `screen` kommt aus derselben
// Datei — siehe Begründung in tests/dom.ts.
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { Ergebnis } from "@/app/erfassen/zustand";
import type { Kette } from "@/lib/katalog";
import { AbhakFormular } from "@/app/einkaufszettel/[id]/abhak-formular";

/*
 * Die Aktion wird hereingereicht, nicht per `mock.module` ersetzt: Der Ersatz
 * gälte in Bun für den ganzen Lauf und nähme `tests/erfassen-aktionen.test.ts`
 * die echte Aktion weg. Dieselbe Begründung wie im Erfassungsformular.
 */
let antwort: Ergebnis = {
  art: "erfolg",
  produktId: "p1",
  grundpreis: "9,96 €/kg",
};

const erfasse = mock(
  async (_vorher: Ergebnis | undefined, _formular: FormData): Promise<Ergebnis> => antwort,
);

const KETTEN: Kette[] = [
  { id: "c1", name: "Billa", kuerzel: "billa" },
  { id: "c2", name: "Spar", kuerzel: "spar" },
  { id: "c3", name: "Hofer", kuerzel: "hofer" },
];

afterEach(() => {
  cleanup();
  antwort = { art: "erfolg", produktId: "p1", grundpreis: "9,96 €/kg" };
  erfasse.mockClear();
});

const onAbgeschlossen = mock(() => {});
const onAbbrechen = mock(() => {});

afterEach(() => {
  onAbgeschlossen.mockClear();
  onAbbrechen.mockClear();
});

function zeichne(ueberschreibung: Partial<Parameters<typeof AbhakFormular>[0]> = {}) {
  return render(
    <AbhakFormular
      artikelId="a1"
      listId="l1"
      name="Butter"
      marke="Berglandmilch"
      menge="250 g"
      empfohleneKette="spar"
      ketten={KETTEN}
      aktion={erfasse}
      onAbgeschlossen={onAbgeschlossen}
      onAbbrechen={onAbbrechen}
      {...ueberschreibung}
    />,
  );
}

/** Das FormData des einzigen Aufrufs. */
function abgeschickt(): FormData {
  const [, formular] = erfasse.mock.calls[0]!;
  return formular;
}

describe("AbhakFormular — ein Katalogartikel", () => {
  /*
   * Die Empfehlung des Optimierers ist der ganze Grund, warum hier nicht die
   * volle Erfassungsseite steht: Wer den Zettel abarbeitet, steht in genau dem
   * Geschäft, das der Optimierer vorgeschlagen hat.
   */
  it("wählt die empfohlene Kette vor", () => {
    zeichne();
    expect(screen.getByRole("radio", { name: "Spar" })).toHaveProperty("checked", true);
    expect(screen.getByRole("radio", { name: "Hofer" })).toHaveProperty("checked", false);
  });

  it("sagt sichtbar dazu, warum diese Kette vorgewählt ist", () => {
    zeichne();
    expect(screen.getByText(/vorgeschlagen/i)).toBeDefined();
  });

  it("wählt nichts vor, wenn der Optimierer nichts zu empfehlen hat", () => {
    zeichne({ empfohleneKette: null });
    for (const kette of KETTEN) {
      expect(screen.getByRole("radio", { name: kette.name })).toHaveProperty("checked", false);
    }
    expect(screen.queryByText(/vorgeschlagen/i)).toBeNull();
  });

  /*
   * Das Herzstück: Produkt, Marke und Gebindegröße kommen aus dem Katalog und
   * werden mitgeschickt, ohne dass sie jemand abtippt. Sie müssen `erfasse`
   * exakt so erreichen, wie `findeProdukt` sie wiedererkennt — sonst legt
   * jedes Abhaken ein zweites Produkt an und der Preisvergleich zerfällt.
   */
  it("schickt Produkt, Marke, Menge, Zettel-Bezug und Liste mit", async () => {
    zeichne();
    await userEvent.type(screen.getByLabelText("Preis"), "2,49");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => {
      expect(erfasse).toHaveBeenCalled();
    });

    const formular = abgeschickt();
    expect(formular.get("name")).toBe("Butter");
    expect(formular.get("marke")).toBe("Berglandmilch");
    expect(formular.get("menge")).toBe("250 g");
    expect(formular.get("preis")).toBe("2,49");
    expect(formular.get("kette")).toBe("spar");
    expect(formular.get("zettelItemId")).toBe("a1");
    expect(formular.get("listId")).toBe("l1");
  });

  /*
   * Beim Abhaken wird ein Regalpreis erfasst, kein Sonderfall. Käme hier
   * `PROMO` durch, verlangte `erfasse` ein Gültig-bis-Datum, das dieses
   * Formular gar nicht hat.
   */
  it("erfasst einen Normalpreis", async () => {
    zeichne();
    await userEvent.type(screen.getByLabelText("Preis"), "2,49");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => {
      expect(erfasse).toHaveBeenCalled();
    });
    expect(abgeschickt().get("preisart")).toBe("NORMAL");
  });

  it("meldet dem Zettel, dass gespeichert ist", async () => {
    zeichne();
    await userEvent.type(screen.getByLabelText("Preis"), "2,49");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => {
      expect(onAbgeschlossen).toHaveBeenCalled();
    });
  });

  /*
   * Die Zusage aus dem Entwurf, hier von der Oberflächenseite: Wird die
   * Erfassung abgewiesen, ist nichts passiert — und das Formular bleibt mit
   * der Begründung stehen, statt sich zuzuklappen und den Artikel als erledigt
   * auszugeben.
   */
  it("bleibt bei einer Abweisung stehen und nennt den Grund", async () => {
    antwort = {
      art: "fehler",
      meldung: "Der Preis muss eine Zahl zwischen 0,01 und 99.999,99 sein.",
    };
    zeichne();
    await userEvent.type(screen.getByLabelText("Preis"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("0,01");
    });
    expect(onAbgeschlossen).not.toHaveBeenCalled();
  });

  /*
   * Im Browser aufgefallen: React setzt ein Formular zurück, sobald seine
   * Aktion fertig ist — auch bei einer Abweisung. Uneingebundene Felder standen
   * danach leer da. Beim Preis wäre das noch zu verschmerzen, beim Freitext
   * darunter nicht: Ein Tippfehler im Preis kostete dann auch Produktname und
   * Gebindegröße. Die Kette muss dabei gewählt bleiben.
   */
  it("lässt die Eingaben nach einer Abweisung stehen", async () => {
    antwort = { art: "fehler", meldung: "So nicht." };
    zeichne({ name: "Salz", marke: null, menge: null, empfohleneKette: "spar" });

    await userEvent.type(screen.getByLabelText("Menge"), "500 g");
    await userEvent.type(screen.getByLabelText("Preis"), "0,89");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });

    expect(screen.getByLabelText("Produkt")).toHaveProperty("value", "Salz");
    expect(screen.getByLabelText("Menge")).toHaveProperty("value", "500 g");
    expect(screen.getByLabelText("Preis")).toHaveProperty("value", "0,89");
    expect(screen.getByRole("radio", { name: "Spar" })).toHaveProperty("checked", true);
  });

  /*
   * Ohne diesen Ausweg wäre das Abhaken eine Sackgasse: Wer versehentlich
   * darauf getippt hat, käme aus dem Formular nur heraus, indem er einen Preis
   * erfindet.
   */
  it("lässt sich abbrechen, ohne etwas zu speichern", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(onAbbrechen).toHaveBeenCalled();
    expect(erfasse).not.toHaveBeenCalled();
  });

  it("bietet für einen Katalogartikel keine Felder für Produkt und Menge an", () => {
    zeichne();
    expect(screen.queryByLabelText("Produkt")).toBeNull();
    expect(screen.queryByLabelText("Menge")).toBeNull();
  });
});

describe("AbhakFormular — ein Freitext-Artikel", () => {
  /*
   * Ein Freitext hat kein Produkt hinter sich, also auch keine Gebindegröße.
   * Beides muss hier eingetippt werden — und genau dadurch wird aus der Notiz
   * beim ersten Abhaken ein Katalogprodukt, ganz ohne eigenen Bildschirm
   * dafür.
   */
  it("fragt Produkt und Menge ab, mit dem Notizzettel-Text als Vorschlag", () => {
    zeichne({ name: "Salz", marke: null, menge: null, empfohleneKette: null });

    expect(screen.getByLabelText("Produkt")).toHaveProperty("value", "Salz");
    expect(screen.getByLabelText("Menge")).toHaveProperty("value", "");
  });

  it("schickt die eingetippte Menge mit", async () => {
    zeichne({ name: "Salz", marke: null, menge: null, empfohleneKette: null });

    await userEvent.type(screen.getByLabelText("Menge"), "500 g");
    await userEvent.type(screen.getByLabelText("Preis"), "0,89");
    await userEvent.click(screen.getByRole("radio", { name: "Hofer" }));
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => {
      expect(erfasse).toHaveBeenCalled();
    });

    const formular = abgeschickt();
    expect(formular.get("name")).toBe("Salz");
    expect(formular.get("menge")).toBe("500 g");
    expect(formular.get("kette")).toBe("hofer");
    expect(formular.get("zettelItemId")).toBe("a1");
  });
});

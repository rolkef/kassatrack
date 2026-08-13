// Muss zuerst stehen: registriert happy-dom. `screen` kommt aus derselben
// Datei — siehe Begründung in tests/dom.ts.
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { EanErgebnis } from "@/app/erfassen/ean-zustand";
import type { Decoder } from "@/app/erfassen/strichcode-scanner";
import type { Ergebnis } from "@/app/erfassen/zustand";
import type { Kette, Produkt } from "@/lib/katalog";

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

/* Aus demselben Grund hereingereicht wie `erfasse` — nicht per `mock.module`. */
const loeseEanAuf = mock(async (_ean: string): Promise<EanErgebnis> => ({ art: "unbekannt" }));

const BUTTER: Produkt = {
  id: "p1",
  name: "Butter",
  marke: "Berglandmilch",
  menge: 250,
  einheit: "G",
  bildSchluessel: null,
};

/** Dasselbe Produkt, nachdem sein Bild im eigenen Volume liegt. */
const BUTTER_MIT_BILD: Produkt = { ...BUTTER, bildSchluessel: "9001234567892.jpg" };

/*
 * Die Adresse, die Open Food Facts im Vorschlag mitliefert. Sie darf im
 * ausgelieferten Markup **nirgends** auftauchen — siehe den Regressionstest
 * ganz unten.
 */
const OFF_BILD = "https://images.openfoodfacts.org/images/products/butter.jpg";

const bestaetigeZuordnung = mock(
  async (_eingabe: {
    ean: string;
    produktId?: string;
    neu?: unknown;
    bildUrl?: string | null;
  }): Promise<Produkt> => BUTTER,
);

const KETTEN: Kette[] = [
  { id: "c1", name: "Billa", kuerzel: "billa" },
  { id: "c2", name: "Spar", kuerzel: "spar" },
  { id: "c3", name: "Hofer", kuerzel: "hofer" },
];

const EAN = "9001234567892";

/*
 * Auf Modulebene und nicht in `zeichne()`: Ein bei jedem Render neu erzeugter
 * Decoder ließe die Leseschleife des Scanners jedes Mal neu anlaufen — genau
 * der Fall, den `beiErkanntemCode` mit `useCallback` vermeidet.
 */
const DECODER: Decoder = { erkenne: async () => [EAN] };

/**
 * Eine Kamera, die sich auch wieder abschalten lässt — die Begründung dafür
 * steht ausführlich in `tests/strichcode-scanner.test.tsx`.
 */
const kameraStarten = async () =>
  Object.assign(new MediaStream(), {
    getTracks: () => [{ stop: () => {} } as unknown as MediaStreamTrack],
  });

const { ErfassungsFormular } = await import("@/app/erfassen/erfassungs-formular");

afterEach(() => {
  cleanup();
  erfasse.mockClear();
  loeseEanAuf.mockClear();
  bestaetigeZuordnung.mockClear();
});

function zeichne() {
  return render(
    <ErfassungsFormular
      ketten={KETTEN}
      aktion={erfasse}
      loeseEanAuf={loeseEanAuf}
      bestaetigeZuordnung={bestaetigeZuordnung}
      decoder={DECODER}
      kameraStarten={kameraStarten}
    />,
  );
}

/** Scannt einen Strichcode über den injizierten Decoder — wie am Regal. */
async function scanne() {
  await userEvent.click(screen.getByRole("button", { name: "Strichcode scannen" }));
  await waitFor(() => expect(loeseEanAuf).toHaveBeenCalledWith(EAN));
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

describe("ErfassungsFormular — Strichcode", () => {
  it("füllt Name, Marke und Menge, wenn die EAN bereits bekannt ist", async () => {
    loeseEanAuf.mockResolvedValueOnce({ art: "bekannt", produkt: BUTTER });
    zeichne();

    await scanne();

    await waitFor(() => {
      expect((screen.getByLabelText("Produkt") as HTMLInputElement).value).toBe("Butter");
    });
    expect((screen.getByLabelText(/^Marke/) as HTMLInputElement).value).toBe("Berglandmilch");
    // Nicht „250 G": Was hier steht, muss `zerlegeMenge` wieder verstehen,
    // sonst beanstandet das Formular seine eigene Eingabe.
    expect((screen.getByLabelText("Menge") as HTMLInputElement).value).toBe("250 g");
    expect(bestaetigeZuordnung).not.toHaveBeenCalled();
  });

  it("legt auf Wunsch ein neues Produkt an und übernimmt es", async () => {
    loeseEanAuf.mockResolvedValueOnce({
      art: "vorschlag",
      ean: EAN,
      kandidat: {
        name: "Butter",
        marke: "Berglandmilch",
        menge: 250,
        einheit: "G",
        bildUrl: "https://example.test/butter.jpg",
      },
      aehnliche: [],
    });
    zeichne();

    await scanne();

    await waitFor(() => {
      expect(screen.getByRole("group", { name: /Vorschlag/i })).toBeDefined();
    });
    await userEvent.click(screen.getByRole("button", { name: /Neues Produkt anlegen/i }));

    await waitFor(() => expect(bestaetigeZuordnung).toHaveBeenCalledTimes(1));
    expect(bestaetigeZuordnung.mock.calls[0]?.[0]).toEqual({
      ean: EAN,
      produktId: undefined,
      neu: { name: "Butter", marke: "Berglandmilch", menge: 250, einheit: "G" },
      bildUrl: "https://example.test/butter.jpg",
    });
    await waitFor(() => {
      expect((screen.getByLabelText("Produkt") as HTMLInputElement).value).toBe("Butter");
    });
  });

  it("verknüpft die EAN mit einem bestehenden Produkt, statt ein zweites anzulegen", async () => {
    const vorhanden: Produkt = {
      id: "p9",
      name: "Butter",
      marke: "Kärntnermilch",
      menge: 250,
      einheit: "G",
      bildSchluessel: null,
    };
    loeseEanAuf.mockResolvedValueOnce({
      art: "vorschlag",
      ean: EAN,
      kandidat: { name: "Butter", marke: "Berglandmilch", menge: 250, einheit: "G", bildUrl: null },
      aehnliche: [vorhanden],
    });
    bestaetigeZuordnung.mockResolvedValueOnce(vorhanden);
    zeichne();

    await scanne();

    const zeile = await screen.findByRole("button", { name: /Ist dasselbe wie Butter/i });
    await userEvent.click(zeile);

    await waitFor(() => expect(bestaetigeZuordnung).toHaveBeenCalledTimes(1));
    const eingabe = bestaetigeZuordnung.mock.calls[0]?.[0];
    expect(eingabe?.produktId).toBe("p9");
    expect(eingabe?.neu).toBeUndefined();
    await waitFor(() => {
      expect((screen.getByLabelText(/^Marke/) as HTMLInputElement).value).toBe("Kärntnermilch");
    });
  });

  /*
   * Die Reihenfolge ist die eigentliche Absicherung gegen Doppelanlagen: Steht
   * „Neues Produkt anlegen" über den Treffern oder als einzige betonte Wahl
   * daneben, tippt man es — und der Katalog führt nach zwei Einkäufen drei
   * Sorten Butter, obwohl die Ähnlichkeitssuche sie gefunden hatte.
   */
  it("stellt bestehende Produkte vor die Neuanlage", async () => {
    loeseEanAuf.mockResolvedValueOnce({
      art: "vorschlag",
      ean: EAN,
      kandidat: { name: "Butter", marke: null, menge: 250, einheit: "G", bildUrl: null },
      aehnliche: [
        { id: "p9", name: "Butter", marke: null, menge: 250, einheit: "G", bildSchluessel: null },
      ],
    });
    zeichne();

    await scanne();

    const gruppe = await screen.findByRole("group", { name: /Vorschlag/i });
    const beschriftungen = [...gruppe.querySelectorAll("button")].map((knopf) => knopf.textContent);
    expect(beschriftungen[0]).toContain("Ist dasselbe wie");
    expect(beschriftungen[1]).toContain("Neues Produkt anlegen");
  });

  it("lässt die Eingabe unberührt, wenn den Strichcode niemand kennt", async () => {
    zeichne();
    await scanne();

    await waitFor(() => {
      expect(screen.getByText(/kennt weder KassaTrack noch Open Food Facts/)).toBeDefined();
    });
    expect((screen.getByLabelText("Produkt") as HTMLInputElement).value).toBe("");
    expect(bestaetigeZuordnung).not.toHaveBeenCalled();
  });

  /*
   * `holeOffProdukt` reicht Netzwerkfehler ausdrücklich weiter — und gescannt
   * wird im Supermarkt. Ohne diesen Zweig bliebe die abgewiesene Zusage
   * unbehandelt und der Bildschirm hinge stumm auf „wird nachgeschlagen".
   */
  it("sagt es und lässt die manuelle Eingabe offen, wenn das Nachschlagen fehlschlägt", async () => {
    loeseEanAuf.mockImplementationOnce(async () => {
      throw new Error("fetch failed");
    });
    zeichne();
    await scanne();

    await waitFor(() => {
      expect(screen.getByText(/ließ sich nicht nachschlagen/)).toBeDefined();
    });
    expect((screen.getByLabelText("Produkt") as HTMLInputElement).value).toBe("");
  });

  it("verwirft den Vorschlag auf Wunsch und zeigt die Scan-Schaltfläche wieder", async () => {
    loeseEanAuf.mockResolvedValueOnce({
      art: "vorschlag",
      ean: EAN,
      kandidat: { name: "Butter", marke: null, menge: 250, einheit: "G", bildUrl: null },
      aehnliche: [],
    });
    zeichne();
    await scanne();

    await userEvent.click(await screen.findByRole("button", { name: /Passt nicht/i }));

    expect(screen.queryByRole("group", { name: /Vorschlag/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Strichcode scannen" })).toBeDefined();
    expect(bestaetigeZuordnung).not.toHaveBeenCalled();
  });

  it("zeigt das zwischengespeicherte Produktbild, wenn die bekannte EAN eines trägt", async () => {
    loeseEanAuf.mockResolvedValueOnce({ art: "bekannt", produkt: BUTTER_MIT_BILD });
    zeichne();

    await scanne();

    const bild = await screen.findByRole("img", { name: "Butter" });
    expect(bild.getAttribute("src")).toBe("/bilder/produkte/9001234567892.jpg");
  });

  it("zeigt kein Bild, wenn das aufgelöste Produkt keines trägt", async () => {
    loeseEanAuf.mockResolvedValueOnce({ art: "bekannt", produkt: BUTTER });
    zeichne();

    await scanne();

    await waitFor(() => expect(screen.getByText(/Aus dem Strichcode übernommen/)).toBeDefined());
    expect(screen.queryByRole("img")).toBeNull();
  });

  /*
   * Das Bild entsteht erst in `bestaetigeZuordnung` — die Aktion lädt es
   * serverseitig herunter und gibt das Produkt mit gesetztem `bildSchluessel`
   * zurück. Vorher gibt es nichts anzuzeigen, was aus dem eigenen
   * Zwischenspeicher käme.
   */
  it("zeigt das Bild, sobald die bestätigte Zuordnung eines mitbringt", async () => {
    loeseEanAuf.mockResolvedValueOnce({
      art: "vorschlag",
      ean: EAN,
      kandidat: { name: "Butter", marke: "Berglandmilch", menge: 250, einheit: "G", bildUrl: OFF_BILD },
      aehnliche: [],
    });
    bestaetigeZuordnung.mockResolvedValueOnce(BUTTER_MIT_BILD);
    zeichne();

    await scanne();
    await userEvent.click(await screen.findByRole("button", { name: /Neues Produkt anlegen/i }));

    const bild = await screen.findByRole("img", { name: "Butter" });
    expect(bild.getAttribute("src")).toBe("/bilder/produkte/9001234567892.jpg");
  });

  /*
   * Der wichtigste Test dieser Datei.
   *
   * Der Vorschlag trägt die Bildadresse von Open Food Facts bei sich. Würde
   * sie je in ein `src` geraten, holte sich der **Browser** das Bild direkt
   * dort — und Open Food Facts erführe von jedem einzelnen Scan samt IP-Adresse
   * und Zeitpunkt. Genau davor steht die ganze Kette aus
   * `ladeUndSpeichereBild`, dem eigenen Volume und der eigenen Route: Bilder
   * kommen ausschließlich von hier. Der Test prüft deshalb nicht nur, dass
   * gerade kein `<img>` dasteht, sondern dass die fremde Adresse im gesamten
   * Markup nicht vorkommt und jedes vorhandene Bild aus der eigenen Route
   * stammt.
   */
  it("lädt im Vorschlag nichts von Open Food Facts — die fremde Adresse steht nirgends im Markup", async () => {
    loeseEanAuf.mockResolvedValueOnce({
      art: "vorschlag",
      ean: EAN,
      kandidat: { name: "Butter", marke: "Berglandmilch", menge: 250, einheit: "G", bildUrl: OFF_BILD },
      aehnliche: [
        { id: "p9", name: "Butter", marke: null, menge: 250, einheit: "G", bildSchluessel: null },
      ],
    });
    bestaetigeZuordnung.mockResolvedValueOnce(BUTTER_MIT_BILD);
    zeichne();

    await scanne();
    await screen.findByRole("group", { name: /Vorschlag/i });

    expect(document.body.innerHTML).not.toContain(OFF_BILD);
    expect(document.body.innerHTML).not.toContain("openfoodfacts.org");
    expect(screen.queryByRole("img")).toBeNull();

    // Und auch nach der Bestätigung nicht: Was dann erscheint, kommt aus der
    // eigenen Route.
    await userEvent.click(screen.getByRole("button", { name: /Neues Produkt anlegen/i }));
    await screen.findByRole("img", { name: "Butter" });

    expect(document.body.innerHTML).not.toContain("openfoodfacts.org");
    for (const bild of document.querySelectorAll("img")) {
      expect(bild.getAttribute("src")).toMatch(/^\/bilder\/produkte\//);
    }
  });

  it("nimmt die Scan-Meldung nach dem Speichern zurück", async () => {
    loeseEanAuf.mockResolvedValueOnce({ art: "bekannt", produkt: BUTTER });
    zeichne();
    await scanne();
    await waitFor(() => expect(screen.getByText(/Aus dem Strichcode übernommen/)).toBeDefined());

    await userEvent.click(screen.getByRole("radio", { name: "Billa" }));
    await userEvent.type(screen.getByLabelText("Preis"), "2,49");
    await userEvent.click(screen.getByRole("button", { name: /Preis speichern/i }));

    await waitFor(() => expect(erfasse).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.queryByText(/Aus dem Strichcode übernommen/)).toBeNull();
    });
  });
});

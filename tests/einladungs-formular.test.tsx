// Muss zuerst stehen: registriert happy-dom. `screen` kommt aus derselben
// Datei — siehe Begründung in tests/dom.ts.
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { EinladungsZustand } from "@/app/verwaltung/zugriff/zustand";

const FERTIG: EinladungsZustand = {
  art: "fertig",
  email: "neu@example.at",
  link: "https://kassatrack.example.at/einladung/abc123",
  gueltigBis: "26.03.2026",
};

// Die Signatur ist ausgeschrieben, damit `mock.calls[…][1]` als FormData
// typisiert ist — sonst hält TypeScript die Aufrufliste für leer.
const ladeEin = mock(
  async (_vorher: EinladungsZustand, _formular: FormData): Promise<EinladungsZustand> => FERTIG,
);

mock.module("@/app/verwaltung/zugriff/aktionen", () => ({
  ladeEin,
  entziehe: mock(async () => ({ fehler: null })),
}));

const { EinladungsFormular } = await import("@/app/verwaltung/zugriff/einladungs-formular");

/** Ersetzt die Zwischenablage, die happy-dom nicht mitbringt. */
function stelleZwischenablage(schreibe: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: schreibe },
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  ladeEin.mockClear();
});

describe("EinladungsFormular", () => {
  it("hat ein sichtbares Etikett am Eingabefeld, nicht nur einen Platzhalter", () => {
    render(<EinladungsFormular />);
    expect(screen.getByLabelText(/E-Mail-Adresse/i)).toBeDefined();
  });

  it("benennt die Schaltfläche nach dem, was sie tut", () => {
    render(<EinladungsFormular />);
    expect(screen.getByRole("button", { name: /Einladung erstellen/i })).toBeDefined();
  });

  it("schickt die eingetragene Adresse an die Aktion", async () => {
    render(<EinladungsFormular />);
    await userEvent.type(screen.getByLabelText(/E-Mail-Adresse/i), "neu@example.at");
    await userEvent.click(screen.getByRole("button", { name: /Einladung erstellen/i }));

    await waitFor(() => expect(ladeEin).toHaveBeenCalledTimes(1));
    expect(ladeEin.mock.calls[0]?.[1].get("email")).toBe("neu@example.at");
  });

  it("zeigt den erzeugten Link im Klartext an", async () => {
    render(<EinladungsFormular />);
    await userEvent.type(screen.getByLabelText(/E-Mail-Adresse/i), "neu@example.at");
    await userEvent.click(screen.getByRole("button", { name: /Einladung erstellen/i }));

    await waitFor(() => {
      expect(document.body.textContent).toContain(FERTIG.link);
    });
  });

  /*
   * Der eigentliche Zweck dieses Bildschirms: Der Link wird per Nachricht
   * weitergeschickt. Ohne einen Griff zum Kopieren wäre die Seite nur halb
   * fertig.
   */
  it("kopiert den Link mit einem Griff in die Zwischenablage", async () => {
    const geschrieben: string[] = [];
    stelleZwischenablage(async (text) => {
      geschrieben.push(text);
    });

    render(<EinladungsFormular />);
    await userEvent.type(screen.getByLabelText(/E-Mail-Adresse/i), "neu@example.at");
    await userEvent.click(screen.getByRole("button", { name: /Einladung erstellen/i }));

    await userEvent.click(await screen.findByRole("button", { name: /Link kopieren/i }));

    await waitFor(() => expect(geschrieben).toEqual([FERTIG.link]));
    expect(screen.getByRole("status").textContent).toContain("kopiert");
  });

  it("wird bei einer gescheiterten Zwischenablage nicht zur Sackgasse", async () => {
    stelleZwischenablage(async () => {
      throw new Error("verboten");
    });

    render(<EinladungsFormular />);
    await userEvent.type(screen.getByLabelText(/E-Mail-Adresse/i), "neu@example.at");
    await userEvent.click(screen.getByRole("button", { name: /Einladung erstellen/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Link kopieren/i }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Markier den Link");
    });
    // Und der Link steht weiterhin da, zum Markieren von Hand.
    expect(document.body.textContent).toContain(FERTIG.link);
  });

  /*
   * `type="email"` und `required` lassen das Formular gar nicht erst abschicken,
   * solange die Eingabe offensichtlich keine Adresse ist — die Prüfung im
   * Browser greift vor der Aktion. Die Prüfung in `ladeEin` bleibt trotzdem
   * nötig: Server-Aktionen sind eigene Endpunkte und von außen auch ohne
   * Formular aufrufbar.
   */
  it("schickt eine offensichtlich falsche Eingabe gar nicht erst ab", async () => {
    render(<EinladungsFormular />);
    await userEvent.type(screen.getByLabelText(/E-Mail-Adresse/i), "kaputt");
    await userEvent.click(screen.getByRole("button", { name: /Einladung erstellen/i }));

    expect(ladeEin).not.toHaveBeenCalled();
  });

  it("zeigt einen Fehler am Feld und meldet ihn an Hilfstechnik", async () => {
    ladeEin.mockImplementationOnce(async () => ({
      art: "fehler",
      text: "Die Einladung konnte nicht angelegt werden. Versuch es noch einmal.",
    }));

    render(<EinladungsFormular />);
    await userEvent.type(screen.getByLabelText(/E-Mail-Adresse/i), "neu@example.at");
    await userEvent.click(screen.getByRole("button", { name: /Einladung erstellen/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("nicht angelegt werden");
    });

    const feld = screen.getByLabelText(/E-Mail-Adresse/i);
    expect(feld.getAttribute("aria-invalid")).toBe("true");
    const beschreibung = feld.getAttribute("aria-describedby");
    expect(document.getElementById(beschreibung!)?.textContent).toContain("noch einmal");
  });

  it("zeigt bei einem Fehler keinen Link an", async () => {
    ladeEin.mockImplementationOnce(async () => ({ art: "fehler", text: "Kaputt." }));

    render(<EinladungsFormular />);
    await userEvent.type(screen.getByLabelText(/E-Mail-Adresse/i), "neu@example.at");
    await userEvent.click(screen.getByRole("button", { name: /Einladung erstellen/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(screen.queryByRole("button", { name: /Link kopieren/i })).toBeNull();
  });
});

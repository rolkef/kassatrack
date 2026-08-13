// Muss zuerst stehen: registriert happy-dom. `screen` kommt aus derselben
// Datei — siehe Begründung in tests/dom.ts.
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ListenErgebnis } from "@/app/einkaufszettel/zustand";

/*
 * Die Aktion wird als Eigenschaft übergeben, nicht per `mock.module` ersetzt.
 * `mock.module` gilt in Bun für den **gesamten** Lauf; ein globaler Ersatz des
 * Aktionsmoduls nähme `tests/einkaufszettel-aktionen.test.ts` die echten
 * Aktionen weg. Ausführliche Begründung an `ZugangsZeile`.
 */
const anlegen = mock(
  async (_vorher: ListenErgebnis | undefined, _formular: FormData): Promise<ListenErgebnis> => ({
    art: "erfolg",
    id: "l1",
  }),
);

const { ListenFormular } = await import("@/app/einkaufszettel/listenformular");

afterEach(() => {
  cleanup();
  anlegen.mockClear();
});

function feld(): HTMLInputElement {
  return screen.getByLabelText("Name der Liste") as HTMLInputElement;
}

describe("ListenFormular", () => {
  it("hat ein beschriftetes Namensfeld", () => {
    render(<ListenFormular aktion={anlegen} />);
    expect(feld()).toBeDefined();
  });

  it("gibt den eingegebenen Namen an die Aktion weiter", async () => {
    render(<ListenFormular aktion={anlegen} />);
    await userEvent.type(feld(), "Wocheneinkauf");
    await userEvent.click(screen.getByRole("button", { name: "Liste anlegen" }));

    await waitFor(() => expect(anlegen).toHaveBeenCalledTimes(1));
    expect(anlegen.mock.calls[0]?.[1].get("name")).toBe("Wocheneinkauf");
  });

  it("zeigt eine Fehlermeldung", async () => {
    anlegen.mockResolvedValueOnce({ art: "fehler", meldung: "Gib der Liste einen Namen." });
    render(<ListenFormular aktion={anlegen} />);
    await userEvent.click(screen.getByRole("button", { name: "Liste anlegen" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Gib der Liste einen Namen.");
    });
  });

  it("meldet nichts, solange nichts schiefgegangen ist", () => {
    render(<ListenFormular aktion={anlegen} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /*
   * Ohne das Leeren stünde der eben angelegte Name weiter im Feld, und der
   * nächste Griff — noch eine Liste anlegen — ergäbe stillschweigend eine
   * zweite Liste desselben Namens. Genau dieselbe Überlegung wie beim
   * Erfassungsformular, das seine Felder nach dem Speichern räumt.
   */
  it("leert das Feld nach dem Anlegen", async () => {
    render(<ListenFormular aktion={anlegen} />);
    await userEvent.type(feld(), "Wocheneinkauf");
    await userEvent.click(screen.getByRole("button", { name: "Liste anlegen" }));

    await waitFor(() => expect(feld().value).toBe(""));
  });

  /*
   * Und die Gegenprobe: Nach einer Abweisung muss die Eingabe stehen bleiben.
   * React setzt ein Formular nach jeder abgeschlossenen Aktion selbst zurück —
   * auch nach einer gescheiterten. Wer „Wocheneinkauf" getippt hat und eine
   * technische Fehlermeldung bekommt, dürfte sonst noch einmal tippen.
   */
  it("lässt die Eingabe nach einer Abweisung stehen", async () => {
    anlegen.mockResolvedValueOnce({ art: "fehler", meldung: "Ging gerade nicht." });
    render(<ListenFormular aktion={anlegen} />);
    await userEvent.type(feld(), "Wocheneinkauf");
    await userEvent.click(screen.getByRole("button", { name: "Liste anlegen" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(feld().value).toBe("Wocheneinkauf");
  });
});

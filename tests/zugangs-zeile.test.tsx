// Muss zuerst stehen: registriert happy-dom. `screen` kommt aus derselben
// Datei — siehe Begründung in tests/dom.ts.
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { EntzugsZustand } from "@/app/verwaltung/zugriff/zustand";

// Die Signatur ist ausgeschrieben, damit `mock.calls[…][1]` als FormData
// typisiert ist und `mockImplementationOnce` auch einen Fehler liefern darf.
const entziehe = mock(
  async (_vorher: EntzugsZustand, _formular: FormData): Promise<EntzugsZustand> => ({
    fehler: null,
  }),
);

mock.module("@/app/verwaltung/zugriff/aktionen", () => ({
  entziehe,
  ladeEin: mock(async () => ({ art: "leer" })),
}));

const { ZugangsZeile } = await import("@/app/verwaltung/zugriff/zugangs-zeile");

afterEach(() => {
  cleanup();
  entziehe.mockClear();
});

function zeichne(eigenschaften: Partial<Parameters<typeof ZugangsZeile>[0]> = {}) {
  return render(
    <ul>
      <ZugangsZeile
        email="neu@example.at"
        seit="12.03.2026"
        hatKonto={false}
        {...eigenschaften}
      />
    </ul>,
  );
}

describe("ZugangsZeile", () => {
  it("zeigt die Adresse und seit wann sie freigeschaltet ist", () => {
    zeichne();
    expect(document.body.textContent).toContain("neu@example.at");
    expect(document.body.textContent).toContain("12.03.2026");
  });

  it("nennt die Adresse im Namen der Schaltfläche, damit sie einzeln ansteuerbar ist", () => {
    zeichne();
    expect(
      screen.getByRole("button", { name: /Zugang entziehen für neu@example\.at/i }),
    ).toBeDefined();
  });

  it("entzieht nicht schon beim ersten Klick", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Zugang entziehen für/i }));
    expect(entziehe).not.toHaveBeenCalled();
  });

  /*
   * Der Kern dieses Bildschirms. Ohne diesen Test könnte ein Umbau den Satz
   * entfernen und „Entziehen" zu einem Klick ohne Ankündigung machen.
   */
  it("sagt vor dem Entziehen, was das Entziehen bewirkt", async () => {
    zeichne({ hatKonto: false });
    await userEvent.click(screen.getByRole("button", { name: /Zugang entziehen für/i }));

    await waitFor(() => {
      expect(document.body.textContent).toContain("nicht mehr herein");
    });
  });

  /*
   * Die Allowlist wird nur beim Anlegen eines Kontos geprüft. Wer schon ein
   * Konto hat, kommt danach ohne erneute Prüfung herein — „kann sich nicht
   * mehr anmelden" wäre für diesen Fall schlicht gelogen.
   */
  it("verspricht bei einem bestehenden Konto keine Aussperrung", async () => {
    zeichne({ hatKonto: true });
    await userEvent.click(screen.getByRole("button", { name: /Zugang entziehen für/i }));

    await waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("das bestehende Konto bleibt bestehen");
      expect(text).not.toContain("nicht mehr herein");
    });
  });

  it("verbindet die Bestätigung mit dem Folgensatz, damit Hilfstechnik ihn mitliest", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Zugang entziehen für/i }));

    const bestaetigen = await screen.findByRole("button", { name: /Ja, Zugang entziehen/i });
    const beschreibung = bestaetigen.getAttribute("aria-describedby");
    expect(beschreibung).toBeTruthy();
    expect(document.getElementById(beschreibung!)?.textContent).toContain("Entziehen");
  });

  it("führt das Entziehen erst nach der Bestätigung aus", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Zugang entziehen für/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Ja, Zugang entziehen/i }));

    await waitFor(() => expect(entziehe).toHaveBeenCalledTimes(1));
  });

  it("gibt die Adresse an die Aktion weiter", async () => {
    zeichne({ email: "wer@example.at" });
    await userEvent.click(screen.getByRole("button", { name: /Zugang entziehen für/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Ja, Zugang entziehen/i }));

    await waitFor(() => expect(entziehe).toHaveBeenCalledTimes(1));
    expect(entziehe.mock.calls[0]?.[1].get("email")).toBe("wer@example.at");
  });

  it("lässt sich abbrechen, ohne etwas zu entziehen", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Zugang entziehen für/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^Behalten$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Ja, Zugang entziehen/i })).toBeNull();
    });
    expect(entziehe).not.toHaveBeenCalled();
  });

  it("meldet einen fehlgeschlagenen Entzug, statt ihn zu verschlucken", async () => {
    entziehe.mockImplementationOnce(async () => ({ fehler: "Der Zugang konnte nicht entzogen werden." }));

    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Zugang entziehen für/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Ja, Zugang entziehen/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("nicht entzogen werden");
    });
  });
});

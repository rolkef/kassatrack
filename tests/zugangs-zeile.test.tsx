// Muss zuerst stehen: registriert happy-dom. `screen` kommt aus derselben
// Datei — siehe Begründung in tests/dom.ts.
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { EntzugsZustand } from "@/app/verwaltung/zugriff/zustand";

/*
 * Die Aktion wird als Eigenschaft übergeben, nicht per `mock.module` ersetzt.
 *
 * `mock.module` gilt in Bun für den **gesamten** Lauf, nicht nur für diese
 * Datei. Ein globaler Ersatz des Aktionsmoduls hat deshalb
 * `tests/verwaltung-aktionen.test.ts` die echten Aktionen weggenommen — dort
 * schlugen sechs Tests fehl, sobald beide Dateien zusammen liefen, und beide
 * für sich waren grün. Hereinreichen löst das an der Wurzel.
 *
 * Die Signatur ist ausgeschrieben, damit `mock.calls[…][1]` als FormData
 * typisiert ist und `mockImplementationOnce` auch einen Fehler liefern darf.
 */
const entziehe = mock(
  async (_vorher: EntzugsZustand, _formular: FormData): Promise<EntzugsZustand> => ({
    fehler: null,
  }),
);

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
        istBetreiber={false}
        istManSelbst={false}
        aktion={entziehe}
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
   *
   * Die Zusage ist für beide Fälle dieselbe, weil die Wirkung dieselbe ist:
   * `entzieheZugang` streicht die Freischaltung und beendet die Sitzungen, und
   * das Sitzungs-Gate prüft die Liste bei jeder Anmeldung. Dass das auch
   * wirklich so ist, hält „Entzug sperrt wirklich aus" in
   * `tests/auth-gate.test.ts` fest — fällt das Gate weg, schlägt dort etwas
   * fehl, und dieser Satz hier wäre wieder eine Lüge.
   */
  it.each([
    ["ohne Konto", false],
    ["mit Konto", true],
  ])("kündigt die Aussperrung an (%s)", async (_name, hatKonto) => {
    zeichne({ hatKonto: hatKonto as boolean });
    await userEvent.click(screen.getByRole("button", { name: /Zugang entziehen für/i }));

    await waitFor(() => {
      expect(document.body.textContent).toContain("nicht mehr anmelden");
    });
  });

  // Kein Relativieren mehr: Die frühere Einschränkung („das bestehende Konto
  // kann sich weiterhin anmelden") gilt nicht mehr und darf nicht zurückkommen.
  it("schränkt die Zusage bei einem bestehenden Konto nicht ein", async () => {
    zeichne({ hatKonto: true });
    await userEvent.click(screen.getByRole("button", { name: /Zugang entziehen für/i }));

    await waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("nicht mehr anmelden");
      expect(text).not.toContain("weiterhin anmelden");
      // Was zusätzlich passiert, darf dabeistehen — es nimmt die Zusage nicht
      // zurück, sondern ergänzt sie.
      expect(text).toContain("laufende Anmeldung wird sofort beendet");
    });
  });

  /*
   * Ohne Fokusführung ist der Bildschirm für Tastatur und Screenreader kaputt:
   * Der Auslöser wird beim Aufklappen ausgehängt, der Fokus fällt auf
   * `document.body`, und der Folgensatz wird nie vorgelesen — `aria-describedby`
   * zählt erst, wenn der Fokus die Schaltfläche erreicht.
   */
  it("setzt den Fokus auf die Bestätigung, wenn die Rückfrage aufgeht", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Zugang entziehen für/i }));

    const bestaetigen = await screen.findByRole("button", { name: /Ja, Zugang entziehen/i });
    await waitFor(() => expect(document.activeElement).toBe(bestaetigen));
  });

  it("gibt den Fokus an den Auslöser zurück, wenn abgebrochen wird", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Zugang entziehen für/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^Behalten$/i }));

    await waitFor(() => {
      const ausloeser = screen.getByRole("button", { name: /Zugang entziehen für/i });
      expect(document.activeElement).toBe(ausloeser);
    });
  });

  it("bricht mit Escape ab", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Zugang entziehen für/i }));
    await screen.findByRole("button", { name: /Ja, Zugang entziehen/i });

    await userEvent.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Ja, Zugang entziehen/i })).toBeNull();
    });
    expect(entziehe).not.toHaveBeenCalled();
  });

  it("verbindet die Bestätigung mit dem Folgensatz, damit Hilfstechnik ihn mitliest", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Zugang entziehen für/i }));

    const bestaetigen = await screen.findByRole("button", { name: /Ja, Zugang entziehen/i });
    const beschreibung = bestaetigen.getAttribute("aria-describedby");
    expect(beschreibung).toBeTruthy();
    expect(document.getElementById(beschreibung!)?.textContent).toContain("nicht mehr anmelden");
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

  /*
   * Die eigene Zeile darf den Knopf nicht anbieten: Ein Selbstentzug beendet
   * die eigenen Sitzungen und streicht die eigene Freischaltung — zurück ginge
   * es nur von Hand in der Datenbank. Serverseitig ist der Fall zusätzlich in
   * `entziehe` abgefangen (siehe tests/verwaltung-aktionen.test.ts).
   */
  it("bietet für die eigene Zeile kein Entziehen an", () => {
    zeichne({ istManSelbst: true });

    expect(screen.queryByRole("button", { name: /Zugang entziehen/i })).toBeNull();
    expect(document.body.textContent).toContain("Das bist du");
  });

  it("kennzeichnet die betreibende Person", () => {
    zeichne({ istBetreiber: true });
    expect(document.body.textContent).toContain("Betreiber");
  });

  it("bietet für eine andere betreibende Person weiterhin ein Entziehen an", () => {
    // Nur der Selbstentzug ist gesperrt, nicht das Entziehen an sich.
    zeichne({ istBetreiber: true, istManSelbst: false });
    expect(screen.getByRole("button", { name: /Zugang entziehen für/i })).toBeDefined();
  });

  it("meldet einen fehlgeschlagenen Entzug, statt ihn zu verschlucken", async () => {
    entziehe.mockImplementationOnce(async () => ({
      fehler: "Der Zugang konnte nicht entzogen werden.",
    }));

    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Zugang entziehen für/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Ja, Zugang entziehen/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("nicht entzogen werden");
    });
  });
});

// Muss zuerst stehen: registriert happy-dom. `screen` kommt aus derselben
// Datei — das eingebaute von @testing-library ist zu diesem Zeitpunkt bereits
// an ein leeres Dokument gebunden, siehe Begründung in tests/dom.ts.
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

/**
 * Better Auth liefert bei jedem Fehler `status` und `statusText` mit — die
 * Attrappen bilden das nach, weil die Komponente genau daran unterscheidet,
 * ob jemand abgewiesen wurde oder ob etwas anderes schiefging.
 */
type Anmeldeergebnis = { error: { message?: string; status?: number } | null };

const signInPasskey = mock(async (): Promise<Anmeldeergebnis> => ({ error: null }));
const signInSocial = mock(async (): Promise<Anmeldeergebnis> => ({ error: null }));

mock.module("@/lib/auth-client", () => ({
  authClient: { signIn: { passkey: signInPasskey, social: signInSocial } },
}));

const { AnmeldeFormular } = await import("@/components/anmelde-formular");
const { ANMELDE_PFAD, ZUGANG_NICHT_FREIGESCHALTET, deuteRueckleitung } = await import(
  "@/lib/anmeldung"
);

afterEach(() => {
  cleanup();
  signInPasskey.mockClear();
  signInSocial.mockClear();
});

/** Hält die Anmeldung offen, bis der Test sie bewusst beendet. */
function angehalten() {
  let freigeben!: (ergebnis: Anmeldeergebnis) => void;
  const versprechen = new Promise<Anmeldeergebnis>((aufloesen) => {
    freigeben = aufloesen;
  });
  return { versprechen, freigeben: () => freigeben({ error: null }) };
}

describe("AnmeldeFormular", () => {
  it("zeigt beide Anmeldewege", () => {
    render(<AnmeldeFormular />);
    expect(screen.getByRole("button", { name: /Mit Passkey anmelden/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Mit Google anmelden/i })).toBeDefined();
  });

  it("startet die Passkey-Anmeldung", async () => {
    render(<AnmeldeFormular />);
    await userEvent.click(screen.getByRole("button", { name: /Mit Passkey anmelden/i }));
    expect(signInPasskey).toHaveBeenCalledTimes(1);
  });

  it("startet die Google-Anmeldung mit dem Provider google", async () => {
    render(<AnmeldeFormular />);
    await userEvent.click(screen.getByRole("button", { name: /Mit Google anmelden/i }));
    expect(signInSocial).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google" }),
    );
  });

  it("gibt Google eine Rückleitung auf die Anmeldeseite mit", async () => {
    // Ohne errorCallbackURL landet eine nicht freigeschaltete Adresse auf der
    // englischen Standard-Fehlerseite von Better Auth statt hier.
    render(<AnmeldeFormular />);
    await userEvent.click(screen.getByRole("button", { name: /Mit Google anmelden/i }));
    expect(signInSocial).toHaveBeenCalledWith(
      expect.objectContaining({ errorCallbackURL: ANMELDE_PFAD }),
    );
  });

  it("zeigt eine verständliche Meldung, wenn der Zugriff verweigert wird", async () => {
    signInSocial.mockImplementationOnce(async () => ({
      error: {
        status: 403,
        message: "Die Adresse fremd@example.at ist für KassaTrack nicht freigeschaltet.",
      },
    }));

    render(<AnmeldeFormular />);
    await userEvent.click(screen.getByRole("button", { name: /Mit Google anmelden/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("nicht freigeschaltet");
    });
  });

  it("nennt bei einer Abweisung den nächsten Schritt", async () => {
    signInPasskey.mockImplementationOnce(async () => ({
      error: { status: 403, message: "Diese Adresse ist nicht freigeschaltet." },
    }));

    render(<AnmeldeFormular />);
    await userEvent.click(screen.getByRole("button", { name: /Mit Passkey anmelden/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("eingeladen");
    });
  });

  it("erklärt einen Verbindungsausfall, ohne den Nutzer zu beschuldigen", async () => {
    signInSocial.mockImplementationOnce(async () => {
      throw new Error("fetch failed");
    });

    render(<AnmeldeFormular />);
    await userEvent.click(screen.getByRole("button", { name: /Mit Google anmelden/i }));

    await waitFor(() => {
      const meldung = screen.getByRole("alert").textContent ?? "";
      expect(meldung).toContain("Keine Verbindung");
      expect(meldung).not.toContain("eingeladen");
    });
  });

  it("reicht englische Entwicklermeldungen nicht an den Nutzer durch", async () => {
    // Passkey-Dialog abgebrochen: Better Auth antwortet englisch, nicht 403.
    signInPasskey.mockImplementationOnce(async () => ({
      error: { status: 400, message: "Auth cancelled" },
    }));

    render(<AnmeldeFormular />);
    await userEvent.click(screen.getByRole("button", { name: /Mit Passkey anmelden/i }));

    await waitFor(() => {
      const meldung = screen.getByRole("alert").textContent ?? "";
      expect(meldung).not.toContain("Auth cancelled");
      expect(meldung).not.toContain("eingeladen");
      expect(meldung).toContain("nicht abgeschlossen");
    });
  });

  it("verwirft eine frühere Meldung beim nächsten Versuch", async () => {
    signInPasskey.mockImplementationOnce(async () => ({
      error: { status: 403, message: "Diese Adresse ist nicht freigeschaltet." },
    }));

    render(<AnmeldeFormular />);
    await userEvent.click(screen.getByRole("button", { name: /Mit Passkey anmelden/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());

    await userEvent.click(screen.getByRole("button", { name: /Mit Google anmelden/i }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("sperrt beide Wege während einer laufenden Anmeldung und meldet den Zustand", async () => {
    const lauf = angehalten();
    signInPasskey.mockImplementationOnce(() => lauf.versprechen);

    render(<AnmeldeFormular />);
    const passkey = screen.getByRole("button", { name: /Mit Passkey anmelden/i });
    const google = screen.getByRole("button", { name: /Mit Google anmelden/i });

    await userEvent.click(passkey);

    await waitFor(() => {
      expect(passkey.getAttribute("aria-busy")).toBe("true");
      expect(passkey.hasAttribute("disabled")).toBe(true);
      expect(google.hasAttribute("disabled")).toBe(true);
      expect(screen.getByRole("status").textContent).toContain("Passkey");
    });

    lauf.freigeben();
    await waitFor(() => expect(passkey.hasAttribute("disabled")).toBe(false));
  });

  it("geht nach erfolgreicher Anmeldung weiter, statt still stehenzubleiben", async () => {
    const nachErfolg = mock(() => {});

    render(<AnmeldeFormular nachErfolg={nachErfolg} />);
    await userEvent.click(screen.getByRole("button", { name: /Mit Passkey anmelden/i }));

    await waitFor(() => expect(nachErfolg).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("beschreibt den Passkey-Weg ohne Fachjargon", () => {
    render(<AnmeldeFormular />);
    const passkey = screen.getByRole("button", { name: /Mit Passkey anmelden/i });
    const beschreibung = passkey.getAttribute("aria-describedby");
    expect(beschreibung).toBeTruthy();
    expect(document.getElementById(beschreibung!)?.textContent).toContain("Fingerabdruck");
  });

  it("kündigt die Einladungspflicht an, bevor jemand es versucht", () => {
    // Der Kern des Bildschirms: Die Abweisung wird erklärt, bevor sie eintritt.
    // Ohne diesen Test könnte ein Umbau den Satz spurlos entfernen.
    render(<AnmeldeFormular />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent).toContain("nur eingeladenen Adressen offen");
  });

  it("zeigt eine mitgegebene Anfangsmeldung sofort an", async () => {
    // So kommt die Abweisung aus dem Google-Callback auf die Seite.
    render(
      <AnmeldeFormular anfangsMeldung={{ text: "Abgewiesen.", abgewiesen: true }} />,
    );

    const alarm = screen.getByRole("alert").textContent ?? "";
    expect(alarm).toContain("Abgewiesen.");
    expect(alarm).toContain("eingeladen");

    // Und verschwindet beim nächsten Versuch wieder.
    await userEvent.click(screen.getByRole("button", { name: /Mit Passkey anmelden/i }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

describe("deuteRueckleitung", () => {
  it("erkennt den Code des Allowlist-Gates als Abweisung", () => {
    const meldung = deuteRueckleitung(ZUGANG_NICHT_FREIGESCHALTET);
    expect(meldung?.abgewiesen).toBe(true);
    expect(meldung?.text).toContain("nicht freigeschaltet");
  });

  it("behandelt fremde OAuth-Fehlercodes nicht als Abweisung", () => {
    // Better Auth und Google schicken eigene Codes. `access_denied` heißt
    // „Zustimmung abgebrochen" — dafür ist der Einladungs-Rat falsch.
    for (const code of ["access_denied", "invalid_code", "unable_to_get_user_info"]) {
      const meldung = deuteRueckleitung(code);
      expect(meldung?.abgewiesen).toBe(false);
      expect(meldung?.text).toContain("nicht abgeschlossen");
    }
  });

  it("liefert ohne Parameter keine Meldung", () => {
    expect(deuteRueckleitung(undefined)).toBeNull();
    expect(deuteRueckleitung("")).toBeNull();
  });
});

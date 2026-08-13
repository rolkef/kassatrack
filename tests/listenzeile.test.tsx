// Muss zuerst stehen: registriert happy-dom. `screen` kommt aus derselben
// Datei — siehe Begründung in tests/dom.ts.
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

/*
 * Die schon an eine Liste gebundene Lösch-Aktion wird hereingereicht, nicht per
 * `mock.module` ersetzt — gleiche Begründung wie im Formulartest daneben.
 */
const loeschen = mock(async (): Promise<void> => {});

const { ListenZeile } = await import("@/app/einkaufszettel/listenzeile");

afterEach(() => {
  cleanup();
  loeschen.mockClear();
});

function zeichne(name = "Wocheneinkauf") {
  return render(
    <ul>
      <ListenZeile id="l1" name={name} loesche={loeschen} />
    </ul>,
  );
}

const AUSLOESER = /^Löschen/;
const BESTAETIGUNG = /Ja, Liste löschen/i;

describe("ListenZeile", () => {
  it("führt in die Liste", () => {
    zeichne();
    const verweis = screen.getByRole("link", { name: /Wocheneinkauf/ });
    expect(verweis.getAttribute("href")).toBe("/einkaufszettel/l1");
  });

  /*
   * Der Kern dieser Zeile. Eine Liste zu löschen nimmt alles mit, was
   * daraufsteht — `shopping_list_item` hängt mit `on delete cascade` daran —
   * und zurückholen lässt sich nichts. Ein einziger Tap darf das nicht
   * auslösen, schon gar nicht neben einem Verweis, den derselbe Daumen trifft.
   */
  it("löscht nicht schon beim ersten Tap", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: AUSLOESER }));
    expect(loeschen).not.toHaveBeenCalled();
  });

  it("sagt vorher, was verloren geht", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: AUSLOESER }));

    await waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Wocheneinkauf");
      expect(text).toContain("allem, was daraufsteht");
    });
  });

  it("löscht erst nach der Bestätigung", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: AUSLOESER }));
    await userEvent.click(await screen.findByRole("button", { name: BESTAETIGUNG }));

    await waitFor(() => expect(loeschen).toHaveBeenCalledTimes(1));
  });

  it("lässt sich abbrechen, ohne zu löschen", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: AUSLOESER }));
    await userEvent.click(await screen.findByRole("button", { name: /^Behalten$/ }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: BESTAETIGUNG })).toBeNull();
    });
    expect(loeschen).not.toHaveBeenCalled();
  });

  it("bricht mit Escape ab", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: AUSLOESER }));
    await screen.findByRole("button", { name: BESTAETIGUNG });

    await userEvent.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: BESTAETIGUNG })).toBeNull();
    });
    expect(loeschen).not.toHaveBeenCalled();
  });

  /*
   * Ohne Fokusführung ist die Rückfrage für Tastatur und Screenreader kaputt:
   * Der Auslöser wird beim Aufklappen ausgehängt, der Fokus fällt auf
   * `document.body`, und der Folgensatz wird nie vorgelesen —
   * `aria-describedby` zählt erst, wenn der Fokus die Schaltfläche erreicht.
   */
  it("setzt den Fokus auf die Bestätigung und verbindet sie mit dem Folgensatz", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: AUSLOESER }));

    const bestaetigen = await screen.findByRole("button", { name: BESTAETIGUNG });
    await waitFor(() => expect(document.activeElement).toBe(bestaetigen));

    const beschreibung = bestaetigen.getAttribute("aria-describedby");
    expect(beschreibung).toBeTruthy();
    expect(document.getElementById(beschreibung!)?.textContent).toContain("Wocheneinkauf");
  });

  it("gibt den Fokus an den Auslöser zurück, wenn abgebrochen wird", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: AUSLOESER }));
    await userEvent.click(await screen.findByRole("button", { name: /^Behalten$/ }));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: AUSLOESER }));
    });
  });

  /*
   * Mehrere Zeilen tragen denselben Auslöser. Ohne den Namen der Liste im
   * zugänglichen Namen hieße jede von ihnen bloß „Löschen" — in einer Liste von
   * Schaltflächen, die man nacheinander vorgelesen bekommt, wäre keine von der
   * anderen zu unterscheiden.
   */
  it("nennt die Liste im Namen des Auslösers", () => {
    zeichne("Fest am Samstag");
    expect(screen.getByRole("button", { name: /Löschen.*Fest am Samstag/ })).toBeDefined();
  });
});

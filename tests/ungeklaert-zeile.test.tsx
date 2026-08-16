// Muss zuerst stehen: registriert happy-dom. `screen` kommt aus derselben
// Datei — siehe Begründung in tests/dom.ts.
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { Produkt } from "@/lib/katalog";
import type { Eintrag, Ergebnis } from "@/app/produkte/abgleich/zustand";

/*
 * Die Aktionen werden hereingereicht, nicht per `mock.module` ersetzt.
 * `mock.module` gilt in Bun für den **ganzen** Lauf und nähme
 * `tests/produkte-abgleich-aktionen.test.ts` die echten Aktionen weg —
 * derselbe Fallstrick, an dem `tests/zugangs-zeile.test.tsx` das Muster
 * gelernt hat.
 */

const EINTRAG: Eintrag = {
  id: "u1",
  rohname: "BUTT.EXTRA 250",
  menge: 250,
  einheit: "G",
  letzterPreis: 2.49,
  kettenName: "Billa",
};

function produkt(werte: Partial<Produkt> & { id: string; name: string }): Produkt {
  return { marke: null, menge: 250, einheit: "G", bildSchluessel: null, ...werte };
}

const sucheKatalog = mock(async (_begriff: string): Promise<Produkt[]> => []);
const ordneZu = mock(async (_id: string, _produktId: string): Promise<Ergebnis> => ({
  erfolg: true,
}));
const legeNeuAn = mock(
  async (_id: string, _eingabe: { name: string; marke: string | null }): Promise<Ergebnis> => ({
    erfolg: true,
  }),
);
const verwerfe = mock(async (_id: string): Promise<void> => {});

const { UngeklaertZeile } = await import("@/app/produkte/abgleich/ungeklaert-zeile");

afterEach(() => {
  cleanup();
  sucheKatalog.mockClear();
  ordneZu.mockClear();
  legeNeuAn.mockClear();
  verwerfe.mockClear();
});

function zeichne(eintrag: Partial<Eintrag> = {}) {
  return render(
    <ul>
      <UngeklaertZeile
        eintrag={{ ...EINTRAG, ...eintrag }}
        sucheKatalog={sucheKatalog}
        ordneZu={ordneZu}
        legeNeuAn={legeNeuAn}
        verwerfe={verwerfe}
      />
    </ul>,
  );
}

/** Klappt die Katalogsuche auf und tippt einen Begriff ein. */
async function suche(begriff: string) {
  await userEvent.click(screen.getByRole("button", { name: /Bestehendem Produkt zuordnen/i }));
  await userEvent.type(await screen.findByRole("searchbox", { name: /Produkt suchen/i }), begriff);
}

describe("UngeklaertZeile", () => {
  it("zeigt Rohname, Kette, Größe und Preis", () => {
    zeichne();

    const text = document.body.textContent ?? "";
    expect(text).toContain("BUTT.EXTRA 250");
    expect(text).toContain("Billa");
    expect(text).toContain("250 g");
    // `formatiereBetrag` — österreichisches Komma, nicht `2.49`.
    expect(text).toContain("2,49");
  });

  it("sucht im Katalog und zeigt Treffer", async () => {
    sucheKatalog.mockImplementationOnce(async () => [
      produkt({ id: "p1", name: "Butter", marke: "Berglandmilch" }),
    ]);

    zeichne();
    await suche("butter");

    await waitFor(() => expect(screen.getByText(/Berglandmilch/)).toBeDefined());
  });

  /*
   * Ohne Verzögerung wäre jeder Tastendruck eine eigene Rundreise zum Server
   * samt Trigramm-Suche. Sechs Zeichen dürfen deshalb **nicht** sechs
   * Suchläufe auslösen.
   */
  it("sucht erst, wenn das Tippen aufhört", async () => {
    sucheKatalog.mockImplementation(async () => [produkt({ id: "p1", name: "Butter" })]);

    zeichne();
    await suche("butter");

    await waitFor(() => expect(sucheKatalog).toHaveBeenCalledTimes(1));
    expect(sucheKatalog).toHaveBeenLastCalledWith("butter");
    sucheKatalog.mockImplementation(async () => []);
  });

  it("sucht gar nicht, solange das Feld leer ist", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Bestehendem Produkt zuordnen/i }));
    await screen.findByRole("searchbox", { name: /Produkt suchen/i });

    await new Promise((fertig) => setTimeout(fertig, 350));
    expect(sucheKatalog).not.toHaveBeenCalled();
  });

  it("ruft ordneZu mit der productId eines Treffers auf", async () => {
    sucheKatalog.mockImplementation(async () => [produkt({ id: "p1", name: "Butter" })]);

    zeichne();
    await suche("butter");
    await userEvent.click(await screen.findByRole("button", { name: /Diesem Produkt zuordnen/i }));

    await waitFor(() => expect(ordneZu).toHaveBeenCalledWith("u1", "p1"));
    sucheKatalog.mockImplementation(async () => []);
  });

  /*
   * Bei mehreren Treffern muss jede Schaltfläche für sich ansprechbar sein —
   * sonst hört Hilfstechnik dreimal denselben Namen und die Wahl zwischen
   * ihnen ist ein Ratespiel.
   */
  it("nennt das Produkt im Namen der Zuordnungs-Schaltfläche", async () => {
    sucheKatalog.mockImplementation(async () => [
      produkt({ id: "p1", name: "Butter" }),
      produkt({ id: "p2", name: "Butterschmalz" }),
    ]);

    zeichne();
    await suche("butter");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Diesem Produkt zuordnen: Butterschmalz/i }),
      ).toBeDefined(),
    );
    sucheKatalog.mockImplementation(async () => []);
  });

  it("sagt an, wie viele Treffer es gibt", async () => {
    sucheKatalog.mockImplementation(async () => []);

    zeichne();
    await suche("gibtsnicht");

    await waitFor(() => expect(document.body.textContent).toContain("Nichts im Katalog"));
    sucheKatalog.mockImplementation(async () => []);
  });

  it("ruft legeNeuAn mit dem vorbefüllten Namen auf", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Als neues Produkt anlegen/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^Anlegen$/i }));

    await waitFor(() =>
      expect(legeNeuAn).toHaveBeenCalledWith("u1", { name: "BUTT.EXTRA 250", marke: null }),
    );
  });

  /*
   * Der eigentliche Grund für das Formular: „BUTT.EXTRA 250" ist der Name des
   * Feeds, nicht der Name, unter dem diese Ware im Katalog stehen soll. Wäre
   * er nicht änderbar, schriebe dieser Bildschirm den Abkürzungsjargon der
   * Kette dauerhaft in den Katalog.
   */
  it("übernimmt einen geänderten Namen und eine eingetragene Marke", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Als neues Produkt anlegen/i }));

    const name = await screen.findByRole("textbox", { name: /^Name$/i });
    await userEvent.clear(name);
    await userEvent.type(name, "Butter Extra");
    await userEvent.type(screen.getByRole("textbox", { name: /Marke/i }), "Berglandmilch");
    await userEvent.click(screen.getByRole("button", { name: /^Anlegen$/i }));

    await waitFor(() =>
      expect(legeNeuAn).toHaveBeenCalledWith("u1", {
        name: "Butter Extra",
        marke: "Berglandmilch",
      }),
    );
  });

  /*
   * Ein Name aus lauter Leerzeichen ist kein Name. `legeProduktAn` schnitte
   * ihn auf "" zurecht, und im Katalog stünde eine Zeile ohne Beschriftung.
   */
  it("legt ohne Namen nichts an", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Als neues Produkt anlegen/i }));

    const feld = await screen.findByRole("textbox", { name: /^Name$/i });
    await userEvent.clear(feld);
    await userEvent.type(feld, " ");

    const anlegen = screen.getByRole("button", { name: /^Anlegen$/i });
    expect((anlegen as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(anlegen);
    expect(legeNeuAn).not.toHaveBeenCalled();
  });

  /*
   * Verwerfen ist absichtlich **einstufig**: Der Sync meldet jeden nicht
   * zuordenbaren Artikel bei jedem Lauf erneut, der Eintrag steht morgen also
   * wieder da. Eine Rückfrage für etwas, das sich von selbst zurückholt, wäre
   * Zeremonie auf einem Bildschirm, dessen ganze Aufgabe zügiges Abarbeiten
   * ist.
   */
  it("verwirft ohne Rückfrage", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /^Verwerfen für BUTT\.EXTRA 250$/i }));

    await waitFor(() => expect(verwerfe).toHaveBeenCalledWith("u1"));
  });

  /*
   * Ohne Fokusführung ist der Bildschirm für Tastatur und Screenreader
   * kaputt: Der Auslöser wird beim Aufklappen ausgehängt, der Fokus fällt auf
   * `document.body`, und das nächste Tab beginnt wieder ganz oben im
   * Dokument. Dieselbe Lehre wie bei `ZugangsZeile`.
   */
  it("setzt den Fokus in das Suchfeld, wenn die Suche aufgeht", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Bestehendem Produkt zuordnen/i }));

    const feld = await screen.findByRole("searchbox", { name: /Produkt suchen/i });
    await waitFor(() => expect(document.activeElement).toBe(feld));
  });

  it("setzt den Fokus in das Namensfeld, wenn das Formular aufgeht", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Als neues Produkt anlegen/i }));

    const feld = await screen.findByRole("textbox", { name: /^Name$/i });
    await waitFor(() => expect(document.activeElement).toBe(feld));
  });

  it("gibt den Fokus an den Auslöser zurück, wenn abgebrochen wird", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Bestehendem Produkt zuordnen/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^Abbrechen$/i }));

    await waitFor(() => {
      const ausloeser = screen.getByRole("button", { name: /Bestehendem Produkt zuordnen/i });
      expect(document.activeElement).toBe(ausloeser);
    });
  });

  it("bricht mit Escape ab", async () => {
    zeichne();
    await userEvent.click(screen.getByRole("button", { name: /Bestehendem Produkt zuordnen/i }));
    await screen.findByRole("searchbox", { name: /Produkt suchen/i });

    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("searchbox", { name: /Produkt suchen/i })).toBeNull(),
    );
    expect(ordneZu).not.toHaveBeenCalled();
  });

  /*
   * Ein Eintrag, den jemand in einem anderen Reiter schon aufgelöst hat, darf
   * nicht stillschweigend nichts tun — sonst klickt man ihn dreimal an und
   * hält den Bildschirm für kaputt.
   */
  it("meldet, wenn der Eintrag nicht mehr offen ist", async () => {
    sucheKatalog.mockImplementation(async () => [produkt({ id: "p1", name: "Butter" })]);
    ordneZu.mockImplementationOnce(async () => ({
      erfolg: false,
      meldung: "Dieser Eintrag ist nicht mehr offen — vielleicht in einem anderen Reiter.",
    }));

    zeichne();
    await suche("butter");
    await userEvent.click(await screen.findByRole("button", { name: /Diesem Produkt zuordnen/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("nicht mehr offen"),
    );
    sucheKatalog.mockImplementation(async () => []);
  });
});

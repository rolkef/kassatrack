// Muss zuerst stehen: registriert happy-dom. `screen` kommt aus derselben
// Datei — siehe Begründung in tests/dom.ts.
import { screen } from "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Navigationsleiste } from "@/components/app-navigation";

/*
 * Geprüft wird `Navigationsleiste` und nicht `AppNavigation`: Der Pfad wird
 * hereingereicht, damit hier keine Attrappe für `next/navigation` nötig ist.
 * Die gälte in Bun für den ganzen Lauf und nähme `tests/sitzung.test.ts` das
 * echte `redirect` weg. Aus demselben Grund kommt auch das Abmelden als
 * Funktion herein, statt `@/lib/auth-client` mit `mock.module` zu ersetzen —
 * das nähme `tests/anmelde-formular.test.tsx` seine eigene, andere Attrappe
 * desselben Moduls weg.
 */
function zeichne(pfad: string, darfVerwalten = false, meldeAb = mock(async () => {})) {
  return render(
    <Navigationsleiste pfad={pfad} darfVerwalten={darfVerwalten} meldeAb={meldeAb} />,
  );
}

/** Der Verweis eines Ziels — `null`, wenn es das Ziel gar nicht gibt. */
function ziel(name: string): HTMLAnchorElement | null {
  const treffer = screen.queryAllByRole("link", { name });
  return (treffer[0] as HTMLAnchorElement | undefined) ?? null;
}

afterEach(cleanup);

describe("Navigationsleiste", () => {
  it("führt in die drei Bereiche, die allen offenstehen", () => {
    zeichne("/");

    expect(ziel("Erfassen")?.getAttribute("href")).toBe("/erfassen");
    expect(ziel("Produkte")?.getAttribute("href")).toBe("/produkte");
    expect(ziel("Zettel")?.getAttribute("href")).toBe("/einkaufszettel");
  });

  /*
   * Der Kern der Zugriffsregel auf dieser Ebene: Das Ziel wird nicht
   * ausgeblendet, sondern gar nicht erst erzeugt. Eine Leiste, die es nur per
   * CSS versteckte, verriete den Weg an jeden, der in die Seitenquelle sieht —
   * und die Prüfung läge dann allein im Browser.
   */
  it("zeigt Zugriff nur der betreibenden Person", () => {
    zeichne("/", false);
    expect(ziel("Zugriff")).toBeNull();
    expect(document.body.innerHTML).not.toContain("/verwaltung/zugriff");

    cleanup();

    zeichne("/", true);
    expect(ziel("Zugriff")?.getAttribute("href")).toBe("/verwaltung/zugriff");
  });

  it("kennzeichnet den aktiven Bereich für Hilfstechnik", () => {
    zeichne("/erfassen");

    expect(ziel("Erfassen")?.getAttribute("aria-current")).toBe("page");
    expect(ziel("Produkte")?.getAttribute("aria-current")).toBeNull();
  });

  /*
   * Ohne diese Zuordnung zeigte die Leiste auf der Produktdetailseite
   * nirgendwohin: Der Pfad ist `/produkte/<id>`, und ein Vergleich auf
   * Gleichheit fände kein aktives Ziel. Man glaubte, aus dem Bereich
   * herausgefallen zu sein.
   */
  it("hält Produkte auch auf der Detailseite aktiv", () => {
    zeichne("/produkte/abc-123");

    expect(ziel("Produkte")?.getAttribute("aria-current")).toBe("page");
  });

  /*
   * Derselbe Präfix-Vergleich wie bei „Produkte", hier aber für den Bereich,
   * in dem man sich am längsten aufhält: Auf `/einkaufszettel/<id>` steht man
   * mitten im Einkauf, und genau dort darf die Leiste nicht ins Leere zeigen.
   */
  it("hält Zettel auch auf der Detailseite einer Liste aktiv", () => {
    zeichne("/einkaufszettel");
    expect(ziel("Zettel")?.getAttribute("aria-current")).toBe("page");

    cleanup();

    zeichne("/einkaufszettel/irgendeine-id");
    expect(ziel("Zettel")?.getAttribute("aria-current")).toBe("page");
    expect(ziel("Produkte")?.getAttribute("aria-current")).toBeNull();
  });

  /*
   * `/produkte-archiv` beginnt zwar mit `/produkte`, ist aber ein anderer
   * Bereich. Ein reines `startsWith` ohne den Schrägstrich färbte ihn mit ein.
   */
  it("verwechselt einen Pfad mit gleichem Anfang nicht mit dem Bereich", () => {
    zeichne("/produkte-archiv");

    expect(ziel("Produkte")?.getAttribute("aria-current")).toBeNull();
  });

  /*
   * Die Zugänglichkeitsvorgabe aus dem Auftrag: Wer Farben nicht unterscheidet,
   * muss den aktiven Bereich trotzdem erkennen. Geprüft wird deshalb, dass es
   * neben der Farbe zwei formale Unterschiede gibt — den Balken an der Kante
   * und die kräftigere Schrift.
   */
  it("erkennt den aktiven Bereich nicht allein an der Farbe", () => {
    zeichne("/erfassen");

    const aktiv = ziel("Erfassen");
    const ruhend = ziel("Produkte");

    expect(aktiv?.className).toContain("font-semibold");
    expect(ruhend?.className).not.toContain("font-semibold");

    // Der Balken ist ein eigenes Element und existiert nur beim aktiven Ziel.
    expect(aktiv?.querySelector("span[aria-hidden='true']")).not.toBeNull();
    expect(ruhend?.querySelector("span[aria-hidden='true']")).toBeNull();
  });

  /*
   * Am Handy ist die Wortmarke der einzige Weg zurück zur Startseite — als
   * installierte PWA gibt es keine Zurück-Schaltfläche des Browsers.
   */
  it("führt über die Wortmarke zur Startseite zurück", () => {
    zeichne("/produkte");

    const heim = screen.getAllByRole("link", { name: "KassaTrack" });
    expect(heim.length).toBeGreaterThan(0);
    expect(heim[0].getAttribute("href")).toBe("/");
    expect(heim[0].getAttribute("aria-current")).toBeNull();
  });

  it("markiert die Wortmarke auf der Startseite als aktuelle Seite", () => {
    zeichne("/");

    expect(screen.getAllByRole("link", { name: "KassaTrack" })[0].getAttribute("aria-current")).toBe(
      "page",
    );
  });

  /*
   * Es gibt sie zweimal im Dokument, genau wie die Wortmarke — je eine Fassung
   * für die mobile Kopfzeile und eine für die Schreibtisch-Leiste, per CSS
   * ein- und ausgeblendet, nicht per Bedingung erzeugt.
   */
  it("bietet eine Abmelden-Schaltfläche an", () => {
    zeichne("/");

    const knoepfe = screen.getAllByRole("button", { name: /Abmelden/i });
    expect(knoepfe.length).toBeGreaterThan(0);
  });

  it("ruft beim Abmelden die übergebene Funktion auf, statt selbst `@/lib/auth-client` zu kennen", async () => {
    const meldeAb = mock(async () => {});
    zeichne("/", false, meldeAb);

    await userEvent.click(screen.getAllByRole("button", { name: /Abmelden/i })[0]);

    expect(meldeAb).toHaveBeenCalledTimes(1);
  });
});

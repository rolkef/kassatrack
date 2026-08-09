import { describe, expect, it } from "bun:test";
import { istUnveraenderlicheDatei } from "@/app/sw-regeln";

const HERKUNFT = "https://kassatrack.example.at";

function pfad(p: string): URL {
  return new URL(p, HERKUNFT);
}

/*
 * Diese Regel ist keine Geschwindigkeitsfrage, sondern eine Sicherheitsfrage.
 *
 * Der Cache-Speicher eines Service Workers gehört der Herkunft, nicht der
 * Sitzung. Was dort einmal liegt, überlebt das Abmelden und den Entzug des
 * Zugangs. Eine zwischengespeicherte Verwaltungsseite würde die gesamte
 * Freischaltliste an die nächste Person am Gerät ausliefern — ohne Anmeldung
 * und ohne dass der Server davon erfährt.
 *
 * Deshalb darf ausschließlich zwischengespeichert werden, was ohnehin
 * öffentlich und unveränderlich ist. Alles andere geht ungefiltert ins Netz.
 */
describe("Was der Service Worker zwischenspeichern darf", () => {
  it("nimmt gehashte Bau-Dateien auf", () => {
    expect(istUnveraenderlicheDatei(pfad("/_next/static/chunks/main-a1b2c3.js"), true)).toBe(true);
    expect(istUnveraenderlicheDatei(pfad("/_next/static/css/abc123.css"), true)).toBe(true);
    expect(istUnveraenderlicheDatei(pfad("/_next/static/media/schrift-xyz.woff2"), true)).toBe(
      true,
    );
  });

  it("nimmt die Icons der App auf", () => {
    expect(istUnveraenderlicheDatei(pfad("/icon-192.png"), true)).toBe(true);
    expect(istUnveraenderlicheDatei(pfad("/icon-512.png"), true)).toBe(true);
  });

  it("lässt angemeldete Seiten unberührt", () => {
    expect(istUnveraenderlicheDatei(pfad("/verwaltung/zugriff"), true)).toBe(false);
    expect(istUnveraenderlicheDatei(pfad("/"), true)).toBe(false);
    expect(istUnveraenderlicheDatei(pfad("/anmelden"), true)).toBe(false);
    expect(istUnveraenderlicheDatei(pfad("/einladung/geheimes-token"), true)).toBe(false);
  });

  it("lässt die Schnittstellen unberührt", () => {
    expect(istUnveraenderlicheDatei(pfad("/api/auth/session"), true)).toBe(false);
    expect(istUnveraenderlicheDatei(pfad("/api/health"), true)).toBe(false);
  });

  /*
   * Eine Seite kann auf ".png" enden, ohne ein Bild zu sein — und ein fremder
   * Server kann alles ausliefern, was er will. Die Endung allein entscheidet
   * deshalb nichts; der Pfad muss zusätzlich in einem der bekannten
   * Verzeichnisse liegen und die Anfrage muss von dieser Herkunft stammen.
   */
  it("traut keiner fremden Herkunft", () => {
    expect(istUnveraenderlicheDatei(new URL("https://beispiel.at/icon-192.png"), false)).toBe(
      false,
    );
    expect(
      istUnveraenderlicheDatei(new URL("https://beispiel.at/_next/static/x.js"), false),
    ).toBe(false);
  });

  it("fällt nicht auf eine Endung im Pfad herein", () => {
    expect(istUnveraenderlicheDatei(pfad("/verwaltung/zugriff/bericht.png"), true)).toBe(false);
    expect(istUnveraenderlicheDatei(pfad("/einladung/token.js"), true)).toBe(false);
  });
});

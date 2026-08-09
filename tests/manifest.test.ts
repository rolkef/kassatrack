import { describe, expect, it } from "bun:test";
import manifest from "@/app/manifest";
import { PAPIER } from "@/lib/huelle";

/**
 * Liest Breite und Höhe aus dem IHDR-Block einer PNG-Datei.
 *
 * Nach der 8 Byte langen Signatur folgt die Länge (4 Byte), die Kennung
 * "IHDR" (4 Byte) und danach Breite und Höhe als 32-Bit-Zahlen. Das ist der
 * einzige Weg, ohne Bildbibliothek zu prüfen, ob eine Datei wirklich die
 * Größe hat, die das Manifest von ihr behauptet.
 */
async function pngGroesse(pfad: string): Promise<string> {
  const daten = new DataView(await Bun.file(pfad).arrayBuffer());
  return `${daten.getUint32(16)}x${daten.getUint32(20)}`;
}

describe("PWA-Manifest", () => {
  it("heißt KassaTrack", () => {
    expect(manifest().name).toBe("KassaTrack");
  });

  it("startet eigenständig ohne Browserleiste", () => {
    expect(manifest().display).toBe("standalone");
  });

  it("startet auf der Wurzel", () => {
    expect(manifest().start_url).toBe("/");
  });

  it("liefert Icons in 192 und 512 Pixel", () => {
    const groessen = (manifest().icons ?? []).map((i) => i.sizes);
    expect(groessen).toContain("192x192");
    expect(groessen).toContain("512x512");
  });

  it("spricht österreichisches Deutsch", () => {
    expect(manifest().lang).toBe("de-AT");
    expect(manifest().dir).toBe("ltr");
  });

  /*
   * Splash-Screen und Statusleiste sind die ersten beiden Flächen, die man von
   * der App sieht. Sie tragen dieselbe Papierfarbe wie jede Seite, damit der
   * Start nicht durch einen Farbwechsel unterbrochen wird.
   */
  it("trägt in Splash und Statusleiste die Papierfarbe der App", () => {
    expect(manifest().background_color).toBe(PAPIER);
    expect(manifest().theme_color).toBe(PAPIER);
  });

  /*
   * Android beschneidet maskierbare Icons auf einen Kreis. Wer dafür dieselbe
   * Datei angibt wie für "any", verliert die Ränder des Motivs. Der
   * maskierbare Eintrag muss deshalb eine eigene Datei sein.
   */
  it("hält für den Kreisbeschnitt eine eigene Datei bereit", () => {
    const icons = manifest().icons ?? [];
    const maskierbar = icons.filter((i) => i.purpose === "maskable");
    const normal = icons.filter((i) => i.purpose !== "maskable");

    expect(maskierbar.length).toBeGreaterThan(0);
    for (const eintrag of maskierbar) {
      expect(normal.map((i) => i.src)).not.toContain(eintrag.src);
    }
  });

  it("liefert jede angekündigte Datei in genau der angekündigten Größe", async () => {
    const icons = manifest().icons ?? [];
    expect(icons.length).toBeGreaterThan(0);

    for (const eintrag of icons) {
      const pfad = `public${eintrag.src}`;
      // Ein Icon ohne Größenangabe wäre schon selbst der Fehler.
      expect(eintrag.sizes).toBeString();
      expect(await Bun.file(pfad).exists()).toBe(true);
      expect(await pngGroesse(pfad)).toBe(eintrag.sizes!);
    }
  });
});

import { describe, expect, it, mock } from "bun:test";
import { feedMengeZuBasiseinheit, gruppiereNachKette, holeFeed, istKetteAktuell } from "@/lib/ketten-feed";

describe("feedMengeZuBasiseinheit", () => {
  it("wandelt Gramm unverändert um", () => {
    expect(feedMengeZuBasiseinheit(250, "g")).toEqual({ wert: 250, einheit: "G" });
  });

  it("wandelt Kilogramm in Gramm um", () => {
    expect(feedMengeZuBasiseinheit(1.5, "kg")).toEqual({ wert: 1500, einheit: "G" });
  });

  it("wandelt Liter in Milliliter um", () => {
    expect(feedMengeZuBasiseinheit(1, "l")).toEqual({ wert: 1000, einheit: "ML" });
  });

  it("wandelt Milliliter unverändert um", () => {
    expect(feedMengeZuBasiseinheit(330, "ml")).toEqual({ wert: 330, einheit: "ML" });
  });

  it("erkennt beide Stück-Schreibweisen", () => {
    expect(feedMengeZuBasiseinheit(6, "stk")).toEqual({ wert: 6, einheit: "STK" });
    expect(feedMengeZuBasiseinheit(6, "stück")).toEqual({ wert: 6, einheit: "STK" });
  });

  it("ist unempfindlich gegen Groß-/Kleinschreibung", () => {
    expect(feedMengeZuBasiseinheit(250, "G")).toEqual({ wert: 250, einheit: "G" });
  });

  it("liefert null für eine fachfremde Einheit", () => {
    expect(feedMengeZuBasiseinheit(5, "cm")).toBeNull();
    expect(feedMengeZuBasiseinheit(1, "Verpackungseinheit")).toBeNull();
    expect(feedMengeZuBasiseinheit(1, "")).toBeNull();
  });

  it("liefert null für eine Menge von null oder darunter", () => {
    expect(feedMengeZuBasiseinheit(0, "g")).toBeNull();
    expect(feedMengeZuBasiseinheit(-5, "g")).toBeNull();
  });
});

describe("gruppiereNachKette", () => {
  it("gruppiert Einträge nach store", () => {
    const gruppen = gruppiereNachKette([
      { store: "billa", id: "1", name: "A", price: 1, quantity: 1, unit: "stk", priceHistory: [] },
      { store: "spar", id: "2", name: "B", price: 1, quantity: 1, unit: "stk", priceHistory: [] },
      { store: "billa", id: "3", name: "C", price: 1, quantity: 1, unit: "stk", priceHistory: [] },
    ]);

    expect(gruppen.get("billa")).toHaveLength(2);
    expect(gruppen.get("spar")).toHaveLength(1);
    expect(gruppen.get("hofer")).toBeUndefined();
  });
});

describe("istKetteAktuell", () => {
  const jetzt = new Date("2026-08-13T12:00:00.000Z");

  function eintragMitDatum(datum: string) {
    return {
      store: "billa",
      id: "x",
      name: "X",
      price: 1,
      quantity: 1,
      unit: "stk",
      priceHistory: [{ date: datum, price: 1 }],
    };
  }

  /*
   * Live-Fund vom 2026-08-16: Billa und Spar hatten an dem Tag nur 6,6 % bzw.
   * 0,8 % Einträge mit einem `priceHistory[0].date` der letzten drei Tage,
   * obwohl beide Ketten nachweislich taggenau aktuell waren (das jüngste
   * Datum über die ganze Kette war „heute"). Der Feed ist ein Änderungs-
   * protokoll — die meisten Preise ändern sich an einem gegebenen Tag
   * schlicht nicht, auch bei einer gesund laufenden Kette. Ein Anteils-Schwellwert
   * („die Hälfte muss frisch sein") ist deshalb strukturell zu streng und hätte
   * beide Ketten fälschlich als tot gemeldet. Maßgeblich ist stattdessen, ob
   * *irgendein* Eintrag der Kette kürzlich eine Preisänderung verzeichnet hat.
   */
  it("gilt als aktuell, wenn mindestens ein Eintrag frisch ist — auch wenn die meisten es nicht sind", () => {
    const eintraege = [
      eintragMitDatum("2026-08-12"),
      eintragMitDatum("2020-01-01"),
      eintragMitDatum("2020-01-01"),
      eintragMitDatum("2020-01-01"),
    ];
    expect(istKetteAktuell(eintraege, jetzt)).toBe(true);
  });

  /*
   * Gegenprobe mit echten Zahlen: Hofer hatte an demselben Tag über die ganze
   * Kette kein einziges Datum jünger als 2025-11-07 — über neun Monate alt,
   * ein echter Ausfall (vermutlich hat heisse-preise.io Hofer nicht mehr
   * abgefragt). Kein Eintrag irgendeiner Größe an Frische darf das durchlassen.
   */
  it("gilt nicht als aktuell, wenn kein einziger Eintrag frisch ist", () => {
    const eintraege = [
      eintragMitDatum("2020-01-01"),
      eintragMitDatum("2020-01-01"),
      eintragMitDatum("2020-01-01"),
    ];
    expect(istKetteAktuell(eintraege, jetzt)).toBe(false);
  });

  it("gilt nicht als aktuell ohne jeden Eintrag", () => {
    expect(istKetteAktuell([], jetzt)).toBe(false);
  });

  /*
   * Ohne diese Gegenprobe wäre `AKTUALITAETS_TAGE` nur nach unten (durch den
   * `2020-01-01`-Fall oben) begrenzt, nicht nach oben — eine Änderung des
   * Werts auf z. B. 30 hätte alle bisherigen Tests weiter bestehen lassen.
   */
  it("zieht die Drei-Tage-Grenze exakt an ihrem Rand", () => {
    expect(istKetteAktuell([eintragMitDatum("2026-08-11")], jetzt)).toBe(true);
    expect(istKetteAktuell([eintragMitDatum("2026-08-09")], jetzt)).toBe(false);
  });
});

describe("holeFeed", () => {
  it("liefert das geparste Array bei einer erfolgreichen Antwort", async () => {
    const daten = [{ store: "billa", id: "1", name: "A", price: 1, quantity: 1, unit: "stk", priceHistory: [] }];
    const abrufen = mock(async () => new Response(JSON.stringify(daten), { status: 200})) as unknown as typeof fetch;

    expect(await holeFeed(abrufen)).toEqual(daten);
  });

  it("wirft bei einer fehlgeschlagenen Antwort", async () => {
    const abrufen = mock(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(holeFeed(abrufen)).rejects.toThrow();
  });

  it("wirft, wenn die Antwort kein Array ist", async () => {
    const abrufen = mock(
      async () => new Response(JSON.stringify({ nicht: "ein array" }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(holeFeed(abrufen)).rejects.toThrow();
  });
});

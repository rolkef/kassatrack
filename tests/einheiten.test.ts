import { describe, expect, it } from "bun:test";
import { formatiereGrundpreis, grundpreis, zerlegeMenge } from "@/lib/einheiten";

describe("zerlegeMenge", () => {
  it("versteht Gramm", () => {
    expect(zerlegeMenge("250 g")).toEqual({ wert: 250, einheit: "G" });
  });

  it("rechnet Kilogramm in Gramm um", () => {
    expect(zerlegeMenge("1 kg")).toEqual({ wert: 1000, einheit: "G" });
  });

  it("versteht das deutsche Dezimalkomma", () => {
    expect(zerlegeMenge("1,5 l")).toEqual({ wert: 1500, einheit: "ML" });
  });

  it("versteht auch den Punkt als Dezimaltrenner", () => {
    expect(zerlegeMenge("1.5 l")).toEqual({ wert: 1500, einheit: "ML" });
  });

  it("kommt ohne Leerzeichen aus", () => {
    expect(zerlegeMenge("0,5L")).toEqual({ wert: 500, einheit: "ML" });
  });

  it("versteht Stück", () => {
    expect(zerlegeMenge("6 Stk")).toEqual({ wert: 6, einheit: "STK" });
  });

  it("liefert null bei Unsinn", () => {
    expect(zerlegeMenge("ein bisschen")).toBeNull();
    expect(zerlegeMenge("")).toBeNull();
    expect(zerlegeMenge("250")).toBeNull();
  });

  it("liefert null bei null oder negativer Menge", () => {
    expect(zerlegeMenge("0 g")).toBeNull();
    expect(zerlegeMenge("-5 g")).toBeNull();
  });

  it("lehnt mehrdeutige Dezimaltrennzeichen ab (Punkt mit genau 3 Ziffern)", () => {
    expect(zerlegeMenge("1.234 g")).toBeNull();
    expect(zerlegeMenge("10.000 g")).toBeNull();
    expect(zerlegeMenge("2.500 g")).toBeNull();
  });

  it("akzeptiert Punkt mit ein oder zwei Ziffern als Dezimaltrennzeichen", () => {
    expect(zerlegeMenge("1.5 l")).toEqual({ wert: 1500, einheit: "ML" });
    expect(zerlegeMenge("1.25 l")).toEqual({ wert: 1250, einheit: "ML" });
  });

  it("versteht Komma als Dezimaltrennzeichen auch bei mehrstelliger Vorkommazahl", () => {
    expect(zerlegeMenge("1,234 g")).toEqual({ wert: 1, einheit: "G" });
  });

  it("versteht Stück mit vollständiger Schreibweise", () => {
    expect(zerlegeMenge("6 Stück")).toEqual({ wert: 6, einheit: "STK" });
  });

  it("versteht alle Unit-Aliase aus der Tabelle", () => {
    expect(zerlegeMenge("250 gr")).toEqual({ wert: 250, einheit: "G" });
    expect(zerlegeMenge("1 cl")).toEqual({ wert: 10, einheit: "ML" });
    expect(zerlegeMenge("5 st")).toEqual({ wert: 5, einheit: "STK" });
    expect(zerlegeMenge("3 stueck")).toEqual({ wert: 3, einheit: "STK" });
  });
});

describe("grundpreis", () => {
  it("rechnet auf ein Kilogramm hoch", () => {
    expect(grundpreis(2.49, { wert: 250, einheit: "G" })).toBeCloseTo(9.96, 4);
  });

  it("rechnet auf einen Liter hoch", () => {
    expect(grundpreis(1.29, { wert: 1500, einheit: "ML" })).toBeCloseTo(0.86, 4);
  });

  it("rechnet bei Stück auf ein Stück", () => {
    expect(grundpreis(3.0, { wert: 6, einheit: "STK" })).toBeCloseTo(0.5, 4);
  });

  it("lehnt negativen Preis ab", () => {
    expect(grundpreis(-2.49, { wert: 250, einheit: "G" })).toBeNull();
  });

  it("lehnt null-Preis ab", () => {
    expect(grundpreis(0, { wert: 250, einheit: "G" })).toBeNull();
  });

  it("lehnt Menge mit wert 0 ab", () => {
    expect(grundpreis(2.49, { wert: 0, einheit: "G" })).toBeNull();
  });
});

describe("formatiereGrundpreis", () => {
  it("schreibt Euro je Kilogramm", () => {
    expect(formatiereGrundpreis(9.96, "G")).toBe("9,96 €/kg");
  });

  it("schreibt Euro je Liter", () => {
    expect(formatiereGrundpreis(0.86, "ML")).toBe("0,86 €/l");
  });

  it("schreibt Euro je Stück", () => {
    expect(formatiereGrundpreis(0.5, "STK")).toBe("0,50 €/Stk");
  });
});

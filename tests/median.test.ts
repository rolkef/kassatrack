import { describe, expect, it } from "bun:test";
import { median } from "@/lib/median";

describe("median", () => {
  it("liefert null bei leerer Liste", () => {
    expect(median([])).toBeNull();
  });

  it("liefert den Wert selbst bei einem Element", () => {
    expect(median([2.49])).toBe(2.49);
  });

  it("nimmt bei ungerader Anzahl den mittleren Wert", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("mittelt bei gerader Anzahl die beiden mittleren", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("ist unempfindlich gegen einen Ausreißer", () => {
    // Genau dafür ist der Median da: ein Tippfehler bei der Erfassung
    // (299 statt 2,99) darf die Aussage nicht verschieben.
    expect(median([2.49, 2.59, 2.45, 299])).toBeCloseTo(2.54, 4);
  });

  it("verändert die übergebene Liste nicht", () => {
    const eingabe = [3, 1, 2];
    median(eingabe);
    expect(eingabe).toEqual([3, 1, 2]);
  });
});

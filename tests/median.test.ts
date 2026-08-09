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

  it("filtert NaN aus kurzen Listen heraus", () => {
    // NaN ist kein Wert, der in eine Ordnung gehört. Es wird gefiltert
    // wie ein Tippfehler — die Beobachtungen, die zählen, bleiben zählbar.
    expect(median([2.49, 2.59, NaN, 2.45])).toBe(2.49);
  });

  it("filtert NaN aus neun oder mehr Werten heraus", () => {
    // Kritischer Fall: Bei V8 sortiert 9+ Werte mit einem anderen Algorithmus.
    // NaN bleibt unkontrolliert erhalten, und die Funktion gibt eine
    // unauffällig falsche normale Zahl zurück statt NaN zu zeigen.
    // Das ist genau die Situation, vor der diese Funktion schützen soll.
    const werte = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, NaN];
    expect(median(werte)).toBe(3.0);
  });

  it("filtert Infinity heraus", () => {
    expect(median([1, 2, 3, Infinity])).toBe(2);
  });

  it("filtert -Infinity heraus", () => {
    expect(median([1, 2, 3, -Infinity])).toBe(2);
  });

  it("liefert null bei nur nicht-endlichen Werten", () => {
    expect(median([NaN, Infinity, -Infinity])).toBeNull();
  });
});

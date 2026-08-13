import type { Produkt } from "@/lib/katalog";

/*
 * Was Aktion und Oberfläche des Listendetails teilen.
 *
 * Bewusst **neben** `aktionen.ts` und nicht darin: Eine Datei unter
 * `"use server"` behandelt jeden Export als Server-Aktion, eine Konstante
 * hätte darin nichts verloren. Dieselbe Trennung wie in
 * `src/app/einkaufszettel/zustand.ts` und `src/app/erfassen/zustand.ts`.
 */

/**
 * Wie oft eine Ware höchstens auf einem Zettel stehen kann.
 *
 * Die Zahl steht hier und nicht nur im Zähler der Oberfläche, weil beide
 * Enden sie brauchen: Der Zähler hört bei ihr auf zu zählen, und die Aktion
 * weist alles darüber ab — Server-Aktionen sind eigene Endpunkte und über
 * ihre Kennung auch ohne die Oberfläche aufrufbar. Ohne die Prüfung dort
 * käme eine Zahl jenseits von `integer` bis in die Datenbank durch und
 * bräche mit `integer out of range`, also als technischer Fehler statt als
 * Satz.
 *
 * 99 und nicht mehr: Ein Einkaufszettel ist keine Bestellliste. Wer hundert
 * Stück einer Ware braucht, hat sich vertippt.
 */
export const STUECKZAHL_OBERGRENZE = 99;

/**
 * Die Formen der vier Aktionen, so wie `ZettelDetail` sie erwartet.
 *
 * Die Komponente bekommt sie als Eigenschaften hereingereicht, statt sie zu
 * importieren — der Test kann dann Attrappen übergeben, ohne das
 * Aktionsmodul über `mock.module` global zu ersetzen. Ein globaler Ersatz
 * gälte in Bun für den **ganzen** Lauf und nähme
 * `tests/einkaufszettel-detail-aktionen.test.ts` die echten Aktionen weg.
 */
export type HinzufuegenAktion = (eingabe: {
  listId: string;
  produktId?: string;
  freitext?: string;
  stueckzahl?: number;
}) => Promise<void>;

export type StueckzahlAktion = (
  itemId: string,
  stueckzahl: number,
  listId: string,
) => Promise<void>;

export type EntfernenAktion = (itemId: string, listId: string) => Promise<void>;

export type SuchAktion = (begriff: string) => Promise<Produkt[]>;

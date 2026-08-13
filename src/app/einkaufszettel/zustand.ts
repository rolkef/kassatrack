/*
 * Was die Zettel-Übersicht an Typen teilt.
 *
 * Bewusst **neben** `aktionen.ts` und nicht darin: Eine Datei unter
 * `"use server"` behandelt jeden Export als Server-Aktion. Dieselbe Trennung
 * gibt es aus demselben Grund schon in `src/app/erfassen/zustand.ts` und
 * `src/app/verwaltung/zugriff/zustand.ts`.
 */

export type ListenErgebnis =
  | { art: "erfolg"; id: string }
  | { art: "fehler"; meldung: string };

/**
 * Die Formen der beiden Aktionen, so wie die Client-Komponenten sie erwarten.
 * Beide bekommen die Aktion als Eigenschaft hereingereicht statt sie zu
 * importieren — der Test kann dann eine Attrappe übergeben, ohne das
 * Aktionsmodul über `mock.module` global zu ersetzen. Ein globaler Ersatz gälte
 * in Bun für den **ganzen** Lauf und nähme `tests/einkaufszettel-aktionen.test.ts`
 * die echten Aktionen weg.
 */
export type ListenAktion = (
  vorher: ListenErgebnis | undefined,
  formular: FormData,
) => Promise<ListenErgebnis>;

/** Schon an eine Liste gebunden — siehe `loescheListeAktion.bind` in `page.tsx`. */
export type LoeschAktion = () => Promise<void>;

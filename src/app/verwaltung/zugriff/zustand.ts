/*
 * Was die Verwaltungsseite an Typen, Konstanten und Formatierung teilt.
 *
 * Bewusst **neben** `aktionen.ts` und nicht darin: Eine Datei mit `"use server"`
 * darf ausschließlich asynchrone Funktionen exportieren. Ein `export const` oder
 * eine gewöhnliche Funktion dort lässt den Bau scheitern („Only async functions
 * are allowed to be exported in a 'use server' file"). Diese Datei enthält
 * deshalb alles, was keine Aktion ist, und wird von Server- wie Client-Teil
 * importiert.
 */

export type EinladungsZustand =
  | { art: "leer" }
  | { art: "fertig"; email: string; link: string; gueltigBis: string }
  | { art: "fehler"; text: string };

export const LEERER_ZUSTAND: EinladungsZustand = { art: "leer" };

export type EntzugsZustand = { fehler: string | null };

export const KEIN_ENTZUGSFEHLER: EntzugsZustand = { fehler: null };

/*
 * Die Formen der beiden Server-Aktionen, so wie `useActionState` sie erwartet.
 * Die Client-Komponenten bekommen die Aktion als Eigenschaft hereingereicht
 * statt sie zu importieren — siehe Begründung an `ZugangsZeile`.
 */
export type EinladungsAktion = (
  vorher: EinladungsZustand,
  formular: FormData,
) => Promise<EinladungsZustand>;

export type EntzugsAktion = (
  vorher: EntzugsZustand,
  formular: FormData,
) => Promise<EntzugsZustand>;

/**
 * Fest auf Wien gestellt, nicht auf die Zeitzone des Servers.
 *
 * Zwei Gründe. Erstens wird die App in Österreich benutzt; ein Server, der in
 * UTC läuft, zeigte sonst Uhrzeiten, die um ein bis zwei Stunden danebenliegen.
 * Zweitens werden diese Zeichenketten auf dem Server erzeugt und an
 * Client-Komponenten weitergereicht — eine Formatierung im Browser würde je
 * nach Geräteeinstellung etwas anderes ergeben als der Server und die
 * Hydration zerreißen.
 */
export function formatiereDatum(wert: Date): string {
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Vienna",
  }).format(wert);
}

/**
 * Kurzform für das Protokoll: Tag, Monat, Uhrzeit — das Jahr ergibt sich aus
 * der Aufbewahrungsfrist und wäre nur Breite.
 *
 * Datum und Uhrzeit werden getrennt formatiert und mit einem Leerzeichen
 * verbunden. Ein einzelnes Format ergäbe „02.08., 14:36" — das Komma ist in
 * einer Spalte, die ohnehin schon durch Abstand getrennt ist, nur Rauschen.
 */
export function formatiereZeitpunkt(wert: Date): string {
  const datum = new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Vienna",
  }).format(wert);
  const uhrzeit = new Intl.DateTimeFormat("de-AT", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/Vienna",
  }).format(wert);

  return `${datum} ${uhrzeit}`;
}

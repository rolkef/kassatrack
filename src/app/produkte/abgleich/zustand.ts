import type { Basiseinheit } from "@/lib/einheiten";
import type { Produkt } from "@/lib/katalog";

/*
 * Was Seite, Aktionen und Zeile der Prüfliste teilen.
 *
 * Bewusst **neben** `aktionen.ts` und nicht darin: Eine Datei mit
 * `"use server"` darf ausschließlich asynchrone Funktionen exportieren, ein
 * `export const` oder ein Typ dort ließe den Bau scheitern („Only async
 * functions are allowed to be exported in a 'use server' file"). Dieselbe
 * Trennung wie in `src/app/verwaltung/zugriff/zustand.ts` und
 * `src/app/einkaufszettel/[id]/zustand.ts`.
 */

/**
 * Eine Zeile der Prüfliste, so wie die Oberfläche sie braucht.
 *
 * Gegenüber `UngeklaertZeile` aus `@/lib/ketten-abgleich` ist die Kennung der
 * Kette bereits gegen ihren Namen aufgelöst — „Billa" statt einer UUID. Das
 * geschieht auf der Seite und nicht hier in der Zeile, damit die Namen der
 * Ketten **einmal** je Aufruf geholt werden und nicht einmal je Eintrag.
 */
export type Eintrag = {
  id: string;
  rohname: string;
  menge: number;
  einheit: Basiseinheit;
  letzterPreis: number;
  kettenName: string;
};

/**
 * Was eine Zuordnung meldet.
 *
 * Ein Misserfolg ist hier kein technischer Fehler, sondern der Normalfall
 * eines veralteten Bildschirms: Zwei Reiter offen, in einem ist der Eintrag
 * schon aufgelöst. Deshalb ein Ergebnis mit Satz statt eines geworfenen
 * Fehlers — der landete auf der Fehlerseite und nähme die ganze Liste mit.
 */
export type Ergebnis = { erfolg: true } | { erfolg: false; meldung: string };

/*
 * Die Formen der Aktionen, so wie `UngeklaertZeile` sie erwartet. Die
 * Komponente bekommt sie als Eigenschaften hereingereicht, statt sie zu
 * importieren: Der Test kann dann Attrappen übergeben, ohne das Aktionsmodul
 * über `mock.module` global zu ersetzen. Ein globaler Ersatz gälte in Bun für
 * den **ganzen** Lauf und nähme `tests/produkte-abgleich-aktionen.test.ts` die
 * echten Aktionen weg — genau der Fallstrick, an dem diese App das Muster
 * gelernt hat (siehe `ZugangsZeile`).
 */
export type SuchAktion = (begriff: string) => Promise<Produkt[]>;

export type ZuordnenAktion = (ungeklaertId: string, productId: string) => Promise<Ergebnis>;

export type NeuAnlegenAktion = (
  ungeklaertId: string,
  eingabe: { name: string; marke: string | null },
) => Promise<Ergebnis>;

export type VerwerfenAktion = (ungeklaertId: string) => Promise<void>;

/**
 * Wie lange nach dem letzten Tastendruck gewartet wird, bevor gesucht wird.
 *
 * Derselbe Wert wie im Einkaufszettel-Detail: Jeder Tastendruck ohne diese
 * Pause wäre ein eigener Aufruf der Server-Aktion, also eine Rundreise zum
 * Server samt Trigramm-Suche für einen Begriff, der im nächsten Moment schon
 * wieder ein anderer ist.
 */
export const SUCH_VERZOEGERUNG = 200;

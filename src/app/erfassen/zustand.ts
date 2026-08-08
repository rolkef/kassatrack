import type { Preisart } from "@/db/schema/preise";

/**
 * Was die Erfassung zurückgibt — und warum sie es zurückgibt.
 *
 * Der Grundpreis steht bewusst im Ergebnis, obwohl das Formular ihn beim
 * Tippen selbst ausrechnet. Erst der zurückgegebene Wert ist der, der auch
 * wirklich in der Datenbank steht; der berechnete ist nur eine Vorschau.
 * Beides zu trennen kostet nichts und verhindert, dass die Bestätigung eine
 * Zahl behauptet, die so nie geschrieben wurde.
 *
 * Die Typen stehen in einer eigenen Datei, weil `aktionen.ts` unter
 * `"use server"` steht: Alles, was von dort in eine Client-Komponente wandert,
 * würde sonst als Server-Aktion behandelt.
 */
export type Ergebnis =
  | { art: "erfolg"; produktId: string; grundpreis: string }
  | { art: "fehler"; meldung: string };

export type ErfassungsAktion = (
  vorher: Ergebnis | undefined,
  formular: FormData,
) => Promise<Ergebnis>;

/**
 * Die vier Preisarten in der Reihenfolge, in der sie vorkommen.
 *
 * „Normal" steht zuerst und ist die Vorauswahl, weil es der Regelfall ist —
 * die meisten Preise, die jemand vor dem Regal abtippt, sind schlicht der
 * Regalpreis. Die anderen drei sagen, warum dieser Preis nicht der übliche
 * ist, und genau deshalb dürfen sie den Referenzpreis nicht verschieben.
 */
export const PREISARTEN: { wert: Preisart; name: string }[] = [
  { wert: "NORMAL", name: "Normal" },
  { wert: "PROMO", name: "Aktion" },
  { wert: "LOYALTY", name: "Treuekarte" },
  { wert: "MULTIBUY", name: "Mengenrabatt" },
];

export function istPreisart(wert: string): wert is Preisart {
  return PREISARTEN.some((eintrag) => eintrag.wert === wert);
}

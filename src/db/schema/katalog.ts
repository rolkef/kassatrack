import { sql } from "drizzle-orm";
import { check, integer, pgTable, text } from "drizzle-orm/pg-core";

/**
 * Die Supermarktketten, deren Preise verglichen werden.
 *
 * Bewusst ohne Filialebene: Preise sind in Österreich innerhalb einer Kette
 * faktisch einheitlich. Eine Filialtabelle wäre Aufwand ohne Erkenntnisgewinn
 * und würde jede Abfrage um eine Ebene verlängern.
 */
export const chain = pgTable(
  "chain",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** Stabiler Schlüssel für Code und URLs, z. B. `billa`. */
    kuerzel: text("kuerzel").notNull().unique(),
    /** Anzeigereihenfolge. Nicht alphabetisch — Vollsortimenter zuerst. */
    sortierung: integer("sortierung").notNull(),
  },
  (tabelle) => [
    // Das Kürzel landet in URLs und wird im Code verglichen. Ohne diese
    // Bedingung würde ein großgeschriebener Eintrag stillschweigend nie treffen.
    check("chain_kuerzel_klein", sql`${tabelle.kuerzel} = lower(${tabelle.kuerzel})`),
  ],
);

export const category = pgTable("category", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
});

import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { product } from "@/db/schema/katalog";

export const shoppingList = pgTable(
  "shopping_list",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabelle) => [check("shopping_list_name_nicht_leer", sql`btrim(${tabelle.name}) <> ''`)],
);

/**
 * Ein Eintrag trägt entweder `product_id` oder `freitext`, nie beides, nie
 * keines. Ohne diese Bedingung könnte ein Eintrag ohne jeden Bezug entstehen
 * — unsichtbar für den Optimierer und für die Person, die ihn angelegt hat,
 * gleichermaßen nichtssagend.
 */
export const shoppingListItem = pgTable(
  "shopping_list_item",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => shoppingList.id, { onDelete: "cascade" }),
    /*
     * `set null`, nicht die Vorgabe (Verhindern): Produktlöschung existiert
     * heute nirgends in der App, aber sollte sie einmal entstehen, darf ein
     * gelöschtes Produkt einen Zettel-Eintrag nicht blockieren oder ihn
     * mitreißen — er soll als Rest bestehen bleiben. Das Nachtragen des
     * ursprünglichen Namens in `freitext` beim Löschen ist bewusst nicht
     * Teil dieses Plans: Es gibt noch keine Lösch-Stelle, an die sich das
     * hängen ließe (siehe Design-Spec, Abschnitt „Bewusst nicht drin").
     */
    productId: text("product_id").references(() => product.id, { onDelete: "set null" }),
    freitext: text("freitext"),
    stueckzahl: integer("stueckzahl").notNull().default(1),
    abgehaktAm: timestamp("abgehakt_am", { withTimezone: true }),
  },
  (tabelle) => [
    check(
      "shopping_list_item_genau_eine_quelle",
      sql`(${tabelle.productId} is not null) <> (${tabelle.freitext} is not null)`,
    ),
    check("shopping_list_item_stueckzahl_positiv", sql`${tabelle.stueckzahl} > 0`),
  ],
);

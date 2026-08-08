import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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

/**
 * Das kanonische Produkt — kettenübergreifend, genau einmal.
 *
 * `menge` und `einheit` sind Pflicht, weil ohne sie kein Grundpreis
 * berechenbar ist und damit kein Vergleich möglich wäre. Das ist der Grund,
 * warum sie hier stehen und nicht als optionales Beiwerk.
 */
export const product = pgTable(
  "product",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    marke: text("marke"),
    kategorieId: text("kategorie_id").references(() => category.id),
    /** In Gramm, Milliliter oder Stück — siehe src/lib/einheiten.ts. */
    menge: integer("menge").notNull(),
    einheit: text("einheit").notNull(),
    bildSchluessel: text("bild_schluessel"),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabelle) => [
    // Eine Menge von null würde beim Grundpreis durch null teilen.
    check("product_menge_positiv", sql`${tabelle.menge} > 0`),
    check("product_einheit_bekannt", sql`${tabelle.einheit} in ('G','ML','STK')`),
    check("product_name_nicht_leer", sql`btrim(${tabelle.name}) <> ''`),
  ],
);

/**
 * Strichcodes. Ein Produkt kann mehrere haben (Gebindewechsel, Regionen).
 *
 * Die Tabelle entsteht hier, obwohl erst Plan 3 sie füllt: Sie ist der Anker,
 * über den Barcode-Scan und Belegerkennung später ohne Ratespiel treffen.
 */
export const productEan = pgTable("product_ean", {
  ean: text("ean").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => product.id, { onDelete: "cascade" }),
});

/**
 * Die kettenspezifische Ausprägung eines Produkts.
 *
 * `rohNamen` sammelt die Kürzel, unter denen die Kette das Produkt schreibt
 * („BUTT.EXTRA 250"). Plan 4 nutzt sie für die Zuordnung von Belegzeilen;
 * hier entstehen sie schon, damit die Beobachtungen von Anfang an daran hängen.
 */
export const storeProduct = pgTable(
  "store_product",
  {
    id: text("id").primaryKey(),
    chainId: text("chain_id")
      .notNull()
      .references(() => chain.id),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    rohNamen: text("roh_namen").array().notNull().default(sql`'{}'::text[]`),
  },
  (tabelle) => [uniqueIndex("store_product_kette_produkt").on(tabelle.chainId, tabelle.productId)],
);

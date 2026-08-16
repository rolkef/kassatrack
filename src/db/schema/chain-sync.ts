import { sql } from "drizzle-orm";
import { check, integer, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { chain } from "@/db/schema/katalog";

/**
 * Artikel aus einem Ketten-Sync, die sich keinem Katalogprodukt eindeutig
 * zuordnen ließen. Kein Fremdschlüssel auf `product` — genau die fehlende
 * Zuordnung ist der Zweck dieser Tabelle.
 *
 * `feedId` (der ketteneigene, dauerhafte Produktcode aus dem Feed) statt
 * `rohname` ist der Schlüssel für „ist das derselbe offene Fall": Ein
 * Anzeigename kann sich ändern, der Produktcode bleibt.
 */
export const chainSyncUngeklaert = pgTable(
  "chain_sync_ungeklaert",
  {
    id: text("id").primaryKey(),
    chainId: text("chain_id")
      .notNull()
      .references(() => chain.id, { onDelete: "cascade" }),
    feedId: text("feed_id").notNull(),
    rohname: text("rohname").notNull(),
    /** In Gramm, Milliliter oder Stück — wie `product.menge`. */
    menge: integer("menge").notNull(),
    einheit: text("einheit").notNull(),
    /** Regalpreis zur Anzeige beim Zuordnen — keine Preis-Wahrheit. */
    letzterPreis: numeric("letzter_preis", { precision: 10, scale: 4 }).notNull(),
    zuerstGesehenAm: timestamp("zuerst_gesehen_am", { withTimezone: true }).notNull().defaultNow(),
    zuletztGesehenAm: timestamp("zuletzt_gesehen_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabelle) => [
    uniqueIndex("chain_sync_ungeklaert_kette_feed_id").on(tabelle.chainId, tabelle.feedId),
    check("chain_sync_ungeklaert_menge_positiv", sql`${tabelle.menge} > 0`),
    check("chain_sync_ungeklaert_einheit_bekannt", sql`${tabelle.einheit} in ('G','ML','STK')`),
    check("chain_sync_ungeklaert_preis_positiv", sql`${tabelle.letzterPreis} > 0`),
  ],
);

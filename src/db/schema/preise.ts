import { sql } from "drizzle-orm";
import { boolean, check, index, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { chain, product, storeProduct } from "@/db/schema/katalog";

export type Quelle = "RECEIPT" | "BARCODE" | "MANUAL" | "CHAIN_API" | "FLYER";
export type Preisart = "NORMAL" | "PROMO" | "LOYALTY" | "MULTIBUY";

/**
 * Jede beobachtete Preiszeile — append-only, nichts wird korrigiert.
 *
 * Warum nichts überschrieben wird: Ein Preis ist eine Tatsache zu einem
 * Zeitpunkt, keine Eigenschaft eines Produkts. Wer eine Beobachtung ändert,
 * verliert die Vergangenheit, aus der der Referenzpreis entsteht.
 *
 * Warum `numeric` und nicht `real`: Geld in Gleitkomma zu halten erzeugt
 * Abweichungen, die sich über Summen aufaddieren. `numeric` rechnet exakt.
 * Drizzle liefert es als String zurück — das ist Absicht, nicht ein Mangel.
 */
export const priceObservation = pgTable(
  "price_observation",
  {
    id: text("id").primaryKey(),
    storeProductId: text("store_product_id")
      .notNull()
      .references(() => storeProduct.id, { onDelete: "cascade" }),
    /** Redundant zu store_product, aber jede Abfrage filtert danach. */
    chainId: text("chain_id")
      .notNull()
      .references(() => chain.id),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    beobachtetAm: timestamp("beobachtet_am", { withTimezone: true }).notNull().defaultNow(),
    quelle: text("quelle").notNull(),
    preisart: text("preisart").notNull(),
    einzelpreis: numeric("einzelpreis", { precision: 10, scale: 4 }).notNull(),
    menge: numeric("menge", { precision: 10, scale: 3 }).notNull().default("1"),
    zeilensumme: numeric("zeilensumme", { precision: 10, scale: 4 }).notNull(),
    /** Preis je Kilogramm, Liter oder Stück — die einzige vergleichbare Zahl. */
    grundpreis: numeric("grundpreis", { precision: 12, scale: 4 }).notNull(),
    aktionsHinweis: text("aktions_hinweis"),
    aktionGueltigBis: timestamp("aktion_gueltig_bis", { withTimezone: true }),
    /** Einwegpfand, aus dem Einzelpreis bereits herausgerechnet. */
    pfandBetrag: numeric("pfand_betrag", { precision: 10, scale: 4 }).notNull().default("0"),
    konfidenz: numeric("konfidenz", { precision: 4, scale: 3 }).notNull().default("1"),
    pruefenNoetig: boolean("pruefen_noetig").notNull().default(false),
  },
  (tabelle) => [
    check(
      "preis_quelle_bekannt",
      sql`${tabelle.quelle} in ('RECEIPT','BARCODE','MANUAL','CHAIN_API','FLYER')`,
    ),
    check("preis_art_bekannt", sql`${tabelle.preisart} in ('NORMAL','PROMO','LOYALTY','MULTIBUY')`),
    check(
      "preis_positiv",
      sql`${tabelle.einzelpreis} > 0 and ${tabelle.zeilensumme} > 0 and ${tabelle.grundpreis} > 0`,
    ),
    // Eine Aktion ohne Ende ist keine Aktion, sondern der neue Normalpreis.
    // Ohne diese Bedingung würde sie den Bestpreis für immer verfälschen.
    check(
      "preis_aktion_hat_ende",
      sql`${tabelle.preisart} <> 'PROMO' or ${tabelle.aktionGueltigBis} is not null`,
    ),
    // konfidenz ist eine Wahrscheinlichkeit. Ohne diese Grenze ließe sich
    // jede Zahl eintragen, obwohl nur 0 bis 1 semantisch etwas bedeutet.
    check("preis_konfidenz_bereich", sql`${tabelle.konfidenz} >= 0 and ${tabelle.konfidenz} <= 1`),
    index("preis_produkt_kette_zeit").on(tabelle.productId, tabelle.chainId, tabelle.beobachtetAm),
  ],
);

/**
 * Laufende Aktionen aus Ketten-Schnittstellen oder Flugblättern.
 *
 * Bewusst getrennt von den Beobachtungen: Eine Beobachtung ist etwas, das
 * bereits bezahlt wurde. Eine Aktion ist eine Ankündigung für die Zukunft.
 *
 * Gefüllt wird sie seit Task 7 von der manuellen Erfassung: Wer „Aktion"
 * ankreuzt, erzeugt neben der Beobachtung eine Zeile hier. Ohne die bliebe die
 * Aktion für die ganze App unsichtbar, denn `holePreisMatrix` schließt `PROMO`
 * bei den Beobachtungen aus und liest den laufenden Aktionspreis allein aus
 * dieser Tabelle. Plan 3 füllt sie zusätzlich aus Ketten-Schnittstellen und
 * Flugblättern — `quelle` sagt, woher eine Zeile stammt.
 */
export const offer = pgTable(
  "offer",
  {
    id: text("id").primaryKey(),
    storeProductId: text("store_product_id")
      .notNull()
      .references(() => storeProduct.id, { onDelete: "cascade" }),
    preis: numeric("preis", { precision: 10, scale: 4 }).notNull(),
    gueltigVon: timestamp("gueltig_von", { withTimezone: true }).notNull(),
    gueltigBis: timestamp("gueltig_bis", { withTimezone: true }).notNull(),
    bedingung: text("bedingung"),
    quelle: text("quelle").notNull(),
  },
  (tabelle) => [
    check("offer_zeitraum", sql`${tabelle.gueltigBis} > ${tabelle.gueltigVon}`),
    check("offer_preis_positiv", sql`${tabelle.preis} > 0`),
  ],
);

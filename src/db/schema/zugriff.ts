import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const allowedEmail = pgTable("allowed_email", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  hinzugefuegtVon: text("hinzugefuegt_von"),
  erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
});

export const invite = pgTable("invite", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  erstelltVon: text("erstellt_von").notNull(),
  erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  gueltigBis: timestamp("gueltig_bis", { withTimezone: true }).notNull(),
  eingeloestAm: timestamp("eingeloest_am", { withTimezone: true }),
});

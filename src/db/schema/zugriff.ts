import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const allowedEmail = pgTable(
  "allowed_email",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    hinzugefuegtVon: text("hinzugefuegt_von"),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabelle) => [
    // Der leere String ist nicht durch `notNull()` ausgeschlossen und wäre
    // sonst die einzige Barriere gegen einen Treffer bei Leerzeichen-Eingaben
    // (siehe normalisiereEmail/istEmailZugelassen) — hier auf DB-Ebene erzwungen,
    // statt jedem Aufrufer zu vertrauen.
    check("allowed_email_nicht_leer", sql`${tabelle.email} <> ''`),
    // istEmailZugelassen vergleicht immer gegen die kleingeschriebene Form.
    // Ohne diesen Constraint würde eine mit Großbuchstaben gespeicherte Adresse
    // (z. B. durch Task 8) den Nutzer stillschweigend aussperren.
    check("allowed_email_klein", sql`${tabelle.email} = lower(${tabelle.email})`),
  ],
);

export const invite = pgTable("invite", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  erstelltVon: text("erstellt_von").notNull(),
  erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  gueltigBis: timestamp("gueltig_bis", { withTimezone: true }).notNull(),
  eingeloestAm: timestamp("eingeloest_am", { withTimezone: true }),
});

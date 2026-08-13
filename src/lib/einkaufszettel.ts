import { randomUUID } from "node:crypto";
import type { SQL } from "drizzle-orm";
import { asc, desc, eq } from "drizzle-orm";
import { shoppingList, shoppingListItem } from "@/db/schema/einkaufszettel";
import { holeProdukt, type Produkt } from "@/lib/katalog";
import type { DbOderTransaktion } from "@/lib/zugriff";

export type Liste = { id: string; name: string; erstelltAm: Date };

export async function erzeugeListe(db: DbOderTransaktion, name: string): Promise<Liste> {
  const [zeile] = await db
    .insert(shoppingList)
    .values({ id: randomUUID(), name: name.trim() })
    .returning({ id: shoppingList.id, name: shoppingList.name, erstelltAm: shoppingList.erstelltAm });

  return zeile as Liste;
}

export async function holeListen(db: DbOderTransaktion): Promise<Liste[]> {
  return db
    .select({ id: shoppingList.id, name: shoppingList.name, erstelltAm: shoppingList.erstelltAm })
    .from(shoppingList)
    .orderBy(desc(shoppingList.erstelltAm)) as Promise<Liste[]>;
}

export async function holeListe(db: DbOderTransaktion, id: string): Promise<Liste | null> {
  const [zeile] = await db
    .select({ id: shoppingList.id, name: shoppingList.name, erstelltAm: shoppingList.erstelltAm })
    .from(shoppingList)
    .where(eq(shoppingList.id, id))
    .limit(1);

  return (zeile as Liste | undefined) ?? null;
}

export async function loescheListe(db: DbOderTransaktion, id: string): Promise<void> {
  await db.delete(shoppingList).where(eq(shoppingList.id, id));
}

export type ZettelArtikel = {
  id: string;
  listId: string;
  produkt: Produkt | null;
  freitext: string | null;
  stueckzahl: number;
  abgehaktAm: Date | null;
};

/**
 * `where: SQL` statt `ReturnType<typeof eq>`: `eq` ist generisch, und ihr
 * Rückgabetyp über `ReturnType` zu greifen instanziiert das Generikum an
 * dieser einen Stelle — an den drei Aufrufstellen unten mit
 * unterschiedlichen Spalten (`id`, `listId`) kann das je nach TypeScript-
 * Fassung nicht mehr passen. `SQL` (aus `drizzle-orm`, ungetypt auf den
 * konkreten Ausdruck) ist der stabile Weg, ein zusammengesetztes
 * `where`-Fragment als Parameter zu reichen.
 */
async function ladeArtikel(db: DbOderTransaktion, where: SQL): Promise<ZettelArtikel[]> {
  const zeilen = await db
    .select({
      id: shoppingListItem.id,
      listId: shoppingListItem.listId,
      productId: shoppingListItem.productId,
      freitext: shoppingListItem.freitext,
      stueckzahl: shoppingListItem.stueckzahl,
      abgehaktAm: shoppingListItem.abgehaktAm,
    })
    .from(shoppingListItem)
    /*
     * Ohne `order by` liefert Postgres die Heap-Reihenfolge, und ein `update`
     * schreibt die Zeile neu ans Ende — auf dem Zettel spränge der Artikel,
     * dessen Stückzahl man gerade geändert hat, nach unten. Das trifft die
     * häufigste Geste des Listendetails.
     *
     * Nach `id` ist willkürlich, aber **stabil**: Die eigentlich richtige
     * Ordnung wäre die Einfügereihenfolge, und die braucht eine eigene
     * Zeitspalte, also eine Migration. Bis dahin ist eine feste Reihenfolge
     * das, worauf es hier ankommt.
     */
    .where(where)
    .orderBy(asc(shoppingListItem.id));

  const ergebnis: ZettelArtikel[] = [];
  for (const zeile of zeilen) {
    const produkt = zeile.productId ? await holeProdukt(db, zeile.productId) : null;
    ergebnis.push({
      id: zeile.id,
      listId: zeile.listId,
      produkt,
      freitext: zeile.freitext,
      stueckzahl: zeile.stueckzahl,
      abgehaktAm: zeile.abgehaktAm,
    });
  }
  return ergebnis;
}

export async function fuegeKatalogArtikelHinzu(
  db: DbOderTransaktion,
  listId: string,
  produktId: string,
  stueckzahl = 1,
): Promise<ZettelArtikel> {
  const [zeile] = await db
    .insert(shoppingListItem)
    .values({ id: randomUUID(), listId, productId: produktId, stueckzahl })
    .returning({ id: shoppingListItem.id });

  const [artikel] = await ladeArtikel(db, eq(shoppingListItem.id, zeile!.id));
  return artikel!;
}

export async function fuegeFreitextArtikelHinzu(
  db: DbOderTransaktion,
  listId: string,
  freitext: string,
  stueckzahl = 1,
): Promise<ZettelArtikel> {
  const [zeile] = await db
    .insert(shoppingListItem)
    .values({ id: randomUUID(), listId, freitext: freitext.trim(), stueckzahl })
    .returning({ id: shoppingListItem.id });

  const [artikel] = await ladeArtikel(db, eq(shoppingListItem.id, zeile!.id));
  return artikel!;
}

export async function holeArtikel(db: DbOderTransaktion, listId: string): Promise<ZettelArtikel[]> {
  return ladeArtikel(db, eq(shoppingListItem.listId, listId));
}

export async function aendereStueckzahl(
  db: DbOderTransaktion,
  itemId: string,
  stueckzahl: number,
): Promise<void> {
  await db.update(shoppingListItem).set({ stueckzahl }).where(eq(shoppingListItem.id, itemId));
}

export async function entferneArtikel(db: DbOderTransaktion, itemId: string): Promise<void> {
  await db.delete(shoppingListItem).where(eq(shoppingListItem.id, itemId));
}

export async function hakeItemAb(db: DbOderTransaktion, itemId: string): Promise<void> {
  await db
    .update(shoppingListItem)
    .set({ abgehaktAm: new Date() })
    .where(eq(shoppingListItem.id, itemId));
}

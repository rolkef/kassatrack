import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { shoppingList } from "@/db/schema/einkaufszettel";
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

import { eq } from "drizzle-orm";
import { product, productEan } from "@/db/schema/katalog";
import type { Produkt } from "@/lib/katalog";
import type { DbOderTransaktion } from "@/lib/zugriff";

/**
 * Löst eine gescannte EAN auf. Ein Primärschlüssel-Zugriff auf `product_ean`
 * genügt — anders als bei `findeProdukt` gibt es hier keine Ähnlichkeits-
 * frage: Eine EAN ist entweder verknüpft oder nicht.
 */
export async function findeProduktPerEan(
  db: DbOderTransaktion,
  ean: string,
): Promise<Produkt | null> {
  const [zeile] = await db
    .select({
      id: product.id,
      name: product.name,
      marke: product.marke,
      menge: product.menge,
      einheit: product.einheit,
      bildSchluessel: product.bildSchluessel,
    })
    .from(productEan)
    .innerJoin(product, eq(product.id, productEan.productId))
    .where(eq(productEan.ean, ean))
    .limit(1);

  return (zeile as Produkt | undefined) ?? null;
}

/**
 * Verknüpft eine EAN mit einem Produkt. `onConflictDoNothing` auf dem
 * Primärschlüssel `ean`: Zeigt die EAN bereits auf ein anderes Produkt —
 * etwa weil zwischen Auflösung und Bestätigung jemand anderes dieselbe
 * Zuordnung angelegt hat —, bleibt die bestehende Zuordnung unangetastet,
 * statt sie stillschweigend zu überschreiben.
 */
export async function verknuepfeEan(
  db: DbOderTransaktion,
  produktId: string,
  ean: string,
): Promise<void> {
  await db.insert(productEan).values({ ean, productId: produktId }).onConflictDoNothing({
    target: productEan.ean,
  });
}

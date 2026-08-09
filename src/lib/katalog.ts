import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { chain, product, storeProduct } from "@/db/schema/katalog";
import type { Basiseinheit } from "@/lib/einheiten";
import type { DbOderTransaktion } from "@/lib/zugriff";

export type Kette = { id: string; name: string; kuerzel: string };

/**
 * Die Ketten, die KassaTrack vergleicht.
 *
 * Reihenfolge ist Absicht: die beiden Vollsortimenter zuerst, weil dort die
 * meisten Preise entstehen, danach die Discounter. Alphabetisch wäre für
 * niemanden hilfreich.
 */
export const KETTEN = [
  { kuerzel: "billa", name: "Billa", sortierung: 10 },
  { kuerzel: "spar", name: "Spar", sortierung: 20 },
  { kuerzel: "hofer", name: "Hofer", sortierung: 30 },
  { kuerzel: "lidl", name: "Lidl", sortierung: 40 },
  { kuerzel: "penny", name: "Penny", sortierung: 50 },
] as const;

/** Legt fehlende Ketten an. Mehrfach aufrufbar. */
export async function legeKettenAn(db: DbOderTransaktion): Promise<void> {
  for (const eintrag of KETTEN) {
    await db
      .insert(chain)
      .values({ id: randomUUID(), ...eintrag })
      .onConflictDoNothing({ target: chain.kuerzel });
  }
}

export async function holeKetten(db: DbOderTransaktion): Promise<Kette[]> {
  return db
    .select({ id: chain.id, name: chain.name, kuerzel: chain.kuerzel })
    .from(chain)
    .orderBy(asc(chain.sortierung));
}

export type Produkt = {
  id: string;
  name: string;
  marke: string | null;
  menge: number;
  einheit: Basiseinheit;
};

export async function legeProduktAn(
  db: DbOderTransaktion,
  eingabe: { name: string; marke?: string | null; menge: number; einheit: Basiseinheit },
): Promise<Produkt> {
  const [zeile] = await db
    .insert(product)
    .values({
      id: randomUUID(),
      name: eingabe.name.trim(),
      marke: eingabe.marke?.trim() || null,
      menge: eingabe.menge,
      einheit: eingabe.einheit,
    })
    .returning({
      id: product.id,
      name: product.name,
      marke: product.marke,
      menge: product.menge,
      einheit: product.einheit,
    });

  return zeile as Produkt;
}

/**
 * Sucht das Produkt, das dieselbe Ware meint wie die Eingabe.
 *
 * Ohne diese Suche gäbe es den Vergleich nicht, um den es in KassaTrack geht:
 * Wer „Butter, 250 g" einmal bei Billa und einmal bei Spar erfasst, muss beide
 * Male dasselbe Produkt treffen. Entstünden zwei Produkte, stünde je ein Preis
 * daneben, und die Preismatrix hätte nie mehr als eine gefüllte Zeile.
 *
 * Groß-/Kleinschreibung und Randleerzeichen bleiben außer Betracht — im
 * Geschäft tippt man „butter", zuhause „Butter". Menge und Einheit dagegen
 * zählen streng: 250 g und 500 g sind zwei Waren, und ihre Grundpreise dürfen
 * sich nicht in einer Reihe mischen.
 *
 * Bewusst kein Datenbank-Index auf dieser Bedingung und keine
 * Eindeutigkeitsregel: Die Zusammenführung ist eine Annahme über Absicht, keine
 * Tatsache. Plan 3 ordnet über den Strichcode zu und darf diese Annahme dann
 * überstimmen, ohne gegen eine Bedingung zu laufen.
 */
export async function findeProdukt(
  db: DbOderTransaktion,
  eingabe: { name: string; marke?: string | null; menge: number; einheit: Basiseinheit },
): Promise<Produkt | null> {
  const name = eingabe.name.trim().toLowerCase();
  const marke = eingabe.marke?.trim().toLowerCase() || null;

  const [zeile] = await db
    .select({
      id: product.id,
      name: product.name,
      marke: product.marke,
      menge: product.menge,
      einheit: product.einheit,
    })
    .from(product)
    .where(
      and(
        sql`lower(btrim(${product.name})) = ${name}`,
        // `= null` trifft in SQL nie, auch nicht auf NULL. Ein Produkt ohne
        // Marke ließe sich sonst niemals wiederfinden und entstünde bei jeder
        // Erfassung neu.
        marke === null ? isNull(product.marke) : sql`lower(btrim(${product.marke})) = ${marke}`,
        eq(product.menge, eingabe.menge),
        eq(product.einheit, eingabe.einheit),
      ),
    )
    .limit(1);

  return (zeile as Produkt | undefined) ?? null;
}

/**
 * Liefert die Kennung der Ketten-Ausprägung eines Produkts und legt sie an,
 * falls es sie noch nicht gibt.
 *
 * Diese Zeile ist die Klammer, ohne die `schreibeBeobachtung` seit Task 6
 * verweigert: Sie prüft, dass `storeProductId`, `chainId` und `productId`
 * zusammenpassen, weil ein widersprüchliches Tripel den Preis der falschen
 * Kette gutgeschrieben hätte.
 *
 * Erst lesen, dann schreiben, dann noch einmal lesen: Der zweite Versuch fängt
 * den Fall ab, dass zwischen Prüfung und Einfügen jemand anderes dieselbe
 * Zuordnung angelegt hat. `onConflictDoNothing` allein genügte nicht, weil es
 * dann nichts zurückgibt.
 */
export async function sichereKettenProdukt(
  db: DbOderTransaktion,
  eingabe: { chainId: string; productId: string },
): Promise<string> {
  const suche = () =>
    db
      .select({ id: storeProduct.id })
      .from(storeProduct)
      .where(
        and(
          eq(storeProduct.chainId, eingabe.chainId),
          eq(storeProduct.productId, eingabe.productId),
        ),
      )
      .limit(1);

  const [vorhanden] = await suche();
  if (vorhanden) return vorhanden.id;

  const [angelegt] = await db
    .insert(storeProduct)
    .values({ id: randomUUID(), chainId: eingabe.chainId, productId: eingabe.productId })
    .onConflictDoNothing({ target: [storeProduct.chainId, storeProduct.productId] })
    .returning({ id: storeProduct.id });

  if (angelegt) return angelegt.id;

  const [nachgereicht] = await suche();
  if (!nachgereicht) {
    throw new Error(
      `Ketten-Zuordnung für Kette ${eingabe.chainId} und Produkt ${eingabe.productId} ` +
        `ließ sich weder anlegen noch finden.`,
    );
  }
  return nachgereicht.id;
}

/**
 * Wie ähnlich ein Name der Eingabe sein muss, um als Treffer zu gelten.
 *
 * 0,3 ist der Wert, den `pg_trgm` selbst voreinstellt, und er trägt hier: Aus
 * „Buter" wird „Butter" (0,625), aus „Zahnbürste" wird keine Butter (0,0).
 * Deutlich tiefer, und die Liste füllt sich mit Waren, die zufällig ein paar
 * Buchstaben teilen; deutlich höher, und der Tippfehler vor dem Regal findet
 * nichts mehr — genau der Fall, für den es diese Suche gibt.
 */
export const AEHNLICHKEITS_SCHWELLE = 0.3;

/** Wie viele Treffer eine Suche höchstens liefert. */
export const TREFFER_OBERGRENZE = 50;

/**
 * Sucht Produkte nach Ähnlichkeit über Name und Marke.
 *
 * Trigramm-Ähnlichkeit statt `like`, weil vor dem Regal einhändig getippt wird:
 * „Buter" muss „Butter" finden. Fände es das nicht, legte die Person das
 * Produkt ein zweites Mal an — und stünde danach vor zwei Produkten mit je
 * einem halben Preisvergleich. Das ist derselbe Schaden, den `findeProdukt`
 * auf dem Schreibpfad verhindert.
 *
 * Die Schwelle steht ausdrücklich als Vergleich im `where` und nicht als
 * `%`-Operator: Der liest die Sitzungsvariable `pg_trgm.similarity_threshold`,
 * die je nach Verbindung anders stehen kann. Eine Suche, deren Strenge davon
 * abhängt, welche Verbindung aus dem Pool kommt, wäre nicht nachvollziehbar.
 *
 * Ein leerer Begriff liefert nichts statt allem. Die Suchseite ruft ohne
 * Eingabe genauso auf wie mit; der ganze Katalog wäre dort keine Antwort.
 *
 * Kein Index: Bei einigen hundert Produkten liest Postgres die Tabelle
 * schneller, als es einen Index auswerten könnte. Sobald der Katalog wächst,
 * gehört ein GIN-Index ins Schema —
 * `create index product_name_trgm on product using gin (name gin_trgm_ops)`,
 * dazu einer auf `marke`. Der greift allerdings nur beim `%`-Operator, nicht
 * beim Vergleich hier; wer den Index einführt, muss beides zusammen umstellen.
 */
export async function sucheProdukte(db: DbOderTransaktion, begriff: string): Promise<Produkt[]> {
  const gesucht = begriff.trim();
  if (gesucht === "") return [];

  // `coalesce`, weil similarity(null, …) null ergibt und `greatest` das zwar
  // überspringt, der Vergleich im `where` damit aber für ein Produkt ohne
  // Marke unbestimmt bliebe.
  const aehnlichkeit = sql<number>`greatest(
    similarity(${product.name}, ${gesucht}),
    similarity(coalesce(${product.marke}, ''), ${gesucht})
  )`;

  const zeilen = await db
    .select({
      id: product.id,
      name: product.name,
      marke: product.marke,
      menge: product.menge,
      einheit: product.einheit,
    })
    .from(product)
    .where(sql`${aehnlichkeit} >= ${AEHNLICHKEITS_SCHWELLE}`)
    // Der Name als zweites Ordnungsmerkmal: Bei gleicher Ähnlichkeit — etwa
    // „Butter 250 g" und „Butter 500 g" — wäre die Reihenfolge sonst dem
    // Zufall überlassen und änderte sich zwischen zwei Aufrufen.
    .orderBy(sql`${aehnlichkeit} desc`, asc(product.name))
    .limit(TREFFER_OBERGRENZE);

  return zeilen as Produkt[];
}

export async function holeProdukt(db: DbOderTransaktion, id: string): Promise<Produkt | null> {
  const [zeile] = await db
    .select({
      id: product.id,
      name: product.name,
      marke: product.marke,
      menge: product.menge,
      einheit: product.einheit,
    })
    .from(product)
    .where(eq(product.id, id))
    .limit(1);

  return (zeile as Produkt | undefined) ?? null;
}

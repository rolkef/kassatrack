import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, gte, lte } from "drizzle-orm";
import { chain, product, storeProduct } from "@/db/schema/katalog";
import { offer, priceObservation, type Preisart, type Quelle } from "@/db/schema/preise";
import type { Basiseinheit } from "@/lib/einheiten";
import { holeKetten, type Kette } from "@/lib/katalog";
import { median } from "@/lib/median";
import type { DbOderTransaktion } from "@/lib/zugriff";

/** Wie weit zurück eine Beobachtung noch als aussagekräftig gilt. */
export const BEOBACHTUNGSFENSTER_TAGE = 180;

/**
 * Wie viele der jüngsten Beobachtungen in den Median eingehen.
 *
 * Das ist die Umsetzung von „aktualitätsgewichtet": Statt einer Gewichtung,
 * die niemand nachrechnen kann, zählen schlicht die letzten fünf. Erklärbar
 * in einem Satz, festnagelbar in einem Test.
 */
export const JUENGSTE_BEOBACHTUNGEN = 5;

export type PreisZeile = {
  kette: Kette;
  referenzpreis: number | null;
  anzahl: number;
  letzteBeobachtung: Date | null;
  aktion: { preis: number; gueltigBis: Date } | null;
  bestpreis: number | null;
};

/**
 * Weist NaN und Unendlich ab, bevor sie in eine `numeric`-Spalte geraten.
 *
 * Die Datenbank ist hier kein Auffangnetz: `numeric` nimmt den Wert `'NaN'`
 * klaglos an, und `NaN > 0` ist in Postgres **wahr** — die Bedingungen
 * `preis_positiv` und `offer_preis_positiv` lassen ihn also durch. Beim Lesen
 * gewinnt so ein Wert dann Vergleiche, die er verlieren müsste: `Math.min`
 * liefert NaN, und in `bestesAngebot` ist `NaN < x` immer falsch, weshalb die
 * Zeile als Sieger stehen bleibt und die Oberfläche wörtlich „NaN" anzeigt.
 *
 * Der Wächter steht in den Schreibfunktionen und nicht bloß in der Erfassungs-
 * Aktion, weil das die Grenze ist, die Plan 3 mit Flugblatt- und
 * Schnittstellen-Daten überschreitet — an der Oberfläche vorbei.
 */
function pruefeZahl(feld: string, wert: number): void {
  if (!Number.isFinite(wert)) {
    throw new Error(`${feld} muss eine endliche Zahl sein — bekommen: ${wert}.`);
  }
}

export async function schreibeBeobachtung(
  db: DbOderTransaktion,
  eingabe: {
    storeProductId: string;
    chainId: string;
    productId: string;
    quelle: Quelle;
    preisart: Preisart;
    einzelpreis: number;
    menge?: number;
    zeilensumme: number;
    grundpreis: number;
    aktionsHinweis?: string | null;
    aktionGueltigBis?: Date | null;
  },
): Promise<void> {
  pruefeZahl("einzelpreis", eingabe.einzelpreis);
  pruefeZahl("zeilensumme", eingabe.zeilensumme);
  pruefeZahl("grundpreis", eingabe.grundpreis);
  if (eingabe.menge !== undefined) pruefeZahl("menge", eingabe.menge);

  // storeProductId, chainId und productId sind drei unabhängige Fremdschlüssel
  // — keine Datenbank-Bedingung hält sie zusammen. Ohne diese Prüfung könnte
  // ein Aufrufer eine storeProductId der einen Kette mit der chainId einer
  // anderen kombinieren: die Zeile ließe sich klaglos einfügen, würde aber
  // beim Lesen der falschen Kette zugerechnet, weil holePreisMatrix die
  // Beobachtungshälfte über chainId und die Angebotshälfte über
  // store_product schlüsselt. Das ist derselbe Fehlkauf-Fehler, den der
  // Lesepfad verhindert — hier sitzt er auf dem Schreibpfad.
  const [zuordnung] = await db
    .select({ chainId: storeProduct.chainId, productId: storeProduct.productId })
    .from(storeProduct)
    .where(eq(storeProduct.id, eingabe.storeProductId))
    .limit(1);

  if (!zuordnung) {
    throw new Error(`Unbekannte storeProductId: ${eingabe.storeProductId}`);
  }
  if (zuordnung.chainId !== eingabe.chainId || zuordnung.productId !== eingabe.productId) {
    throw new Error(
      `storeProductId ${eingabe.storeProductId} gehört zu Kette ${zuordnung.chainId} und ` +
        `Produkt ${zuordnung.productId} — nicht zu ${eingabe.chainId} / ${eingabe.productId}.`,
    );
  }

  await db.insert(priceObservation).values({
    id: randomUUID(),
    storeProductId: eingabe.storeProductId,
    chainId: eingabe.chainId,
    productId: eingabe.productId,
    quelle: eingabe.quelle,
    preisart: eingabe.preisart,
    einzelpreis: eingabe.einzelpreis.toFixed(4),
    menge: (eingabe.menge ?? 1).toFixed(3),
    zeilensumme: eingabe.zeilensumme.toFixed(4),
    grundpreis: eingabe.grundpreis.toFixed(4),
    aktionsHinweis: eingabe.aktionsHinweis ?? null,
    aktionGueltigBis: eingabe.aktionGueltigBis ?? null,
  });
}

/**
 * Trägt eine laufende Aktion ein.
 *
 * Ohne diese Zeile bliebe eine erfasste Aktion für die ganze App unsichtbar:
 * `holePreisMatrix` nimmt den Referenzpreis aus den Beobachtungen und schließt
 * dort `PROMO` ausdrücklich aus — richtig, denn eine Aktion darf den
 * Normalpreis nicht verschieben. Den laufenden Aktionspreis liest es dagegen
 * ausschließlich aus **dieser** Tabelle. Wer bei Hofer eine Aktion erfasst und
 * nur eine Beobachtung schreibt, hat also in beide Richtungen nichts erreicht.
 *
 * Die Zeitraumprüfung steht hier und nicht nur in der Datenbank: Die Bedingung
 * `offer_zeitraum` würde einen verdrehten Zeitraum zwar ebenfalls ablehnen,
 * aber als technischen Fehler mitten in einer Transaktion. Ein Aufrufer soll
 * am Namen der Funktion ablesen können, was sie verlangt.
 *
 * **`preis` ist ein Grundpreis in € je Kilogramm, Liter oder Stück — nicht der
 * Regalpreis der Packung.** Das ist die wichtigste Zusage dieser Funktion und
 * die einzige, die keine Prüfbedingung absichert: 1,49 € für ein 250-g-Packerl
 * wäre eine völlig gültige `numeric(10,4)`. `holePreisMatrix` vergleicht den
 * Wert per `Math.min` gegen den Referenzpreis, und der ist der Median über
 * `price_observation.grundpreis`, also €/kg. Wer hier einen Regalpreis
 * einträgt, lässt jede Aktion wie das Angebot des Jahrhunderts aussehen und
 * kippt damit genau die Unterscheidung, für die es diese App gibt. Wer aus
 * Flugblättern oder Ketten-Schnittstellen einliest, rechnet also vorher um —
 * `zerlegePreis` aus `@/lib/einheiten` macht das für die Erfassung.
 */
export async function schreibeAngebot(
  db: DbOderTransaktion,
  eingabe: {
    storeProductId: string;
    /** Grundpreis in € je Kilogramm, Liter oder Stück — **kein** Regalpreis. */
    preis: number;
    gueltigVon: Date;
    gueltigBis: Date;
    quelle: Quelle;
    bedingung?: string | null;
  },
): Promise<void> {
  pruefeZahl("preis", eingabe.preis);

  if (eingabe.gueltigBis <= eingabe.gueltigVon) {
    throw new Error(
      `Ein Angebot muss enden, nachdem es begonnen hat — ` +
        `${eingabe.gueltigVon.toISOString()} bis ${eingabe.gueltigBis.toISOString()}.`,
    );
  }

  await db.insert(offer).values({
    id: randomUUID(),
    storeProductId: eingabe.storeProductId,
    preis: eingabe.preis.toFixed(4),
    gueltigVon: eingabe.gueltigVon,
    gueltigBis: eingabe.gueltigBis,
    bedingung: eingabe.bedingung ?? null,
    quelle: eingabe.quelle,
  });
}

/** Referenzpreis und aktueller Bestpreis, eine Zeile je Kette. */
export async function holePreisMatrix(
  db: DbOderTransaktion,
  productId: string,
): Promise<PreisZeile[]> {
  const ketten = await holeKetten(db);
  const grenze = new Date(Date.now() - BEOBACHTUNGSFENSTER_TAGE * 86_400_000);
  const jetzt = new Date();

  const zeilen: PreisZeile[] = [];

  for (const kette of ketten) {
    const beobachtungen = await db
      .select({
        grundpreis: priceObservation.grundpreis,
        beobachtetAm: priceObservation.beobachtetAm,
      })
      .from(priceObservation)
      .where(
        and(
          eq(priceObservation.productId, productId),
          eq(priceObservation.chainId, kette.id),
          // Nur Normalpreise. Aktionen sind der Grund, warum es diese
          // Trennung gibt — sie dürfen den Referenzpreis nicht verschieben.
          eq(priceObservation.preisart, "NORMAL"),
          gte(priceObservation.beobachtetAm, grenze),
        ),
      )
      .orderBy(desc(priceObservation.beobachtetAm))
      .limit(JUENGSTE_BEOBACHTUNGEN);

    // `numeric` kommt als String zurück — ohne Number(...) würde der Median
    // Zeichenketten sortieren ("10.4" < "9.6"), nicht Zahlen.
    const werte = beobachtungen.map((b) => Number(b.grundpreis));
    const referenzpreis = median(werte);
    // median filtert nicht-endliche Werte heraus. anzahl muss zählen, was
    // tatsächlich in die Berechnung eingegangen ist — nicht wie viele Zeilen
    // die Abfrage geliefert hat, sonst würde die Zahl mehr Vertrauen
    // vortäuschen, als die Berechnung hergibt.
    const anzahl = werte.filter(Number.isFinite).length;

    // Zweischritt statt Join mit rohem SQL: erst die store_product-Kennung
    // für diese Kette und dieses Produkt auflösen, dann die Aktion darauf
    // abfragen. So kann eine Aktion, die zu einer anderen Kette gehört, hier
    // nie auftauchen — sie hängt nicht am Produkt, sondern am store_product.
    const [zuordnung] = await db
      .select({ id: storeProduct.id })
      .from(storeProduct)
      .where(and(eq(storeProduct.chainId, kette.id), eq(storeProduct.productId, productId)))
      .limit(1);

    const [laufende] = zuordnung
      ? await db
          .select({ preis: offer.preis, gueltigBis: offer.gueltigBis })
          .from(offer)
          .where(
            and(
              eq(offer.storeProductId, zuordnung.id),
              lte(offer.gueltigVon, jetzt),
              gt(offer.gueltigBis, jetzt),
            ),
          )
          .orderBy(offer.preis)
          .limit(1)
      : [];

    const aktion = laufende
      ? { preis: Number(laufende.preis), gueltigBis: laufende.gueltigBis }
      : null;

    const bestpreis =
      aktion && referenzpreis !== null
        ? Math.min(aktion.preis, referenzpreis)
        : (aktion?.preis ?? referenzpreis);

    zeilen.push({
      kette,
      referenzpreis,
      anzahl,
      letzteBeobachtung: beobachtungen[0]?.beobachtetAm ?? null,
      aktion: aktion && bestpreis === aktion.preis ? aktion : null,
      bestpreis,
    });
  }

  return zeilen;
}

export type LetzteErfassung = {
  id: string;
  produktId: string;
  name: string;
  marke: string | null;
  menge: number;
  einheit: Basiseinheit;
  kette: string;
  /**
   * Warum die Liste sie braucht: Zwei Preise derselben Kette am selben Tag
   * sehen ohne diese Angabe wie widersprüchliche Daten aus. Mit ihr sind es
   * ein Regalpreis und eine Aktion — die Unterscheidung, um die es in dieser
   * App überhaupt geht.
   */
  preisart: Preisart;
  grundpreis: number;
  beobachtetAm: Date;
};

/** Wie viele Einträge die Startseite höchstens zeigt. */
export const STARTSEITE_EINTRAEGE = 8;

/**
 * Die zuletzt erfassten Preise, quer über alle Produkte und Ketten.
 *
 * Das ist der Einstieg der App und bewusst kein Kennzahlen-Feld: Was zuletzt
 * eingetragen wurde, beantwortet „läuft das hier?" und „was habe ich neulich
 * verglichen?" in einer Liste, die man auch wieder antippen kann. Eine große
 * Zahl über einem Balken beantwortete keine der beiden Fragen.
 *
 * Ohne Zeitfenster, anders als bei `holePreisMatrix`: Dort geht es darum, ob
 * ein Preis noch etwas über heute aussagt, hier darum, was zuletzt passiert
 * ist. Wer ein halbes Jahr nichts erfasst hat, soll seinen letzten Eintrag
 * sehen und nicht eine leere Seite, die aussieht wie ein Fehler.
 *
 * Alle Preisarten, auch `PROMO`: Die Liste ist ein Protokoll, keine Grundlage
 * für eine Berechnung. Der Ausschluss in `holePreisMatrix` gilt dort, weil eine
 * Aktion den Referenzpreis nicht verschieben darf — hier gibt es nichts zu
 * verschieben.
 */
export async function holeLetzteErfassungen(
  db: DbOderTransaktion,
  anzahl: number = STARTSEITE_EINTRAEGE,
): Promise<LetzteErfassung[]> {
  const zeilen = await db
    .select({
      id: priceObservation.id,
      produktId: product.id,
      name: product.name,
      marke: product.marke,
      menge: product.menge,
      einheit: product.einheit,
      kette: chain.name,
      preisart: priceObservation.preisart,
      grundpreis: priceObservation.grundpreis,
      beobachtetAm: priceObservation.beobachtetAm,
    })
    .from(priceObservation)
    .innerJoin(product, eq(priceObservation.productId, product.id))
    .innerJoin(chain, eq(priceObservation.chainId, chain.id))
    // Die Kennung als zweites Merkmal: Zwei Beobachtungen im selben Moment —
    // beim Erfassen mehrerer Zeilen aus einem Beleg keine Seltenheit — kämen
    // sonst zwischen zwei Aufrufen in wechselnder Reihenfolge.
    .orderBy(desc(priceObservation.beobachtetAm), desc(priceObservation.id))
    .limit(anzahl);

  // `numeric` kommt als String aus der Datenbank. Ohne Number(...) stünde auf
  // der Startseite „9.1600" statt „9,16". `einheit` und `preisart` sind
  // Textspalten und kommen deshalb als `string` — dieselbe Verengung wie in
  // `@/lib/katalog`.
  return zeilen.map((zeile) => ({
    ...zeile,
    einheit: zeile.einheit as Basiseinheit,
    preisart: zeile.preisart as Preisart,
    grundpreis: Number(zeile.grundpreis),
  }));
}

/**
 * Wer gewinnt langfristig, wer heute.
 *
 * Beide gleichzeitig, weil beide stimmen: Hofer kann normal teurer sein als
 * Spar und trotzdem diese Woche der richtige Weg sein.
 */
export function bestesAngebot(zeilen: PreisZeile[]): {
  referenzSieger: PreisZeile | null;
  heuteSieger: PreisZeile | null;
} {
  const mitReferenz = zeilen.filter((z) => z.referenzpreis !== null);
  const mitBest = zeilen.filter((z) => z.bestpreis !== null);

  const kleinster = <T>(liste: T[], wert: (e: T) => number): T | null =>
    liste.length === 0 ? null : liste.reduce((a, b) => (wert(b) < wert(a) ? b : a));

  return {
    referenzSieger: kleinster(mitReferenz, (z) => z.referenzpreis!),
    heuteSieger: kleinster(mitBest, (z) => z.bestpreis!),
  };
}

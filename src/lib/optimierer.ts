import { holeArtikel, type ZettelArtikel } from "@/lib/einkaufszettel";
import { holeKetten, type Kette } from "@/lib/katalog";
import { bestesAngebot, holePreisMatrix } from "@/lib/preise";
import type { DbOderTransaktion } from "@/lib/zugriff";

export type KettenSumme = { kette: Kette; summe: number; vollstaendig: boolean };
export type AufteilungsZeile = {
  kette: Kette;
  artikel: { artikel: ZettelArtikel; preis: number }[];
  summe: number;
};
export type Optimierung = {
  aufteilung: AufteilungsZeile[];
  aufteilungSumme: number;
  einzelmaerkte: KettenSumme[];
  guenstigsterEinzelmarkt: KettenSumme | null;
  ersparnis: number | null;
};

/**
 * Aggregiert ausschließlich über die bestehende Preis-Engine aus Plan 2 —
 * eine `holePreisMatrix`-Abfrage je katalogverknüpftem Artikel. Bei den zu
 * erwartenden Listengrößen (ein Haushalt, keine Nebenläufigkeit,
 * typischerweise unter 30 Positionen) ist das eine Frage von Millisekunden.
 */
export async function berechneOptimierung(db: DbOderTransaktion, listId: string): Promise<Optimierung> {
  const alleArtikel = await holeArtikel(db, listId);
  const katalogArtikel = alleArtikel.filter((a) => a.produkt !== null);
  const ketten = await holeKetten(db);

  const kettenSummen = new Map<string, number>(ketten.map((k) => [k.id, 0]));
  const kettenVollstaendig = new Map<string, boolean>(ketten.map((k) => [k.id, true]));
  const aufteilungNachKette = new Map<string, { artikel: ZettelArtikel; preis: number }[]>(
    ketten.map((k) => [k.id, []]),
  );
  let aufteilungSumme = 0;

  for (const artikel of katalogArtikel) {
    const zeilen = await holePreisMatrix(db, artikel.produkt!.id);

    for (const zeile of zeilen) {
      if (zeile.bestpreis === null) {
        kettenVollstaendig.set(zeile.kette.id, false);
        continue;
      }
      const bisherige = kettenSummen.get(zeile.kette.id) ?? 0;
      kettenSummen.set(zeile.kette.id, bisherige + zeile.bestpreis * artikel.stueckzahl);
    }

    const { heuteSieger } = bestesAngebot(zeilen);
    if (heuteSieger) {
      const preis = heuteSieger.bestpreis! * artikel.stueckzahl;
      aufteilungSumme += preis;
      aufteilungNachKette.get(heuteSieger.kette.id)?.push({ artikel, preis });
    }
  }

  // Ohne katalogverknüpfte Artikel wäre jede Kette „vollständig, Summe null"
  // — ein leerer Vergleich, der sich wie ein günstigster Markt ausgibt.
  const einzelmaerkte: KettenSumme[] = ketten.map((kette) => ({
    kette,
    summe: kettenSummen.get(kette.id) ?? 0,
    vollstaendig: (kettenVollstaendig.get(kette.id) ?? false) && katalogArtikel.length > 0,
  }));

  const vollstaendigeMaerkte = einzelmaerkte.filter((k) => k.vollstaendig);
  const guenstigsterEinzelmarkt =
    vollstaendigeMaerkte.length === 0
      ? null
      : vollstaendigeMaerkte.reduce((a, b) => (b.summe < a.summe ? b : a));

  const aufteilung: AufteilungsZeile[] = ketten
    .map((kette) => {
      const eintraege = aufteilungNachKette.get(kette.id) ?? [];
      return {
        kette,
        artikel: eintraege,
        summe: eintraege.reduce((summe, e) => summe + e.preis, 0),
      };
    })
    .filter((zeile) => zeile.artikel.length > 0);

  return {
    aufteilung,
    aufteilungSumme,
    einzelmaerkte,
    guenstigsterEinzelmarkt,
    ersparnis: guenstigsterEinzelmarkt ? guenstigsterEinzelmarkt.summe - aufteilungSumme : null,
  };
}

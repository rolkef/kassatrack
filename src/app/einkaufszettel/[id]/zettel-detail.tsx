"use client";

import { useCallback, useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";
import type { ErfassungsAktion } from "@/app/erfassen/zustand";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";
import { formatierePackung } from "@/lib/einheiten";
import type { ZettelArtikel } from "@/lib/einkaufszettel";
import type { Kette, Produkt } from "@/lib/katalog";
import { AbhakFormular } from "./abhak-formular";
import {
  STUECKZAHL_OBERGRENZE,
  type EntfernenAktion,
  type HinzufuegenAktion,
  type StueckzahlAktion,
  type SuchAktion,
} from "./zustand";

/**
 * Wie lange nach dem letzten Tastendruck gewartet wird, bevor gesucht wird.
 *
 * Ohne die Pause stellte „Buttermilch" elf Anfragen, von denen zehn niemand
 * liest. 200 ms sind der Wert, bei dem die Liste beim normalen Tippen erst
 * steht, wenn man von der Tastatur aufsieht — kurz genug, dass es sich nicht
 * wie Warten anfühlt.
 */
const SUCH_VERZOEGERUNG = 200;

type Aenderung =
  | { art: "hinzu"; artikel: ZettelArtikel }
  | { art: "stueckzahl"; id: string; stueckzahl: number }
  | { art: "entfernt"; id: string };

/**
 * Der Zettel selbst: was daraufsteht, und die eine Geste, mit der etwas
 * dazukommt.
 *
 * **Ein Feld für zwei Ausgänge.** Was hier eingetippt wird, kann zweierlei
 * werden: ein Katalogartikel, den KassaTrack über alle fünf Ketten
 * vergleicht, oder ein Freitext, der bloß eine Notiz an einen selbst ist.
 * Das ist der eigentliche Unterschied auf diesem Bildschirm — und deshalb
 * steht er *im* Feld und nicht in zwei Reitern darüber: Wer „Butter" tippt,
 * weiß vorher nicht, ob es die im Katalog gibt. Die Trefferliste beantwortet
 * das, während getippt wird, und der Freitext bleibt als Ausweg immer
 * darunter stehen. Zwei getrennte Eingaben zwängen dagegen zu einer
 * Entscheidung, die man erst nach der Suche treffen kann.
 *
 * **Entfernen fragt nicht nach.** Anders als `ListenZeile`, wo dieselbe Geste
 * eine ganze Liste mitsamt allem darauf unwiederbringlich löscht. Hier
 * verschwindet eine Zeile, die ein Tippen wiederherstellt — eine Rückfrage
 * davor wäre eine Bremse ohne Gefahr dahinter, und Rückfragen, die man
 * gewohnheitsmäßig wegklickt, entwerten die eine, die zählt. Aus demselben
 * Grund ist der Knopf nicht rot: Rot wirkt, weil es selten ist.
 *
 * **Der Zähler statt eines Zahlenfelds.** `<input type="number">` öffnet am
 * Handy die Zifferntastatur und verlangt Markieren-und-neu-Tippen für ein
 * „eins mehr"; seine eigenen Pfeilchen sind rund zehn Pixel hoch und damit
 * unter jeder Daumengrenze. Auf einem Einkaufszettel ändert sich die
 * Stückzahl fast immer um eins.
 *
 * **Der Haken sitzt links, wo er auf Papier auch säße.** Er ist die Geste
 * dieses Bildschirms im Geschäft und darf sich nicht mit Zähler und Entfernen
 * um denselben Platz streiten — am Handy stünden sonst drei Ziele
 * nebeneinander, die alle derselbe Daumen trifft. Links vor dem Namen hat er
 * seine eigene Spalte, liest sich als Einkaufszettel und ist zugleich die
 * Anzeige: Was erledigt ist, trägt dort ein gefülltes Häkchen.
 */
export function ZettelDetail({
  listId,
  artikel,
  ketten,
  empfohleneKetten,
  artikelHinzufuegen,
  stueckzahlAendern,
  entferneArtikel,
  sucheProdukte,
  erfassePreis,
}: {
  listId: string;
  artikel: ZettelArtikel[];
  ketten: Kette[];
  /**
   * Artikelkennung → Kettenkürzel, aus der optimalen Aufteilung. Bewusst
   * vorab aufgelöst statt der ganzen `Optimierung`: Die Zeile braucht genau
   * eine Zeichenkette, und die Oberfläche muss die Rechnung dahinter nicht
   * kennen.
   */
  empfohleneKetten: Record<string, string>;
  artikelHinzufuegen: HinzufuegenAktion;
  stueckzahlAendern: StueckzahlAktion;
  entferneArtikel: EntfernenAktion;
  sucheProdukte: SuchAktion;
  erfassePreis: ErfassungsAktion;
}) {
  const feldId = useId();
  const hilfeId = useId();
  /*
   * Eigene Kennung für die Beschriftung, obwohl `htmlFor` schon auf das Feld
   * zeigt: Der Abschnitt bekommt seinen Namen über `aria-labelledby`, und
   * zeigte der auf das **Feld**, nähme er dessen *Wert*. Im Browser nachgesehen
   * hieß der Abschnitt dann „Butter" statt „Artikel hinzufügen" — er wechselte
   * seinen Namen bei jedem Tastendruck.
   */
  const beschriftungId = useId();

  const feld = useRef<HTMLInputElement>(null);
  const [eingabe, setEingabe] = useState("");
  const [treffer, setTreffer] = useState<Produkt[]>([]);
  const [laedtTreffer, setLaedtTreffer] = useState(false);

  /*
   * Welcher Artikel gerade abgehakt wird — höchstens einer. Zwei offene
   * Preisformulare untereinander wären zwei Tastaturen und zwei
   * Speichern-Knöpfe für eine Handlung, die man einzeln erledigt.
   *
   * Der Haken selbst steht **nicht** hier: Ihn setzt `erfasse` in derselben
   * Transaktion wie den Preis, und sichtbar wird er über den neu erzeugten
   * Server-Durchlauf. Ein eigener Zustand dafür behauptete „erledigt", bevor
   * es das ist — genau der Zwischenstand, den der Entwurf ausschließt.
   */
  const [abzuhaken, setAbzuhaken] = useState<string | null>(null);
  /*
   * Stabil gehalten, weil `AbhakFormular` sie in einem Effekt aufruft: Eine
   * bei jedem Render neu erzeugte Funktion ließe den Effekt nach jedem Render
   * wieder anlaufen.
   */
  const schliesseAbhaken = useCallback(() => setAbzuhaken(null), []);

  const [, starteUebergang] = useTransition();

  /*
   * `useOptimistic` und nicht ein eigener `useState`: Grundlage bleibt immer
   * die Liste vom Server, die Änderung liegt nur so lange darüber, bis der
   * Übergang fertig ist. Ein eigener Zustand müsste dagegen von Hand
   * nachgeführt werden, sobald der Server eine neue Liste schickt — und liefe
   * ab dem ersten übersehenen Fall stillschweigend auseinander. Voraussetzung
   * dafür ist, dass **alle drei** Aktionen den Zwischenspeicher verwerfen;
   * täte eine es nicht, spränge ihre Änderung beim Ende des Übergangs zurück.
   * Siehe die Begründung in `aktionen.ts`.
   */
  const [sichtbar, aendere] = useOptimistic(artikel, (bisher: ZettelArtikel[], a: Aenderung) => {
    switch (a.art) {
      case "hinzu":
        return [...bisher, a.artikel];
      case "stueckzahl":
        return bisher.map((e) => (e.id === a.id ? { ...e, stueckzahl: a.stueckzahl } : e));
      case "entfernt":
        return bisher.filter((e) => e.id !== a.id);
    }
  });

  /*
   * Zählt die Suchläufe durch. Ohne diese Nummer überholt eine langsame
   * Antwort zu „Butt" eine schnelle zu „Buttermilch", und in der Liste stünde
   * etwas, das zur Eingabe nicht mehr passt.
   */
  const suchLauf = useRef(0);
  /** Nur zum Schlüsselvergeben für noch nicht gespeicherte Zeilen. */
  const vorlaeufig = useRef(0);

  useEffect(() => {
    const begriff = eingabe.trim();
    if (begriff === "") {
      setTreffer([]);
      setLaedtTreffer(false);
      return;
    }

    setLaedtTreffer(true);
    const lauf = ++suchLauf.current;
    const uhr = setTimeout(async () => {
      const gefunden = await sucheProdukte(begriff);
      if (lauf !== suchLauf.current) return;
      setTreffer(gefunden);
      setLaedtTreffer(false);
    }, SUCH_VERZOEGERUNG);

    return () => clearTimeout(uhr);
  }, [eingabe, sucheProdukte]);

  function fuegeHinzu(quelle: { produkt: Produkt } | { freitext: string }) {
    const neu: ZettelArtikel = {
      id: `vorlaeufig-${++vorlaeufig.current}`,
      listId,
      produkt: "produkt" in quelle ? quelle.produkt : null,
      freitext: "produkt" in quelle ? null : quelle.freitext,
      stueckzahl: 1,
      abgehaktAm: null,
    };

    setEingabe("");
    setTreffer([]);
    setLaedtTreffer(false);
    /*
     * Der Fokus bleibt im Feld. Einen Zettel schreibt man in einem Zug voll —
     * spränge er nach jedem Artikel weg, wäre jeder zweite Griff das
     * Zurücktippen ins Feld.
     */
    feld.current?.focus();

    starteUebergang(async () => {
      aendere({ art: "hinzu", artikel: neu });
      await artikelHinzufuegen(
        "produkt" in quelle
          ? { listId, produktId: quelle.produkt.id }
          : { listId, freitext: quelle.freitext },
      );
    });
  }

  function setzeStueckzahl(eintrag: ZettelArtikel, stueckzahl: number) {
    starteUebergang(async () => {
      aendere({ art: "stueckzahl", id: eintrag.id, stueckzahl });
      await stueckzahlAendern(eintrag.id, stueckzahl, listId);
    });
  }

  function entferne(eintrag: ZettelArtikel) {
    // Ein offenes Preisformular über einer Zeile, die es gleich nicht mehr
    // gibt, schriebe seinen Preis auf einen gelöschten Zettel-Eintrag.
    if (abzuhaken === eintrag.id) setAbzuhaken(null);
    starteUebergang(async () => {
      aendere({ art: "entfernt", id: eintrag.id });
      await entferneArtikel(eintrag.id, listId);
    });
  }

  const gesucht = eingabe.trim();

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby={beschriftungId} className="flex flex-col gap-3">
        <label id={beschriftungId} htmlFor={feldId} className="text-sm font-medium">
          Artikel hinzufügen
        </label>
        <input
          ref={feld}
          id={feldId}
          type="search"
          value={eingabe}
          onChange={(vorgang) => setEingabe(vorgang.target.value)}
          placeholder="z. B. Butter"
          autoComplete="off"
          autoCapitalize="sentences"
          spellCheck={false}
          aria-describedby={hilfeId}
          className={
            "min-h-14 w-full rounded-klein border border-linie-stark bg-hintergrund px-3.5 " +
            // 16 px sind die Untergrenze, ab der iOS beim Hineintippen nicht
            // mehr in das Feld hineinzoomt. Darunter verrutscht die ganze Seite.
            "text-base placeholder:text-gedaempft"
          }
        />
        <p id={hilfeId} className="text-[0.8125rem] leading-relaxed text-gedaempft">
          Was im Katalog steht, vergleicht KassaTrack über alle Ketten. Alles andere kannst du als
          Freitext danebenschreiben — als Erinnerung, ohne Preis.
        </p>

        {/*
          Die Zahl der Treffer wird angesagt, nicht bloß angezeigt: Wer die
          Liste nicht sieht, merkte sonst nicht, dass sich unter dem Feld
          gerade etwas aufgebaut hat.
        */}
        <p aria-live="polite" className="sr-only">
          {gesucht === "" || laedtTreffer
            ? ""
            : treffer.length === 0
              ? "Keine Treffer im Katalog."
              : `${treffer.length} Treffer im Katalog.`}
        </p>

        {gesucht === "" ? null : (
          <div className="flex flex-col gap-2">
            {treffer.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {treffer.map((produkt) => (
                  <li key={produkt.id}>
                    <Schaltflaeche
                      variante="neben"
                      className="w-full justify-between gap-4 px-3.5 text-left"
                      onClick={() => fuegeHinzu({ produkt })}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[0.9375rem] font-medium break-words">
                          {produkt.name}
                        </span>
                        <span className="text-xs font-normal text-gedaempft">
                          {produkt.marke ? `${produkt.marke} · ` : ""}
                          {formatierePackung(produkt.menge, produkt.einheit)}
                        </span>
                      </span>
                      <Plus />
                    </Schaltflaeche>
                  </li>
                ))}
              </ul>
            ) : laedtTreffer ? null : (
              /*
                Keine Sackgasse: Dass nichts im Katalog steht, ist genau der
                Fall, für den es den Freitext darunter gibt — also steht das
                auch da, statt bloß „nichts gefunden".
              */
              <p className="rounded-klein bg-hinweis px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-auf-hinweis">
                Nichts im Katalog zu „{gesucht}“. Schreib es als Freitext auf den Zettel — oder
                trag später einen Preis dazu ein, dann steht es beim nächsten Mal hier.
              </p>
            )}

            <Schaltflaeche
              variante={treffer.length > 0 ? "neben" : "haupt"}
              onClick={() => fuegeHinzu({ freitext: gesucht })}
            >
              Als Freitext hinzufügen
            </Schaltflaeche>
          </div>
        )}
      </section>

      <section aria-labelledby="zettel-artikel-titel" className="flex flex-col gap-3">
        <h2
          id="zettel-artikel-titel"
          className="flex items-baseline gap-2 text-[0.8125rem] font-semibold tracking-[0.08em] text-gedaempft uppercase"
        >
          Auf dem Zettel
          <span className="zahlen text-xs font-normal">{sichtbar.length}</span>
        </h2>

        {sichtbar.length === 0 ? (
          <div className="rounded-block bg-hinweis px-4 py-3.5 text-[0.9375rem] leading-relaxed text-auf-hinweis">
            <p>
              Noch nichts daraufgeschrieben. Tipp oben ein, was du brauchst — steht die Ware schon
              im Katalog, rechnet KassaTrack aus, in welchem Geschäft der ganze Zettel am wenigsten
              kostet.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-linie">
            {sichtbar.map((eintrag) => (
              <ArtikelZeile
                key={eintrag.id}
                eintrag={eintrag}
                listId={listId}
                ketten={ketten}
                empfohleneKette={empfohleneKetten[eintrag.id] ?? null}
                erfassePreis={erfassePreis}
                offen={abzuhaken === eintrag.id}
                schalteAbhaken={() =>
                  setAbzuhaken((bisher) => (bisher === eintrag.id ? null : eintrag.id))
                }
                schliesseAbhaken={schliesseAbhaken}
                setzeStueckzahl={setzeStueckzahl}
                entferne={entferne}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ArtikelZeile({
  eintrag,
  listId,
  ketten,
  empfohleneKette,
  erfassePreis,
  offen,
  schalteAbhaken,
  schliesseAbhaken,
  setzeStueckzahl,
  entferne,
}: {
  eintrag: ZettelArtikel;
  listId: string;
  ketten: Kette[];
  empfohleneKette: string | null;
  erfassePreis: ErfassungsAktion;
  offen: boolean;
  schalteAbhaken: () => void;
  schliesseAbhaken: () => void;
  setzeStueckzahl: (eintrag: ZettelArtikel, stueckzahl: number) => void;
  entferne: (eintrag: ZettelArtikel) => void;
}) {
  const bezeichnung = eintrag.produkt?.name ?? eintrag.freitext ?? "Artikel";
  const abgehakt = eintrag.abgehaktAm !== null;

  return (
    <li className="flex flex-col gap-2 py-3">
      {/*
        Am Handy stapeln sich Name und Bedienelemente, ab `sm` stehen sie
        nebeneinander. Gestapelt bleibt für den Namen die volle Breite — ein
        Produktname mit Marke und Größe daneben in eine Zeile gequetscht bräche
        sonst nach jedem Wort um.
      */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {abgehakt ? (
            <Erledigt />
          ) : (
            /*
              Rahmen und Fläche sitzen am Kästchen, nicht an der Schaltfläche —
              dieselbe Aufteilung wie beim `Zaehlknopf`. Die Schaltfläche liefert
              nur das 44-px-Ziel: Ein 24-px-Kästchen allein wäre am Daumen nicht
              zu treffen, und ein 44-px-Kästchen sähe aus wie ein Knopf.
            */
            <Schaltflaeche
              variante="neben"
              groesse="dicht"
              aria-label={`Abhaken, ${bezeichnung}`}
              aria-expanded={offen}
              onClick={schalteAbhaken}
              className="h-11 w-11 shrink-0 border-0 bg-transparent px-0"
              symbol={<Kaestchen offen={offen} />}
            />
          )}

          <div className="flex min-w-0 flex-col gap-0.5">
            <span
              className={
                "text-[1.0625rem] leading-snug font-medium break-words " +
                (abgehakt ? "text-gedaempft line-through decoration-linie-stark" : "")
              }
            >
              {bezeichnung}
              {abgehakt ? <span className="sr-only"> — abgehakt</span> : null}
            </span>
            <span className="text-xs text-gedaempft">
              {eintrag.produkt ? (
                <>
                  {eintrag.produkt.marke ? `${eintrag.produkt.marke} · ` : ""}
                  {formatierePackung(eintrag.produkt.menge, eintrag.produkt.einheit)}
                </>
              ) : (
                /*
                  Warum das dasteht: Der Optimierer rechnet die günstigste Kette
                  aus den Katalogartikeln aus und lässt Freitexte aus. Ohne
                  diesen Satz stünde dort eine Summe, der eine Zeile fehlt, ohne
                  dass jemand sagen könnte, welche. Abhaken lässt sich ein
                  Freitext trotzdem — dabei wird er zum Katalogprodukt.
                */
                "kein Preisvergleich"
              )}
            </span>
          </div>
        </div>

        {/* `gap-3` zwischen Zähler und Entfernen: zwei Ziele, die derselbe
            Daumen trifft, brauchen mehr als die 8 px Mindestabstand. `pl-14`
            rückt die Reihe am Handy unter den Namen statt unter den Haken —
            44 px Knopf plus 12 px Abstand. */}
        <div className="flex shrink-0 items-center gap-3 pl-14 sm:pl-0">
          <div
            role="group"
            aria-label={`Stückzahl, ${bezeichnung}`}
            className="flex items-center gap-1 rounded-klein border border-linie-stark"
          >
            <Zaehlknopf
              beschriftung={`Eins weniger, ${bezeichnung}`}
              zeichen="−"
              aus={eintrag.stueckzahl <= 1}
              beiKlick={() => setzeStueckzahl(eintrag, eintrag.stueckzahl - 1)}
            />
            <span
              data-testid={`stueckzahl-${eintrag.id}`}
              aria-live="polite"
              aria-atomic="true"
              className="zahlen min-w-8 text-center text-base tabular-nums"
            >
              {eintrag.stueckzahl}
              <span className="sr-only"> Stück {bezeichnung}</span>
            </span>
            <Zaehlknopf
              beschriftung={`Eins mehr, ${bezeichnung}`}
              zeichen="+"
              aus={eintrag.stueckzahl >= STUECKZAHL_OBERGRENZE}
              beiKlick={() => setzeStueckzahl(eintrag, eintrag.stueckzahl + 1)}
            />
          </div>

          {/*
            Mehrere Zeilen tragen denselben Knopf. Ohne den Namen der Ware hieße
            jeder von ihnen bloß „Entfernen" — in einer vorgelesenen Liste von
            Schaltflächen wäre keiner vom anderen zu unterscheiden.

            Der Name steht in `aria-label` und nicht wie bei `ListenZeile` in
            einem `sr-only`-Feld: Dort trägt die Zeile den Namen nur einmal, hier
            steht er schon sichtbar darüber, und ein zweites Textfeld mit
            demselben Wort machte aus jeder Ware zwei Textknoten. Weil die
            Beschriftung mit dem sichtbaren Wort beginnt, greift Sprachsteuerung
            („Entfernen anklicken") weiterhin.
          */}
          <Schaltflaeche
            variante="neben"
            groesse="dicht"
            aria-label={`Entfernen, ${bezeichnung}`}
            className="shrink-0"
            onClick={() => entferne(eintrag)}
          >
            Entfernen
          </Schaltflaeche>
        </div>
      </div>

      {offen ? (
        <AbhakFormular
          artikelId={eintrag.id}
          listId={listId}
          name={bezeichnung}
          marke={eintrag.produkt?.marke ?? null}
          /*
            `null` heißt „Freitext, keine Gebindegröße bekannt" — das Formular
            fragt sie dann ab. Beim Katalogartikel steht sie exakt so da, wie
            `findeProdukt` sie wiedererkennt; sie neu abzutippen legte beim
            kleinsten Unterschied ein zweites Produkt an.
          */
          menge={
            eintrag.produkt
              ? formatierePackung(eintrag.produkt.menge, eintrag.produkt.einheit)
              : null
          }
          empfohleneKette={empfohleneKette}
          ketten={ketten}
          aktion={erfassePreis}
          onAbgeschlossen={schliesseAbhaken}
          onAbbrechen={schliesseAbhaken}
        />
      ) : null}
    </li>
  );
}

/**
 * Das leere Kästchen — die Geste dieses Bildschirms.
 *
 * Es ist **leer**, und das ist der ganze Punkt: Im Browser stand hier zuerst
 * ein Häkchen als Symbol, und damit sah jede noch offene Zeile abgehakt aus.
 * Ein Kästchen mit Haken heißt „erledigt", ein Kästchen ohne heißt „noch
 * nicht" — an dieser einen Unterscheidung hängt die Lesbarkeit der ganzen
 * Liste. Offen und erledigt tragen deshalb dieselbe Form und unterscheiden
 * sich allein an Füllung und Haken.
 *
 * Der Rand ist zwei Pixel stark: Ein Haarstrich um 24 px verschwindet auf
 * einem hellen Papier neben einer 17-px-Zeile.
 */
function Kaestchen({ offen }: { offen: boolean }) {
  return (
    <span
      className={
        "flex size-6 items-center justify-center rounded-klein border-2 " +
        "transition-colors duration-150 ease-ruhig " +
        (offen ? "border-marke bg-flaeche" : "border-linie-stark bg-hintergrund")
      }
    />
  );
}

/**
 * Was schon im Wagen liegt.
 *
 * Grün, und das ist eine der zwei Stellen, an denen die Farbregel dieser App
 * es ausdrücklich erlaubt: Ein Häkchen ist Bestätigung, keine Kettenfarbe —
 * das liest niemand als Spar. Kein Knopf, weil es nichts zurückzunehmen gibt:
 * Der Haken hält fest, dass ein Preis erfasst wurde, und das ist geschehen.
 * Wer die Zeile doch nicht will, entfernt sie.
 */
function Erledigt() {
  return (
    <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center">
      <span className="flex size-6 items-center justify-center rounded-klein border-2 border-erfolg bg-erfolg text-auf-erfolg">
        <Haken />
      </span>
    </span>
  );
}

function Haken() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

/**
 * Ein Ende des Zählers. Der Rand sitzt an der Gruppe, nicht an den beiden
 * Knöpfen — deshalb hier `className` ohne eigenen Rahmen. `min-w-11` hält
 * auch das schmale „−" über der 44-px-Daumengrenze, die `groesse="dicht"`
 * nur in der Höhe zusichert.
 */
function Zaehlknopf({
  beschriftung,
  zeichen,
  aus,
  beiKlick,
}: {
  beschriftung: string;
  zeichen: string;
  aus: boolean;
  beiKlick: () => void;
}) {
  return (
    <Schaltflaeche
      variante="neben"
      groesse="dicht"
      aria-label={beschriftung}
      disabled={aus}
      onClick={beiKlick}
      className="min-w-11 border-0 bg-transparent px-3 text-lg"
      symbol={<span className="text-lg leading-none">{zeichen}</span>}
    />
  );
}

function Plus() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-4 shrink-0 text-gedaempft"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

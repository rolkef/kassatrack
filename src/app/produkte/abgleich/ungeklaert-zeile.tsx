"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";
import { formatiereBetrag, formatierePackung } from "@/lib/einheiten";
import type { Produkt } from "@/lib/katalog";
import {
  SUCH_VERZOEGERUNG,
  type Eintrag,
  type NeuAnlegenAktion,
  type SuchAktion,
  type VerwerfenAktion,
  type ZuordnenAktion,
} from "./zustand";

type Modus = "ruhig" | "suche" | "neu";

/**
 * Ein Artikel, den der Sync nicht zuordnen konnte — und die drei Wege daraus.
 *
 * Die Zeile zeigt zuerst nur, worum es geht, und klappt den gewählten Weg
 * darunter auf. Das ist keine Platzersparnis, sondern die Voraussetzung dafür,
 * dass diese Seite überhaupt eine Liste sein kann: Stünden Suchfeld und
 * Anlegeformular an jeder Zeile offen, wäre ein Bildschirm mit zwanzig
 * offenen Artikeln zwanzig Formulare übereinander und nirgends zu überblicken.
 *
 * Jeder Artikel wird einzeln bestätigt, es gibt bewusst kein „alle
 * übernehmen": Eine falsche Zuordnung schreibt Preise unter der falschen Ware
 * fest, und genau davor steht dieser Bildschirm.
 */
export function UngeklaertZeile({
  eintrag,
  sucheKatalog,
  ordneZu,
  legeNeuAn,
  verwerfe,
}: {
  eintrag: Eintrag;
  sucheKatalog: SuchAktion;
  ordneZu: ZuordnenAktion;
  legeNeuAn: NeuAnlegenAktion;
  verwerfe: VerwerfenAktion;
}) {
  const [modus, setModus] = useState<Modus>("ruhig");
  const [meldung, setMeldung] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const [suchbegriff, setSuchbegriff] = useState("");
  const [treffer, setTreffer] = useState<Produkt[]>([]);
  const [laedtTreffer, setLaedtTreffer] = useState(false);

  const [name, setName] = useState(eintrag.rohname);
  const [marke, setMarke] = useState("");

  const suchfeldId = useId();
  const nameId = useId();
  const markeId = useId();

  const suchfeld = useRef<HTMLInputElement>(null);
  const namensfeld = useRef<HTMLInputElement>(null);
  const zuordnenAusloeser = useRef<HTMLButtonElement>(null);
  const anlegenAusloeser = useRef<HTMLButtonElement>(null);
  /*
   * Nur bei einem *bewussten* Abbruch soll der Fokus zurückspringen. Ohne
   * diese Merkmarke zöge jede Zeile den Fokus schon beim ersten Aufbau an
   * sich, wenn irgendwo anders auf der Seite gearbeitet wird.
   */
  const zurueckZu = useRef<Modus | null>(null);

  /*
   * Ohne das ist der Bildschirm für Tastatur und Screenreader kaputt: Beim
   * Aufklappen wird der Auslöser ausgehängt, der Fokus fällt auf
   * `document.body`, und das nächste Tab beginnt wieder ganz oben im
   * Dokument. Dieselbe Lehre wie bei `ZugangsZeile` in der Zugriffsverwaltung.
   */
  useEffect(() => {
    if (modus === "suche") {
      suchfeld.current?.focus();
    } else if (modus === "neu") {
      namensfeld.current?.focus();
    } else if (zurueckZu.current) {
      const ziel = zurueckZu.current === "suche" ? zuordnenAusloeser : anlegenAusloeser;
      zurueckZu.current = null;
      ziel.current?.focus();
    }
  }, [modus]);

  /*
   * Gesucht wird erst, wenn das Tippen aufhört. Jeder Tastendruck wäre sonst
   * eine eigene Rundreise zum Server samt Trigramm-Suche für einen Begriff,
   * der im nächsten Moment schon ein anderer ist.
   *
   * Der Zähler ist kein Beiwerk: Ohne ihn überholt eine langsame Antwort zu
   * „Butt" eine schnelle zu „Buttermilch", und in der Liste stünde etwas, das
   * zur Eingabe nicht mehr passt. Dasselbe Muster wie im Zettel-Detail.
   */
  const suchLauf = useRef(0);

  useEffect(() => {
    const begriff = suchbegriff.trim();
    if (begriff === "") {
      setTreffer([]);
      setLaedtTreffer(false);
      return;
    }

    setLaedtTreffer(true);
    const lauf = ++suchLauf.current;
    const uhr = setTimeout(async () => {
      const gefunden = await sucheKatalog(begriff);
      if (lauf !== suchLauf.current) return;
      setTreffer(gefunden);
      setLaedtTreffer(false);
    }, SUCH_VERZOEGERUNG);

    return () => clearTimeout(uhr);
  }, [suchbegriff, sucheKatalog]);

  function oeffne(ziel: Exclude<Modus, "ruhig">) {
    setMeldung(null);
    setModus(ziel);
  }

  function brichAb() {
    zurueckZu.current = modus;
    setSuchbegriff("");
    setTreffer([]);
    setModus("ruhig");
  }

  /**
   * Führt eine Aktion aus und hält die Zeile so lange gesperrt.
   *
   * Ohne die Sperre ließe sich derselbe Eintrag zweimal zuordnen, während der
   * erste Aufruf noch läuft — der zweite liefe dann in „nicht mehr offen" und
   * sähe aus wie ein Fehler, obwohl beide Klicks richtig waren.
   */
  async function fuehreAus(aktion: () => Promise<Ergebnisartig>) {
    if (laeuft) return;
    setLaeuft(true);
    try {
      const ergebnis = await aktion();
      if (ergebnis && !ergebnis.erfolg) setMeldung(ergebnis.meldung);
    } finally {
      setLaeuft(false);
    }
  }

  const gesucht = suchbegriff.trim();
  const gewaehlterName = name.trim();

  return (
    <li className="flex flex-col gap-3 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[0.9375rem] font-medium break-words">{eintrag.rohname}</span>
        <span className="text-xs text-gedaempft">
          {/*
            Bewusst ohne `zahlen`: Martian Mono gehört dorthin, wo Ziffern
            untereinander stehen und verglichen werden (siehe globals.css).
            Hier läuft der Preis mitten in einer Zeile Fließtext — die sehr
            breite Schrift risse ihn dort heraus, ohne dass es etwas zu
            vergleichen gäbe.
          */}
          {eintrag.kettenName} · {formatierePackung(eintrag.menge, eintrag.einheit)} ·{" "}
          {formatiereBetrag(eintrag.letzterPreis)} €
        </span>
      </div>

      {meldung ? (
        <p role="alert" className="text-sm text-fehler">
          {meldung}
        </p>
      ) : null}

      {modus === "ruhig" ? (
        <div className="flex flex-wrap gap-2">
          <Schaltflaeche
            ref={zuordnenAusloeser}
            variante="neben"
            groesse="dicht"
            onClick={() => oeffne("suche")}
          >
            Bestehendem Produkt zuordnen
            <span className="sr-only">für {eintrag.rohname}</span>
          </Schaltflaeche>
          <Schaltflaeche
            ref={anlegenAusloeser}
            variante="neben"
            groesse="dicht"
            onClick={() => oeffne("neu")}
          >
            Als neues Produkt anlegen
            <span className="sr-only">für {eintrag.rohname}</span>
          </Schaltflaeche>
          {/*
            Nicht rot, und ohne Rückfrage. Der Sync meldet jeden nicht
            zuordenbaren Artikel bei jedem Lauf erneut — der Eintrag steht
            morgen wieder da, das ist ein „nicht jetzt" und keine Zerstörung.
            `--color-fehler` ist in dieser App der Zerstörung vorbehalten;
            stünde es an jeder Zeile einer Liste, wäre die ganze Seite rot und
            die Warnung dort, wo sie zählt, nichts mehr wert.
          */}
          <Schaltflaeche
            variante="neben"
            groesse="dicht"
            laedt={laeuft}
            onClick={() => fuehreAus(async () => void (await verwerfe(eintrag.id)))}
          >
            Verwerfen
            <span className="sr-only">für {eintrag.rohname}</span>
          </Schaltflaeche>
        </div>
      ) : null}

      {modus === "suche" ? (
        // Escape bricht ab — was Tastaturnutzende an dieser Stelle erwarten.
        <div
          className="flex flex-col gap-3 rounded-klein bg-flaeche p-3.5"
          onKeyDown={(ereignis) => {
            if (ereignis.key === "Escape") brichAb();
          }}
        >
          <label htmlFor={suchfeldId} className="text-sm font-medium">
            Produkt suchen
          </label>
          <input
            ref={suchfeld}
            id={suchfeldId}
            type="search"
            value={suchbegriff}
            onChange={(vorgang) => setSuchbegriff(vorgang.target.value)}
            placeholder="z. B. Butter"
            autoComplete="off"
            autoCapitalize="sentences"
            spellCheck={false}
            className={
              "min-h-11 w-full rounded-klein border border-linie-stark bg-hintergrund px-3 " +
              // 16 px sind die Untergrenze, ab der iOS beim Hineintippen nicht
              // in das Feld hineinzoomt. Darunter verrutscht die ganze Seite.
              "text-base placeholder:text-gedaempft"
            }
          />

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

          {gesucht === "" ? null : treffer.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {treffer.map((gefunden) => (
                <li key={gefunden.id}>
                  {/*
                    `aria-label` statt eines zusätzlichen `sr-only`-Zusatzes:
                    Der sichtbare Inhalt ist Name, Marke und Gebinde und sagt
                    für sich genommen nicht, was ein Klick bewirkt. Angesagt
                    gehört beides — Handlung zuerst, dann die Ware.
                  */}
                  <Schaltflaeche
                    variante="neben"
                    groesse="dicht"
                    laedt={laeuft}
                    aria-label={`Diesem Produkt zuordnen: ${gefunden.name}${
                      gefunden.marke ? `, ${gefunden.marke}` : ""
                    }, ${formatierePackung(gefunden.menge, gefunden.einheit)}`}
                    className="w-full justify-between gap-4 px-3 text-left"
                    onClick={() => fuehreAus(() => ordneZu(eintrag.id, gefunden.id))}
                  >
                    {/*
                      `flex-1` ist hier nicht Kosmetik: `Schaltflaeche` stellt
                      immer einen — hier leeren — Platz für ihr Symbol voran.
                      Unter `justify-between` sind das drei Kinder, und der
                      Text landete mittig zwischen leerem Platz und Haken
                      statt am linken Rand. Mit `flex-1` nimmt der Text den
                      freien Raum und der Haken bleibt rechts.
                    */}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[0.9375rem] font-medium break-words">
                        {gefunden.name}
                      </span>
                      <span className="text-xs font-normal text-gedaempft">
                        {gefunden.marke ? `${gefunden.marke} · ` : ""}
                        {formatierePackung(gefunden.menge, gefunden.einheit)}
                      </span>
                    </span>
                    <Haken />
                  </Schaltflaeche>
                </li>
              ))}
            </ul>
          ) : laedtTreffer ? null : (
            /*
              Keine Sackgasse: Dass nichts im Katalog steht, ist genau der
              Fall, für den es den zweiten Weg gibt — also steht das auch da,
              statt bloß „nichts gefunden".
            */
            <p className="rounded-klein bg-hinweis px-3 py-2.5 text-[0.8125rem] leading-relaxed text-auf-hinweis">
              Nichts im Katalog zu „{gesucht}“. Wenn es die Ware noch nicht gibt, leg sie über „Als
              neues Produkt anlegen“ an.
            </p>
          )}

          <Schaltflaeche variante="neben" groesse="dicht" className="self-start" onClick={brichAb}>
            Abbrechen
          </Schaltflaeche>
        </div>
      ) : null}

      {modus === "neu" ? (
        <div
          className="flex flex-col gap-3 rounded-klein bg-flaeche p-3.5"
          onKeyDown={(ereignis) => {
            if (ereignis.key === "Escape") brichAb();
          }}
        >
          {/*
            Der Name ist änderbar, und das ist der eigentliche Zweck dieses
            Formulars: „BUTT.EXTRA 250" ist der Abkürzungsjargon der Kette,
            nicht der Name, unter dem diese Ware im Katalog stehen soll. Wäre
            er fest, schriebe dieser Bildschirm den Jargon dauerhaft fest.

            Menge und Einheit sind bewusst **keine** Felder: Sie sind die
            Angabe des Feeds und zugleich das Merkmal, an dem „Butter 250 g"
            von „Butter 500 g" unterschieden wird. Sie stehen als Satz da,
            damit sichtbar ist, was gleich entsteht.
          */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-sm font-medium">
              Name
            </label>
            <input
              ref={namensfeld}
              id={nameId}
              type="text"
              value={name}
              onChange={(vorgang) => setName(vorgang.target.value)}
              autoComplete="off"
              autoCapitalize="sentences"
              spellCheck={false}
              className={
                "min-h-11 w-full rounded-klein border border-linie-stark bg-hintergrund px-3 " +
                "text-base placeholder:text-gedaempft"
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={markeId} className="text-sm font-medium">
              Marke <span className="font-normal text-gedaempft">(wenn bekannt)</span>
            </label>
            <input
              id={markeId}
              type="text"
              value={marke}
              onChange={(vorgang) => setMarke(vorgang.target.value)}
              placeholder="z. B. Berglandmilch"
              autoComplete="off"
              autoCapitalize="sentences"
              spellCheck={false}
              className={
                "min-h-11 w-full rounded-klein border border-linie-stark bg-hintergrund px-3 " +
                "text-base placeholder:text-gedaempft"
              }
            />
          </div>

          <p className="text-[0.8125rem] leading-relaxed text-gedaempft">
            Gebinde: {formatierePackung(eintrag.menge, eintrag.einheit)} — aus dem Feed übernommen
            und nicht änderbar, weil die Preise darunter sich darauf beziehen.
          </p>

          <div className="flex flex-wrap gap-2">
            <Schaltflaeche
              variante="haupt"
              groesse="dicht"
              laedt={laeuft}
              disabled={gewaehlterName === ""}
              /*
                Der leere Name wird zweimal abgefangen: `disabled` sagt es
                vorher, die Prüfung hier hält es auch dann, wenn der Klick
                trotzdem ankommt. Das ist kein Gürtel-und-Hosenträger — ein
                deaktivierter Knopf ist eine Aussage der Oberfläche, keine
                Sperre, und `legeAlsNeuesProduktAn` weist den leeren Namen
                seinerseits ab, weil Server-Aktionen ohne diese Seite
                aufrufbar sind.
              */
              onClick={() => {
                if (gewaehlterName === "") return;
                fuehreAus(() =>
                  legeNeuAn(eintrag.id, {
                    name: gewaehlterName,
                    marke: marke.trim() === "" ? null : marke.trim(),
                  }),
                );
              }}
            >
              Anlegen
            </Schaltflaeche>
            <Schaltflaeche variante="neben" groesse="dicht" onClick={brichAb}>
              Abbrechen
            </Schaltflaeche>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** Was `fuehreAus` an Rückgaben verträgt: ein Ergebnis oder gar nichts. */
type Ergebnisartig = { erfolg: true } | { erfolg: false; meldung: string } | void;

/**
 * Derselbe Strich wie beim Pfeil der Trefferliste und den Symbolen der
 * Navigationsleiste (16er-Feld, 1,75, runde Enden), damit die Seite nicht wie
 * ein zugekauftes Teil wirkt.
 */
function Haken() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-4 shrink-0 text-gedaempft"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 8.5 3.5 3.5L13 4.5" />
    </svg>
  );
}

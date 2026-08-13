"use client";

import { useActionState, useEffect, useId, useRef, useState, type RefObject } from "react";
import type { ErfassungsAktion, Ergebnis } from "@/app/erfassen/zustand";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";
import type { Kette } from "@/lib/katalog";

/**
 * Abhaken und Preis eintragen — ein Griff, nicht zwei Bildschirme.
 *
 * **Warum das kein Verweis auf `/erfassen` ist.** Wer im Geschäft einen
 * Artikel abhakt, hält die Ware in der Hand und den Zettel am Display. Ein
 * Wechsel auf die volle Erfassungsseite kostete den Platz auf der Liste, und
 * zurück käme man auf einen Zettel, der nicht mehr weiß, wo man war. Also
 * öffnet sich das Formular in der Zeile, und es fragt genau das, was der
 * Zettel nicht schon weiß: bei welcher Kette, zu welchem Preis. Produkt, Marke
 * und Gebindegröße kommen aus dem Katalogeintrag und werden unsichtbar
 * mitgeschickt — exakt in der Schreibweise, in der `findeProdukt` sie
 * wiedererkennt. Tippte man sie neu ab, entstünde beim kleinsten Unterschied
 * ein zweites Produkt, und der Preisvergleich zerfiele in zwei Hälften.
 *
 * **Ein Freitext-Artikel bekommt zwei Felder mehr.** Hinter ihm steht kein
 * Produkt, also fehlen Name und Gebindegröße. Der Notizzettel-Text steht als
 * Vorschlag im Produktfeld — er ist schließlich das, was die Person selbst
 * aufgeschrieben hat. Damit wird aus „Salz" beim ersten Abhaken ein
 * Katalogprodukt, über denselben `findeProdukt`/`legeProduktAn`-Pfad wie
 * überall sonst; einen eigenen Bildschirm dafür gibt es bewusst nicht.
 *
 * **Der Haken entsteht erst beim Speichern.** Das Formular hakt nichts ab —
 * es schickt `zettelItemId` mit, und `erfasse` setzt den Haken innerhalb
 * derselben Transaktion wie den Preis. Wird die Eingabe abgewiesen oder
 * bricht die Person ab, bleibt der Artikel unverändert stehen. Es gibt hier
 * deshalb keinen Zwischenzustand „abgehakt, aber ohne Preis", den jemand
 * später aufräumen müsste.
 */
export function AbhakFormular({
  artikelId,
  listId,
  name,
  marke,
  menge,
  empfohleneKette,
  ketten,
  aktion,
  onAbgeschlossen,
  onAbbrechen,
}: {
  artikelId: string;
  listId: string;
  name: string;
  marke: string | null;
  /** Die Gebindegröße als Text („250 g") — `null` bei einem Freitext-Artikel. */
  menge: string | null;
  empfohleneKette: string | null;
  ketten: Kette[];
  aktion: ErfassungsAktion;
  onAbgeschlossen: () => void;
  onAbbrechen: () => void;
}) {
  const preisId = useId();
  const nameId = useId();
  const mengeId = useId();

  const freitext = menge === null;

  /*
   * Die drei Textfelder hängen an React und nicht am Markup. Im Browser
   * nachgemessen: React setzt ein Formular zurück, sobald seine Aktion fertig
   * ist — auch bei einer Abweisung. Uneingebundene Felder standen danach
   * wieder leer da, und wer beim Freitext „500 g" eingetippt hatte, tippte es
   * nach einem Tippfehler im Preis ein zweites Mal ab. Die Optionsfelder
   * darunter bleiben bewusst uneingebunden: Das Zurücksetzen stellt dort die
   * Vorauswahl aus dem Markup wieder her, also genau die empfohlene Kette.
   */
  const [preis, setPreis] = useState("");
  const [produktName, setProduktName] = useState(name);
  const [gebinde, setGebinde] = useState("");

  /*
   * Der Fokus springt in das Feld, das als Erstes zu füllen ist: beim
   * Katalogartikel der Preis, beim Freitext die Gebindegröße darüber. Wer auf
   * „Abhaken" getippt hat, will tippen — ein Formular, das aufgeht und den
   * Fokus stehen lässt, kostet am Handy einen zusätzlichen Griff und ein
   * zweites Aufgehen der Tastatur.
   */
  const erstesFeld = useRef<HTMLInputElement>(null);
  useEffect(() => {
    erstesFeld.current?.focus();
  }, []);

  const [ergebnis, absenden, laeuft] = useActionState<Ergebnis | undefined, FormData>(
    aktion,
    undefined,
  );

  useEffect(() => {
    if (ergebnis?.art === "erfolg") onAbgeschlossen();
  }, [ergebnis, onAbgeschlossen]);

  const empfohlen = ketten.find((kette) => kette.kuerzel === empfohleneKette);

  return (
    <form
      action={absenden}
      /*
       * `aria-label` und nicht `aria-labelledby` auf einen Text im Formular:
       * Zeigte die Beschriftung auf ein Bedienelement — und sei es über einen
       * Umweg —, nähme der Abschnitt dessen *Wert* als Namen und hieße beim
       * Tippen „2,49". Derselbe Fehler, der in Task 7 im
       * Barrierefreiheitsbaum von Chromium aufgefallen ist.
       */
      aria-label={`Preis eintragen, ${name}`}
      data-auftritt
      className="mt-1 flex animate-auftritt flex-col gap-4 rounded-block bg-flaeche px-4 py-4"
    >
      <input type="hidden" name="zettelItemId" value={artikelId} />
      {/*
        Ausschließlich dafür da, dass die Aktion weiß, welchen Zettel sie neu
        erzeugen lassen muss. `erfasse` selbst liest das Feld nicht.
      */}
      <input type="hidden" name="listId" value={listId} />
      <input type="hidden" name="marke" value={marke ?? ""} />
      {/*
        Beim Abhaken wird ein Regalpreis erfasst, kein Sonderfall. Eine Aktion
        bräuchte ein Gültig-bis-Datum, das dieses Formular nicht hat — dafür
        gibt es die volle Erfassungsseite.
      */}
      <input type="hidden" name="preisart" value="NORMAL" />

      {freitext ? (
        <div className="flex flex-col gap-3">
          <Feld
            id={nameId}
            etikett="Produkt"
            name="name"
            wert={produktName}
            aendere={setProduktName}
            autoCapitalize="sentences"
          />
          <Feld
            id={mengeId}
            etikett="Menge"
            name="menge"
            wert={gebinde}
            aendere={setGebinde}
            eigenesFeld={erstesFeld}
            platzhalter="z. B. 500 g"
            hinweis="So wie am Etikett: 250 g, 1,5 l oder 6 Stk."
            autoCapitalize="none"
          />
        </div>
      ) : (
        <>
          <input type="hidden" name="name" value={name} />
          <input type="hidden" name="menge" value={menge} />
          <p className="text-[0.9375rem] leading-snug font-medium break-words">
            {name}
            <span className="font-normal text-gedaempft">
              {marke ? ` · ${marke}` : ""} · {menge}
            </span>
          </p>
        </>
      )}

      <KettenWahl ketten={ketten} empfohleneKette={empfohleneKette} />

      {empfohlen ? (
        <p className="-mt-2 text-[0.8125rem] leading-relaxed text-gedaempft">
          Vorgeschlagen: {empfohlen.name} — dort ist dieser Artikel heute am günstigsten.
        </p>
      ) : null}

      <Feld
        id={preisId}
        etikett="Preis"
        name="preis"
        wert={preis}
        aendere={setPreis}
        eigenesFeld={freitext ? undefined : erstesFeld}
        platzhalter="z. B. 2,49"
        // Am Handy die Ziffernblock-Tastatur mit Komma. `type="number"` wäre
        // falsch: Es kennt in vielen Browsern nur den Punkt als Trennzeichen.
        inputMode="decimal"
        nachsilbe="€"
      />

      {ergebnis?.art === "fehler" ? (
        <p role="alert" className="text-[0.8125rem] leading-relaxed text-fehler">
          {ergebnis.meldung}
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <Schaltflaeche type="submit" variante="haupt" laedt={laeuft}>
          Speichern
        </Schaltflaeche>

        {/*
          Der stille Ausweg, wie beim Strichcode-Vorschlag: Wer versehentlich
          auf „Abhaken" getippt hat, käme sonst nur heraus, indem er einen
          Preis erfindet. Bewusst klein und ohne Fläche — er ist der seltenere
          Weg, aber er muss dastehen.
        */}
        <button
          type="button"
          onClick={onAbbrechen}
          disabled={laeuft}
          className={
            "min-h-11 self-start text-[0.8125rem] text-gedaempft underline underline-offset-4 " +
            "transition-colors duration-150 ease-ruhig hover:text-vordergrund " +
            "disabled:cursor-not-allowed disabled:opacity-55"
          }
        >
          Abbrechen
        </button>
      </div>
    </form>
  );
}

/**
 * Die Kette, als antippbare Felder statt als Klappliste.
 *
 * Dieselbe Gestalt wie `Auswahl` im Erfassungsformular, aber bewusst eine
 * eigene Fassung: Dort wird die Wahl in React gehalten, weil das Formular sie
 * über mehrere Preise hinweg stehen lässt; hier lebt das Formular nur so
 * lange wie ein einziger Artikel, und der Vorschlag des Optimierers ist
 * schlicht die Vorbelegung. Eine gemeinsame Komponente müsste beide Modelle
 * tragen und wäre an keiner der beiden Stellen mehr zu lesen.
 *
 * `peer-checked:hover:bg-marke-hell` ist keine Zierde, sondern die Reparatur
 * eines Fehlers, den nur der Browser zeigt: `hover:bg-flaeche` und
 * `peer-checked:bg-marke` haben dieselbe Spezifität, Tailwind stellt `hover`
 * dahinter, und das gewählte Feld wäre unter dem Zeiger nahezu weiß auf
 * nahezu weiß. Wer diese Zeile hier streicht, holt den Fehler zurück — die
 * Begründung in voller Länge steht bei `Auswahl`.
 */
function KettenWahl({
  ketten,
  empfohleneKette,
}: {
  ketten: Kette[];
  empfohleneKette: string | null;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-[0.75rem] font-semibold tracking-[0.1em] text-gedaempft uppercase">
        Kette
      </legend>

      <div className="flex flex-wrap gap-2">
        {ketten.map((kette) => (
          <label key={kette.id} className="grow basis-20 cursor-pointer">
            <input
              type="radio"
              name="kette"
              value={kette.kuerzel}
              defaultChecked={kette.kuerzel === empfohleneKette}
              required
              className="peer sr-only"
            />
            <span
              className={
                "flex min-h-11 items-center justify-center rounded-klein border px-3 " +
                "border-linie-stark bg-hintergrund text-[0.9375rem] font-medium text-vordergrund " +
                "transition-colors duration-150 ease-ruhig hover:bg-flaeche " +
                "peer-checked:border-marke peer-checked:bg-marke peer-checked:text-auf-marke " +
                "peer-checked:hover:bg-marke-hell " +
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-marke"
              }
            >
              {kette.name}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Ein Pflichtfeld mit sichtbarer Beschriftung.
 *
 * Alle Felder hier sind `required`: Das nimmt dem Server die Runde für eine
 * Eingabe ab, die er ohnehin abweisen müsste, und der Browser stellt den Fokus
 * selbst in das leere Feld. Beanstandet wird ausschließlich beim Absenden —
 * ein Feld, das beim Tippen rot wird, erzieht dazu, Meldungen zu übersehen.
 */
function Feld({
  id,
  etikett,
  name,
  wert,
  aendere,
  eigenesFeld,
  platzhalter,
  hinweis,
  nachsilbe,
  inputMode,
  autoCapitalize,
}: {
  id: string;
  etikett: string;
  name: string;
  wert: string;
  aendere: (wert: string) => void;
  eigenesFeld?: RefObject<HTMLInputElement | null>;
  platzhalter?: string;
  hinweis?: string;
  nachsilbe?: string;
  inputMode?: "text" | "decimal";
  autoCapitalize?: "none" | "sentences";
}) {
  const hinweisId = useId();

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {etikett}
      </label>

      <div className="relative">
        <input
          id={id}
          ref={eigenesFeld}
          name={name}
          type="text"
          value={wert}
          onChange={(vorgang) => aendere(vorgang.target.value)}
          required
          placeholder={platzhalter}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize={autoCapitalize}
          inputMode={inputMode}
          aria-describedby={hinweis ? hinweisId : undefined}
          className={
            "min-h-14 w-full rounded-klein border border-linie-stark bg-hintergrund px-3.5 " +
            // 16 px sind die Untergrenze, ab der iOS beim Hineintippen nicht
            // mehr in das Feld hineinzoomt. Darunter verrutscht die ganze Seite.
            "text-base placeholder:text-gedaempft " +
            (nachsilbe ? "pr-9" : "")
          }
        />
        {nachsilbe ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-base text-gedaempft"
          >
            {nachsilbe}
          </span>
        ) : null}
      </div>

      {hinweis ? (
        <p id={hinweisId} className="text-[0.8125rem] leading-snug text-gedaempft">
          {hinweis}
        </p>
      ) : null}
    </div>
  );
}

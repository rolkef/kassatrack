"use client";

import { useActionState, useId, useRef, useState, type ReactNode } from "react";
import { Schaltflaeche } from "@/components/ui/schaltflaeche";
import { formatiereGrundpreis, grundpreis, zerlegeMenge, zerlegePreis } from "@/lib/einheiten";
import type { Kette } from "@/lib/katalog";
import { PREISARTEN, type ErfassungsAktion, type Ergebnis } from "./zustand";

/**
 * Preise eintragen — vor dem Regal, einhändig, mehrere hintereinander.
 *
 * Drei Entscheidungen tragen diesen Bildschirm:
 *
 * **Der Grundpreis steht vor dem Speichern da.** Er wird beim Tippen
 * ausgerechnet und sitzt unmittelbar unter den beiden Feldern, aus denen er
 * entsteht. Er ist der Grund, warum jemand überhaupt tippt: 2,49 € sagt nichts,
 * 9,96 €/kg sagt alles. Nach dem Speichern verschwindet er nicht, sondern
 * wechselt an derselben Stelle in die Bestätigung.
 *
 * **Die Kette bleibt gewählt.** Ein Einkauf heißt mehrere Preise hintereinander.
 * Bliebe die Kette nicht stehen, kostete jedes weitere Produkt denselben Griff
 * noch einmal. Die Preisart wird dagegen zurückgesetzt: Eine hängengebliebene
 * Aktion machte aus dem nächsten Regalpreis stillschweigend einen
 * Aktionspreis — und der zählt beim Referenzpreis nicht mit. Der Fehler wäre
 * unsichtbar und die Preismatrix bliebe leer.
 *
 * **Auswahl statt Klappliste.** Fünf Ketten und vier Preisarten als Felder, die
 * man antippt. Eine Klappliste kostet am Handy drei Gesten (öffnen, drehen,
 * bestätigen) statt einer und verbirgt zudem, was zur Wahl steht.
 */

/** Ein bereits gespeicherter Preis dieses Einkaufs. */
type Erfasst = {
  id: number;
  name: string;
  marke: string;
  menge: string;
  preis: string;
  kette: string;
  preisart: string;
  grundpreis: string;
};

export function ErfassungsFormular({
  ketten,
  aktion,
}: {
  ketten: Kette[];
  aktion: ErfassungsAktion;
}) {
  const [kette, setKette] = useState("");
  const [name, setName] = useState("");
  const [marke, setMarke] = useState("");
  const [menge, setMenge] = useState("");
  const [preis, setPreis] = useState("");
  const [preisart, setPreisart] = useState<string>("NORMAL");
  const [gueltigBis, setGueltigBis] = useState("");

  /*
   * Beanstandet wird erst beim Verlassen des Feldes. Beim Tippen wäre jede
   * Meldung falsch: „2" ist auf dem Weg zu „250 g" zwangsläufig unvollständig,
   * und ein Feld, das während der Eingabe rot blinkt, erzieht dazu, Meldungen
   * zu übersehen.
   */
  const [mengeBeruehrt, setMengeBeruehrt] = useState(false);
  const [preisBeruehrt, setPreisBeruehrt] = useState(false);

  const [erfasst, setErfasst] = useState<Erfasst[]>([]);
  const laufendeNummer = useRef(0);

  /*
   * Zählt **jeden** abgeschlossenen Versuch, nicht nur die gelungenen — siehe
   * die Begründung am `key` der Auswahl weiter unten. Ein Zähler, der nur bei
   * Erfolg weiterspringt, hätte die Kette nach einer Abweisung stehen lassen
   * müssen und tat es nicht.
   */
  const [versuche, setVersuche] = useState(0);

  const [ergebnis, absenden, laeuft] = useActionState<Ergebnis | undefined, FormData>(
    async (vorher, formular) => {
      const antwort = await aktion(vorher, formular);
      setVersuche((bisher) => bisher + 1);
      if (antwort.art !== "erfolg") return antwort;

      /*
       * Die Zeile entsteht aus dem abgeschickten Formular, nicht aus dem
       * Zustand: Der wird gleich darunter geleert, und ein Verweis darauf
       * lieferte je nach Reihenfolge eine leere Zeile.
       */
      laufendeNummer.current += 1;
      setErfasst((bisher) => [
        {
          id: laufendeNummer.current,
          name: String(formular.get("name") ?? "").trim(),
          marke: String(formular.get("marke") ?? "").trim(),
          menge: String(formular.get("menge") ?? "").trim(),
          preis: String(formular.get("preis") ?? "").trim(),
          kette: benenneKette(ketten, String(formular.get("kette") ?? "")),
          preisart: String(formular.get("preisart") ?? "NORMAL"),
          // Der Wert aus der Antwort, nicht der gerade angezeigte: Erst dieser
          // steht auch wirklich in der Datenbank.
          grundpreis: antwort.grundpreis,
        },
        ...bisher,
      ]);

      setName("");
      setMarke("");
      setMenge("");
      setPreis("");
      setPreisart("NORMAL");
      setGueltigBis("");
      setMengeBeruehrt(false);
      setPreisBeruehrt(false);

      return antwort;
    },
    undefined,
  );

  const mengeZerlegt = zerlegeMenge(menge);
  const preisZerlegt = zerlegePreis(preis);
  const liveWert = mengeZerlegt && preisZerlegt !== null ? grundpreis(preisZerlegt, mengeZerlegt) : null;
  const live =
    liveWert !== null && mengeZerlegt ? formatiereGrundpreis(liveWert, mengeZerlegt.einheit) : null;

  const zuletzt = erfasst[0];

  return (
    <div className="flex flex-col gap-10">
      <form action={absenden} className="flex flex-col gap-7">
        {/*
          Der `key` ist keine Zierde: React setzt ein Formular nach einer
          abgeschlossenen Aktion selbst zurück, und ein `reset` schaltet
          Optionsfelder auf den Stand des ursprünglichen Markups — also auf
          „nichts gewählt". Der Zustand hier sagt weiterhin „Spar", React sieht
          keine Änderung und zeichnet nicht neu; sichtbar bliebe eine leere
          Auswahl über einer Kette, die sehr wohl noch gilt.

          Gezählt werden **alle** Versuche, nicht nur die gelungenen. Das ist im
          Browser aufgefallen: Nach einer abgewiesenen Eingabe verschwand die
          Kette aus der Auswahl, und der zweite Versuch schickte gar keine mehr
          mit — man bekam „Wähl die Kette" für eine Kette, die man gewählt
          hatte, und kam aus der Schleife nicht mehr heraus.
        */}
        <Auswahl
          key={`kette-${versuche}`}
          titel="Kette"
          name="kette"
          optionen={ketten.map((eintrag) => ({ wert: eintrag.kuerzel, name: eintrag.name }))}
          gewaehlt={kette}
          aendere={setKette}
          breite="basis-24"
        />

        {/*
          Alle Platzhalter beginnen mit „z. B." — nachgemessen im Browser, und
          zwar aus einem Grund: Nach dem Speichern stehen die Felder wieder
          leer, und ein Platzhalter „Kärntnermilch" war vom eingetippten
          „Kärntnermilch" nur an der Textfarbe zu unterscheiden. Man liest ein
          gefülltes Formular, wo ein leeres steht, und speichert dasselbe
          Produkt ein zweites Mal.
        */}
        <div className="flex flex-col gap-4">
          <Feld
            etikett="Produkt"
            name="name"
            wert={name}
            aendere={setName}
            required
            platzhalter="z. B. Butter"
            autoCapitalize="sentences"
          />
          <Feld
            etikett="Marke"
            zusatz="optional"
            name="marke"
            wert={marke}
            aendere={setMarke}
            platzhalter="z. B. Kärntnermilch"
            autoCapitalize="sentences"
          />

          {/*
            Menge und Preis stehen nebeneinander, weil sie zusammen genau eine
            Frage beantworten — und weil die Antwort darauf direkt darunter
            steht. Getrennt untereinander wäre der Zusammenhang eine Behauptung
            statt einer Anordnung.
          */}
          <div className="grid grid-cols-2 gap-3">
            <Feld
              etikett="Menge"
              name="menge"
              wert={menge}
              aendere={(wert) => {
                setMenge(wert);
                if (zerlegeMenge(wert)) setMengeBeruehrt(false);
              }}
              beiVerlassen={() => setMengeBeruehrt(true)}
              fehler={
                mengeBeruehrt && menge.trim() !== "" && !mengeZerlegt
                  ? // Geschützte Leerzeichen zwischen Zahl und Einheit: Im
                    // schmalen Feld unter dem Handy-Layout brach die Zeile
                    // sonst mitten in „1,5 l" um — nachgemessen im Browser.
                    "So wie am Etikett: 250 g, 1,5 l oder 6 Stk."
                  : null
              }
              required
              platzhalter="z. B. 250 g"
              autoCapitalize="none"
              inputMode="text"
            />
            <Feld
              etikett="Preis"
              name="preis"
              wert={preis}
              aendere={(wert) => {
                setPreis(wert);
                if (zerlegePreis(wert) !== null) setPreisBeruehrt(false);
              }}
              beiVerlassen={() => setPreisBeruehrt(true)}
              fehler={
                preisBeruehrt && preis.trim() !== "" && preisZerlegt === null
                  ? "Ein Betrag über null, höchstens zwei Kommastellen."
                  : null
              }
              required
              platzhalter="z. B. 2,49"
              // Am Handy die Ziffernblock-Tastatur mit Komma, nicht die
              // Schreibtastatur. `type="number"` wäre falsch: Es kennt in
              // vielen Browsern nur den Punkt als Trennzeichen und wirft dem
              // Feld Pfeiltasten-Steppertasten dazu, die hier nichts sollen.
              inputMode="decimal"
              nachsilbe="€"
            />
          </div>

          <GrundpreisAnzeige live={live} menge={menge} preis={preis} zuletzt={zuletzt} />
        </div>

        <div className="flex flex-col gap-4">
          {/* Aus demselben Grund wie oben — hier zeigte sich sonst nach dem
              Speichern keine Preisart, obwohl wieder „Normal" gilt. */}
          <Auswahl
            key={`preisart-${versuche}`}
            titel="Preisart"
            name="preisart"
            optionen={PREISARTEN.map((eintrag) => ({ wert: eintrag.wert, name: eintrag.name }))}
            gewaehlt={preisart}
            aendere={setPreisart}
            breite="basis-28"
          />

          {/*
            Nur bei einer Aktion sichtbar — und dann Pflicht. Eine Aktion ohne
            Ende ist keine Aktion, sondern der neue Normalpreis; die Datenbank
            besteht seit Task 4 darauf, und dieses Feld sorgt dafür, dass man
            das vorher liest statt hinterher als technischen Fehler.
          */}
          {preisart === "PROMO" ? (
            <div data-auftritt className="animate-auftritt">
              <Feld
                etikett="Gültig bis"
                name="gueltigBis"
                typ="date"
                wert={gueltigBis}
                aendere={setGueltigBis}
                required
                hinweis="Bis wann gilt der Aktionspreis? Danach zählt wieder der Normalpreis."
              />
            </div>
          ) : null}
        </div>

        {ergebnis?.art === "fehler" ? (
          <p role="alert" className="text-[0.9375rem] leading-relaxed text-fehler">
            {ergebnis.meldung}
          </p>
        ) : null}

        <Schaltflaeche type="submit" laedt={laeuft}>
          Preis speichern
        </Schaltflaeche>
      </form>

      {erfasst.length > 0 ? <ErfasstListe eintraege={erfasst} /> : null}
    </div>
  );
}

/**
 * Die Mitte dieses Bildschirms, in drei Lagen.
 *
 * Die Fläche behält ihre Höhe über alle drei, damit beim Tippen nichts
 * springt — der Grundpreis erscheint an der Stelle, an der vorher stand, dass
 * er dort erscheinen wird.
 *
 * `role="status"` statt einer stummen Anzeige: Wer die Seite hört, bekommt den
 * ausgerechneten Grundpreis mit, ohne ihn zu suchen.
 */
function GrundpreisAnzeige({
  live,
  menge,
  preis,
  zuletzt,
}: {
  live: string | null;
  menge: string;
  preis: string;
  zuletzt: Erfasst | undefined;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[7.75rem] flex-col justify-center gap-1.5 rounded-block bg-flaeche px-5 py-4"
    >
      {live ? (
        <>
          <Eyebrow>Grundpreis</Eyebrow>
          <p className="zahlen text-[clamp(1.75rem,8vw,2.375rem)] leading-none tracking-[-0.055em] text-marke">
            {live}
          </p>
          <p className="text-[0.8125rem] text-gedaempft">
            {preis.trim()} € für {menge.trim()}
          </p>
        </>
      ) : zuletzt ? (
        <>
          <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-erfolg">
            <Haken />
            {zuletzt.name} bei {zuletzt.kette} gespeichert
          </p>
          <p className="zahlen text-[clamp(1.75rem,8vw,2.375rem)] leading-none tracking-[-0.055em] text-marke">
            {zuletzt.grundpreis}
          </p>
          <p className="text-[0.8125rem] text-gedaempft">
            {/*
              Genau einmal, beim ersten gespeicherten Preis: Danach weiß man es.
              Ein Satz, der bei jedem Speichern wiederkäme, wäre Rauschen.
            */}
            {zuletzt.id === 1
              ? "Die Kette bleibt gewählt — das nächste Produkt desselben Einkaufs kostet nur noch drei Felder."
              : `${zuletzt.menge} für ${zuletzt.preis} €`}
          </p>
        </>
      ) : (
        <>
          <Eyebrow>Grundpreis</Eyebrow>
          <p aria-hidden="true" className="zahlen text-[2.375rem] leading-none text-linie-stark">
            —
          </p>
          <p className="text-[0.8125rem] leading-relaxed text-gedaempft">
            Sobald Menge und Preis dastehen, rechnet KassaTrack hier den Preis je Kilo, Liter oder
            Stück aus.
          </p>
        </>
      )}
    </div>
  );
}

/** Was in dieser Runde schon erfasst ist — das Jüngste zuoberst. */
function ErfasstListe({ eintraege }: { eintraege: Erfasst[] }) {
  const titelId = useId();

  return (
    <section aria-labelledby={titelId} className="flex flex-col gap-3">
      <h2
        id={titelId}
        className="flex items-baseline gap-2 text-[0.8125rem] font-semibold tracking-[0.08em] text-gedaempft uppercase"
      >
        Erfasst
        <span className="zahlen text-xs font-normal">{eintraege.length}</span>
      </h2>

      <ul aria-labelledby={titelId} className="flex flex-col divide-y divide-linie">
        {eintraege.map((eintrag) => (
          <li
            key={eintrag.id}
            data-auftritt
            className="flex animate-auftritt items-baseline justify-between gap-4 py-3"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[0.9375rem] font-medium break-words">
                {eintrag.name}
                {eintrag.marke ? (
                  <span className="font-normal text-gedaempft"> · {eintrag.marke}</span>
                ) : null}
              </span>
              <span className="text-xs text-gedaempft">
                {eintrag.menge} bei {eintrag.kette} · {eintrag.preis} €
                {eintrag.preisart === "NORMAL" ? "" : ` · ${benennePreisart(eintrag.preisart)}`}
              </span>
            </span>
            <span className="zahlen shrink-0 text-[0.9375rem] text-marke">{eintrag.grundpreis}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Eine Auswahl aus wenigen festen Möglichkeiten, als antippbare Felder.
 *
 * Technisch eine Gruppe von Optionsfeldern: Pfeiltasten wandern darin, die
 * Tabulatortaste springt zur nächsten Gruppe, und Hilfstechnik liest „1 von 5".
 * Das eigentliche Optionsfeld liegt unsichtbar unter dem Feld — deshalb trägt
 * das Feld den Fokusring ausdrücklich selbst (`peer-focus-visible`), sonst
 * läge er auf einem Element, das niemand sieht.
 */
function Auswahl({
  titel,
  name,
  optionen,
  gewaehlt,
  aendere,
  breite,
}: {
  titel: string;
  name: string;
  optionen: { wert: string; name: string }[];
  gewaehlt: string;
  aendere: (wert: string) => void;
  breite: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2.5 text-[0.8125rem] font-semibold tracking-[0.08em] text-gedaempft uppercase">
        {titel}
      </legend>

      <div className="flex flex-wrap gap-2">
        {optionen.map((option) => (
          <label key={option.wert} className={`grow ${breite} cursor-pointer`}>
            <input
              type="radio"
              name={name}
              value={option.wert}
              checked={gewaehlt === option.wert}
              onChange={() => aendere(option.wert)}
              required
              className="peer sr-only"
            />
            <span
              className={
                "flex min-h-12 items-center justify-center rounded-klein border px-3 " +
                "border-linie-stark bg-hintergrund text-[0.9375rem] font-medium text-vordergrund " +
                "transition-colors duration-150 ease-ruhig hover:bg-flaeche " +
                "peer-checked:border-marke peer-checked:bg-marke peer-checked:text-auf-marke " +
                /*
                 * Diese Zeile ist nicht überflüssig, sondern die Reparatur eines
                 * Fehlers, den nur der Browser gezeigt hat: `hover:bg-flaeche`
                 * und `peer-checked:bg-marke` haben dieselbe Spezifität, und
                 * Tailwind stellt `hover` dahinter. Auf einem gewählten Feld
                 * gewann also die helle Hover-Fläche, während die Schrift bei
                 * `text-auf-marke` blieb — nahezu Weiß auf nahezu Weiß. Am
                 * Schreibtisch liegt der Zeiger nach dem Klick genau dort, das
                 * gewählte Feld war damit im Regelfall unlesbar. Kein Test
                 * konnte das sehen: Es gibt kein Hover ohne Zeiger.
                 */
                "peer-checked:hover:bg-marke-hell " +
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-marke"
              }
            >
              {option.name}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Ein Eingabefeld mit sichtbarem Etikett, optionalem Hinweis und Beanstandung. */
function Feld({
  etikett,
  zusatz,
  name,
  typ = "text",
  wert,
  aendere,
  beiVerlassen,
  fehler = null,
  hinweis,
  platzhalter,
  nachsilbe,
  required = false,
  autoCapitalize,
  inputMode,
}: {
  etikett: string;
  zusatz?: string;
  name: string;
  typ?: "text" | "date";
  wert: string;
  aendere: (wert: string) => void;
  beiVerlassen?: () => void;
  fehler?: string | null;
  hinweis?: string;
  platzhalter?: string;
  nachsilbe?: string;
  required?: boolean;
  autoCapitalize?: "none" | "sentences";
  inputMode?: "text" | "decimal";
}) {
  const feldId = useId();
  const meldungId = useId();

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={feldId} className="text-sm font-medium">
        {etikett}
        {zusatz ? <span className="font-normal text-gedaempft"> — {zusatz}</span> : null}
      </label>

      <div className="relative">
        <input
          id={feldId}
          name={name}
          type={typ}
          value={wert}
          onChange={(vorgang) => aendere(vorgang.target.value)}
          onBlur={beiVerlassen}
          required={required}
          placeholder={platzhalter}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize={autoCapitalize}
          inputMode={inputMode}
          aria-invalid={fehler ? true : undefined}
          aria-describedby={fehler || hinweis ? meldungId : undefined}
          className={
            "min-h-14 w-full rounded-klein border border-linie-stark bg-hintergrund px-3.5 " +
            // 16 px sind die Untergrenze, ab der iOS beim Hineintippen nicht
            // mehr in das Feld hineinzoomt. Darunter verrutscht die ganze Seite.
            "text-base placeholder:text-gedaempft aria-[invalid=true]:border-fehler " +
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

      {fehler ? (
        <p id={meldungId} className="text-[0.8125rem] leading-snug text-fehler">
          {fehler}
        </p>
      ) : hinweis ? (
        <p id={meldungId} className="text-[0.8125rem] leading-snug text-gedaempft">
          {hinweis}
        </p>
      ) : null}
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[0.75rem] font-semibold tracking-[0.1em] text-gedaempft uppercase">
      {children}
    </p>
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

function benenneKette(ketten: Kette[], kuerzel: string): string {
  return ketten.find((eintrag) => eintrag.kuerzel === kuerzel)?.name ?? kuerzel;
}

function benennePreisart(wert: string): string {
  return PREISARTEN.find((eintrag) => eintrag.wert === wert)?.name ?? wert;
}

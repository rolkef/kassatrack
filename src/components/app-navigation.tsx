"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type Ziel = {
  href: string;
  name: string;
  Symbol: ({ aktiv }: { aktiv: boolean }) => React.ReactNode;
};

const ZIELE: Ziel[] = [
  { href: "/erfassen", name: "Erfassen", Symbol: SymbolErfassen },
  { href: "/produkte", name: "Produkte", Symbol: SymbolProdukte },
];

const ZUGRIFF: Ziel = { href: "/verwaltung/zugriff", name: "Zugriff", Symbol: SymbolZugriff };

/**
 * Der Anschluss an den Router — die einzige Zeile, die einen braucht.
 *
 * Der aktuelle Pfad wird an `Navigationsleiste` weitergereicht statt dort
 * geholt: So kommt der Test ohne eine Attrappe für `next/navigation` aus.
 * `mock.module` gilt in Bun für den ganzen Lauf, und eine Attrappe für dieses
 * Modul nähme `tests/sitzung.test.ts` das echte `redirect` weg — derselbe
 * Fallstrick, aus dem die Aktionen in dieser App hereingereicht werden.
 */
export function AppNavigation({ darfVerwalten }: { darfVerwalten: boolean }) {
  return <Navigationsleiste pfad={usePathname()} darfVerwalten={darfVerwalten} />;
}

/**
 * Die Hauptbereiche der App — unten am Handy, oben am Schreibtisch.
 *
 * Die Leiste wechselt die Seite, nicht die Gestalt: dieselben Ziele, dieselbe
 * Schrift, dieselbe Marke. Am Handy sitzt sie unten, weil dort der Daumen ist,
 * und liegt fest über dem Inhalt — im Geschäft wird gescrollt und gewechselt,
 * ohne nach oben zu greifen. Ab `sm` klebt dieselbe Leiste oben, weil am
 * Schreibtisch der Blick oben anfängt und die Maus keinen Daumenbogen hat.
 *
 * **Der aktive Bereich ist an vier Dingen zu erkennen, von denen nur eines die
 * Farbe ist:** dem Balken an der Kante, dem gefüllten statt umrissenen Symbol,
 * der kräftigeren Schrift und `aria-current`. Die Marke gegen Gedämpft ist ein
 * Helligkeits- und ein Buntheitsunterschied zugleich — wer Farben schlecht
 * unterscheidet, hat trotzdem drei Merkmale übrig, und Hilfstechnik liest das
 * vierte. Eine bloße Umfärbung wäre für einen Teil der Leute gar kein Hinweis.
 *
 * Der Balken sitzt bewusst an der Kante zum Inhalt: am Handy oben an der
 * Leiste, am Desktop unten. So zeigt er auf das, was er betrifft.
 */
export function Navigationsleiste({
  pfad,
  darfVerwalten,
}: {
  pfad: string;
  darfVerwalten: boolean;
}) {
  const ziele = darfVerwalten ? [...ZIELE, ZUGRIFF] : ZIELE;

  /*
   * Auch die Unterseite zählt zum Bereich: Auf `/produkte/<id>` muss „Produkte"
   * aktiv bleiben, sonst zeigt die Leiste auf der Detailseite nirgendwohin und
   * man glaubt, man sei aus dem Bereich herausgefallen.
   */
  const istAktiv = (href: string) => pfad === href || pfad.startsWith(`${href}/`);

  return (
    <>
      {/*
        Am Handy ist die Wortmarke der einzige Weg zurück zur Startseite: Die
        Leiste unten führt in die drei Arbeitsbereiche, und als installierte PWA
        gibt es keine Zurück-Schaltfläche des Browsers. Sie scrollt bewusst mit
        und klebt nicht — die feste Leiste unten ist schon Platz genug.
      */}
      <div className="mx-auto flex w-full max-w-xl px-5 pt-[env(safe-area-inset-top)] sm:hidden">
        <Wortmarke aktuell={pfad === "/"} />
      </div>

      <nav
        aria-label="Hauptbereiche"
        className={
          "z-40 border-t border-linie bg-hintergrund " +
          "fixed inset-x-0 bottom-0 pb-[env(safe-area-inset-bottom)] " +
          "sm:sticky sm:top-0 sm:bottom-auto sm:border-t-0 sm:border-b sm:pb-0"
        }
      >
        <div className="mx-auto flex w-full max-w-xl items-center px-2 sm:px-8">
          <span className="hidden sm:flex">
            <Wortmarke aktuell={pfad === "/"} />
          </span>

          <ul className="flex flex-1 items-stretch sm:ml-auto sm:flex-none sm:items-center sm:gap-1">
            {ziele.map(({ href, name, Symbol }) => {
              const aktiv = istAktiv(href);

              return (
                <li key={href} className="flex flex-1 sm:flex-none">
                  <Link
                    href={href}
                    aria-current={aktiv ? "page" : undefined}
                    className={cn(
                      // `min-h-14` am Handy, `sm:min-h-12` am Desktop: beides
                      // über der Daumengrenze, oben aber ohne die Wucht einer
                      // Werkzeugleiste.
                      "relative flex min-h-14 w-full flex-col items-center justify-center gap-1 px-2",
                      "text-xs transition-colors duration-150 ease-ruhig",
                      "sm:min-h-12 sm:flex-row sm:gap-2 sm:px-3 sm:text-[0.9375rem]",
                      aktiv
                        ? "font-semibold text-marke"
                        : "font-medium text-gedaempft hover:text-vordergrund",
                    )}
                  >
                    {aktiv ? (
                      <span
                        aria-hidden="true"
                        className={
                          "absolute inset-x-2 top-0 h-0.5 rounded-full bg-marke " +
                          "sm:inset-x-0 sm:top-auto sm:bottom-0"
                        }
                      />
                    ) : null}
                    <Symbol aktiv={aktiv} />
                    {name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </>
  );
}

function Wortmarke({ aktuell }: { aktuell: boolean }) {
  return (
    <Link
      href="/"
      aria-current={aktuell ? "page" : undefined}
      className={
        "flex min-h-12 items-center font-anzeige text-[1.0625rem] font-semibold " +
        "tracking-[-0.03em] text-marke"
      }
    >
      KassaTrack
    </Link>
  );
}

/**
 * Die drei Symbole, von Hand gezeichnet statt aus einer Bibliothek.
 *
 * Sie teilen Maß und Strich mit dem Pfeil der Trefferliste (16er-Feld, 1,75
 * Strichstärke, runde Enden), damit die Leiste nicht wie ein zugekauftes Teil
 * wirkt. Der aktive Zustand füllt die Fläche und stanzt die Binnenform in der
 * Papierfarbe aus — eine Silhouette, die sich auch in Graustufen von der
 * Umrissfassung unterscheidet.
 */
function Rahmen({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-5 shrink-0 sm:size-[1.125rem]">
      {children}
    </svg>
  );
}

function SymbolErfassen({ aktiv }: { aktiv: boolean }) {
  return (
    <Rahmen>
      <circle
        cx="8"
        cy="8"
        r="5.75"
        fill={aktiv ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M8 5.5v5M5.5 8h5"
        fill="none"
        className={aktiv ? "stroke-hintergrund" : "stroke-current"}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </Rahmen>
  );
}

function SymbolProdukte({ aktiv }: { aktiv: boolean }) {
  return (
    <Rahmen>
      <circle
        cx="7"
        cy="7"
        r="4.25"
        fill={aktiv ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="m10.25 10.25 3.25 3.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </Rahmen>
  );
}

function SymbolZugriff({ aktiv }: { aktiv: boolean }) {
  return (
    <Rahmen>
      <circle
        cx="8"
        cy="5.25"
        r="2.5"
        fill={aktiv ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M3.25 13.5a4.75 4.75 0 0 1 9.5 0"
        fill={aktiv ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </Rahmen>
  );
}

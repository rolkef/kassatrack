import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Martian_Mono, Wix_Madefor_Text } from "next/font/google";
import { AppNavigation } from "@/components/app-navigation";
import { db } from "@/db";
import { PAPIER } from "@/lib/huelle";
import { holeSitzung } from "@/lib/sitzung";
import { cn } from "@/lib/utils";
import { istBetreiber } from "@/lib/zugriff";
import "./globals.css";

/*
 * next/font lädt die Dateien zur Bauzeit herunter und liefert sie unter
 * /_next/static aus. Das ist hier keine Bequemlichkeit, sondern Bedingung:
 * die CSP erlaubt `font-src 'self'`, ein Google-Fonts-CDN wäre blockiert.
 */

/*
 * `latin` genügt: ä, ö, ü und ß liegen darin. `latin-ext` deckt osteuropäische
 * Zeichen ab, die in dieser App nirgends vorkommen, und würde jede
 * vorgeladene Schrift unnötig vergrößern.
 */

/** Nur für den Namen und große Überschriften — sparsam, sonst wird sie laut. */
const anzeige = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--schrift-anzeige",
  display: "swap",
});

/** Alles Lesbare. Für Bildschirmtext gezeichnet, große x-Höhe, offene Punzen. */
const text = Wix_Madefor_Text({
  subsets: ["latin"],
  variable: "--schrift-text",
  display: "swap",
});

/** Preise und Mengen. Auf der Anmeldeseite ungenutzt, daher kein Preload. */
const zahlen = Martian_Mono({
  subsets: ["latin"],
  variable: "--schrift-zahlen",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "KassaTrack",
  description: "Preisverfolgung für den Lebensmitteleinkauf in Österreich",
  /*
   * iOS liest das Manifest nur teilweise. Ohne diesen Block startet die vom
   * Startbildschirm geöffnete App in Safari mit Adressleiste statt
   * eigenständig. `apple-icon.png` im selben Verzeichnis hängt Next von
   * selbst als Startbildschirm-Symbol ein.
   */
  appleWebApp: {
    capable: true,
    title: "KassaTrack",
    // "default" färbt die Statusleiste wie die Seite — hier also Papier.
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Damit env(safe-area-inset-*) unter der Home-Anzeige des iPhones greift.
  viewportFit: "cover",
  colorScheme: "light",
  // Muss mit `theme_color` im Manifest übereinstimmen, siehe `lib/huelle`.
  themeColor: PAPIER,
};

/*
 * Die Navigation steht hier und nicht in jeder Seite, weil sie über allen
 * Seiten liegt — und weil die Entscheidung, ob „Zugriff" überhaupt existiert,
 * auf den Server gehört.
 *
 * Bewusst `holeSitzung` und nicht `requireUser`: Dieses Layout umschließt auch
 * die Anmeldeseite. Ein `requireUser` würde dort auf `/anmelden` umleiten —
 * also auf sich selbst — und die Anmeldung in eine Endlosschleife schicken.
 * Ohne Sitzung gibt es keine Leiste, denn es gibt nichts zu navigieren.
 *
 * `darfVerwalten` wird hier ausgerechnet und nicht im Client geprüft: Wer nicht
 * betreibt, bekommt das Ziel gar nicht erst geschickt. Die eigentliche Sperre
 * sitzt weiterhin auf der Seite selbst und in ihren Server-Aktionen — diese
 * Zeile blendet aus, sie schützt nicht.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const sitzung = await holeSitzung();
  const darfVerwalten = sitzung ? await istBetreiber(db, sitzung.user.email) : false;

  return (
    <html
      lang="de-AT"
      className={`h-full antialiased ${anzeige.variable} ${text.variable} ${zahlen.variable}`}
    >
      <body
        className={cn(
          "flex min-h-full flex-col bg-hintergrund font-sans text-vordergrund",
          // Platz für die feste Leiste am unteren Rand — sonst verschwindet die
          // letzte Zeile jeder Seite dahinter. Nur wenn die Leiste da ist:
          // Sonst stünde die Anmeldeseite außermittig.
          sitzung && "pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0",
        )}
      >
        {sitzung ? <AppNavigation darfVerwalten={darfVerwalten} /> : null}
        {children}
      </body>
    </html>
  );
}

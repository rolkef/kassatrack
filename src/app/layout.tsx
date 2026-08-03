import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Martian_Mono, Wix_Madefor_Text } from "next/font/google";
import { PAPIER } from "@/lib/huelle";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de-AT"
      className={`h-full antialiased ${anzeige.variable} ${text.variable} ${zahlen.variable}`}
    >
      <body className="flex min-h-full flex-col bg-hintergrund font-sans text-vordergrund">
        {children}
      </body>
    </html>
  );
}

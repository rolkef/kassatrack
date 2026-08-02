import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Martian_Mono, Wix_Madefor_Text } from "next/font/google";
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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Damit env(safe-area-inset-*) unter der Home-Anzeige des iPhones greift.
  viewportFit: "cover",
  colorScheme: "light",
  themeColor: "#f7fbfb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      className={`h-full antialiased ${anzeige.variable} ${text.variable} ${zahlen.variable}`}
    >
      <body className="flex min-h-full flex-col bg-hintergrund font-sans text-vordergrund">
        {children}
      </body>
    </html>
  );
}

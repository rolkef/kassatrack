import type { MetadataRoute } from "next";
import { PAPIER } from "@/lib/huelle";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "KassaTrack",
    short_name: "KassaTrack",
    description: "Lebensmittelpreise vergleichen und den günstigsten Markt finden.",
    lang: "de-AT",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    /*
     * Splash-Screen und Statusleiste tragen dasselbe Papier wie jede Seite.
     * Petrol wäre die naheliegende Wahl — die Marke ist schließlich petrol —,
     * aber die App hat keine farbige Kopfleiste: ihre Seiten sind von oben bis
     * unten Papier. Eine petrolfarbene Statusleiste darüber sähe aus wie ein
     * Fehler, und der Start würde mit einem Farbwechsel beginnen.
     */
    background_color: PAPIER,
    theme_color: PAPIER,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      /*
       * Eigene Datei, nicht dieselbe wie oben: Android schneidet maskierbare
       * Icons auf einen Kreis zu. Wer hier das normale Icon einträgt, verliert
       * die Ecken des Motivs — beim Beleg wären das die Risskanten.
       */
      {
        src: "/icon-maskierbar-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

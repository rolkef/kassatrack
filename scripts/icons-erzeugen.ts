/*
 * Erzeugt die Icons der App aus einer einzigen Geometrie.
 *
 * Aufruf: `bun run icons`
 *
 * Warum ein Skript und keine abgelegte Bilddatei: ein PNG im Verzeichnis kann
 * niemand mehr ändern, ohne es neu zu zeichnen. Hier steht das Motiv als
 * Vektor mit benannten Maßen — wer die Zacken gröber oder den Balken kürzer
 * will, ändert eine Zahl und lässt neu rendern.
 *
 * ── Das Motiv ────────────────────────────────────────────────────────────
 *
 * Ein Kassabon: hochkant, oben und unten von der Rolle abgerissen, darauf zwei
 * Beträge — der obere lang, der untere kurz. Das ist die ganze App in einer
 * Form: derselbe Einkauf, und er ist billiger geworden.
 *
 * Der Bon ist gewählt, weil ihn sonst nichts hat. Ein Einkaufswagen steht auf
 * jedem Lebensmittel-Icon, eine steigende Kurve auf jedem Finanz-Icon — und
 * „steigend" wäre hier ohnehin die falsche Nachricht. Die abgerissene Kante
 * gehört keiner Kette und ist trotzdem sofort als Supermarkt lesbar.
 *
 * Farbe: Petrol als Grund, Papier als Beleg — beides Tokens der App, nicht neu
 * erfunden. Auf dem Startbildschirm liegt die Kachel neben Billa (rot/gelb),
 * Spar (grün) und Hofer (blau/orange). Sie fällt auf, indem sie als einzige
 * ruhig ist. Ein dunkler Grund trägt sich außerdem selbst: die Kachel liest
 * sich auf hellem wie auf dunklem Hintergrundbild gleich.
 *
 * ── Lesbarkeit bei 60 px ─────────────────────────────────────────────────
 *
 * Maßgeblich ist nicht die 512er-Ansicht, sondern die Kachel am Handy. Auf
 * 512 gerechnet, bei 60 px angezeigt (Faktor 0,117):
 *
 *   Beleg      288 × 360 →  33,7 × 42,2 px
 *   Balken     208 ×  44 →  24,4 ×  5,2 px
 *   kurz       120 ×  44 →  14,1 ×  5,2 px
 *   Abstand           44 →   5,2 px
 *   Zacke       48 ×  24 →   5,6 ×  2,8 px
 *
 * Alles über 2 px übersteht die Verkleinerung. Deshalb sechs grobe Zacken und
 * nicht zwanzig feine: zwanzig Zacken wären bei 60 px 1,4 px breit und würden
 * zu einem schmutzigen Rand verschmieren.
 */

import sharp from "sharp";
import { MARKE, PAPIER } from "../src/lib/huelle";

/** Alle Maße rechnen auf dieser Kante; die Ausgabegröße skaliert nur. */
const KACHEL = 512;

type Zuschnitt = {
  /** Streckt oder staucht das Motiv um die Kachelmitte. */
  skalierung: number;
  /** Zacken je Risskante. Weniger heißt gröber — und bei kleiner Größe lesbar. */
  zacken: number;
};

/* Grundmaße bei skalierung 1. */
const BELEG_BREITE = 288;
const BELEG_HOEHE = 360;
const RISS_TIEFE = 24;
const SEITEN_EINZUG = 40;
const BALKEN_HOEHE = 44;
const BALKEN_ABSTAND = 44;
/** Der untere Betrag misst gut die Hälfte des oberen — sichtbar weniger. */
const BALKEN_KURZ = 120;

/**
 * Der Umriss des Bons: senkrechte Seiten, oben und unten eine Zickzackkante.
 *
 * Beide Ecken einer Kante liegen im Tal, nie auf einer Spitze. Sonst stünde an
 * der Ecke ein spitzer Zipfel, der bei kleiner Größe abbricht.
 */
function belegUmriss(
  x: number,
  y: number,
  breite: number,
  hoehe: number,
  rissTiefe: number,
  zacken: number,
): string {
  const oben = y + rissTiefe;
  const unten = y + hoehe - rissTiefe;
  const zackenBreite = breite / zacken;
  const punkte = [`M ${x} ${oben}`];

  for (let i = 0; i < zacken; i++) {
    punkte.push(`L ${x + i * zackenBreite + zackenBreite / 2} ${y}`);
    punkte.push(`L ${x + (i + 1) * zackenBreite} ${oben}`);
  }

  punkte.push(`L ${x + breite} ${unten}`);

  for (let i = zacken - 1; i >= 0; i--) {
    punkte.push(`L ${x + i * zackenBreite + zackenBreite / 2} ${y + hoehe}`);
    punkte.push(`L ${x + i * zackenBreite} ${unten}`);
  }

  return `${punkte.join(" ")} Z`;
}

function svg(kante: number, { skalierung, zacken }: Zuschnitt): string {
  const breite = BELEG_BREITE * skalierung;
  const hoehe = BELEG_HOEHE * skalierung;
  const rissTiefe = RISS_TIEFE * skalierung;
  const x = (KACHEL - breite) / 2;
  const y = (KACHEL - hoehe) / 2;

  const balkenHoehe = BALKEN_HOEHE * skalierung;
  const balkenAbstand = BALKEN_ABSTAND * skalierung;
  const balkenX = x + SEITEN_EINZUG * skalierung;
  const balkenLang = breite - 2 * SEITEN_EINZUG * skalierung;
  const balkenKurz = BALKEN_KURZ * skalierung;

  /*
   * Die beiden Balken sitzen mittig im Belegkörper, nicht oben wie auf einem
   * echten Bon. Mittig gesetzt lesen sie sich als Vergleich zweier Beträge;
   * oben gesetzt sähen sie aus wie Textzeilen auf einem Dokument.
   */
  const mitte = KACHEL / 2;
  const balkenOben = mitte - balkenAbstand / 2 - balkenHoehe;
  const balkenUnten = mitte + balkenAbstand / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${kante}" height="${kante}" viewBox="0 0 ${KACHEL} ${KACHEL}">
  <rect width="${KACHEL}" height="${KACHEL}" fill="${MARKE}"/>
  <path d="${belegUmriss(x, y, breite, hoehe, rissTiefe, zacken)}" fill="${PAPIER}"/>
  <rect x="${balkenX}" y="${balkenOben}" width="${balkenLang}" height="${balkenHoehe}" rx="${balkenHoehe / 2}" fill="${MARKE}"/>
  <rect x="${balkenX}" y="${balkenUnten}" width="${balkenKurz}" height="${balkenHoehe}" rx="${balkenHoehe / 2}" fill="${MARKE}"/>
</svg>`;
}

/** Die Kachel, wie sie auf dem Startbildschirm und in der Lesezeichenleiste steht. */
const VOLL: Zuschnitt = { skalierung: 1, zacken: 6 };

/*
 * Android schneidet maskierbare Icons auf einen Kreis zu. Die Vorgabe sichert
 * einen Kreis von 80 % der Kante zu, einzelne Hersteller beschneiden aber
 * enger. Bei 0,72 misst die halbe Diagonale des Belegs 166 px — sie bleibt
 * damit auch im 66-%-Kreis (Radius 170 px) vollständig sichtbar.
 */
const MASKIERBAR: Zuschnitt = { skalierung: 0.72, zacken: 6 };

/*
 * Das Lesezeichen-Icon wird nicht beschnitten und darf deshalb die Kachel
 * voller ausfüllen. Vier statt sechs Zacken, weil bei 32 px sechs Zacken nur
 * noch 3 px breit wären.
 */
const KLEIN: Zuschnitt = { skalierung: 1.15, zacken: 4 };

async function png(kante: number, zuschnitt: Zuschnitt): Promise<Buffer> {
  return sharp(Buffer.from(svg(kante, zuschnitt))).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Packt PNG-Bilder in einen ICO-Behälter.
 *
 * ICO ist ein Verzeichnis fester Satzlänge: 6 Byte Kopf, dann je 16 Byte pro
 * Bild, dann die Bilddaten. Ein Kantenmaß von 256 wird als 0 notiert; hier
 * kommt das nicht vor. Seit Vista dürfen die Einträge PNG statt BMP sein.
 */
function ico(bilder: { kante: number; daten: Buffer }[]): Buffer {
  const kopf = Buffer.alloc(6);
  kopf.writeUInt16LE(0, 0); // reserviert
  kopf.writeUInt16LE(1, 2); // 1 = Icon
  kopf.writeUInt16LE(bilder.length, 4);

  let versatz = 6 + bilder.length * 16;
  const eintraege = bilder.map(({ kante, daten }) => {
    const eintrag = Buffer.alloc(16);
    eintrag.writeUInt8(kante, 0);
    eintrag.writeUInt8(kante, 1);
    eintrag.writeUInt8(0, 2); // Farbanzahl: 0 = mehr als 256
    eintrag.writeUInt8(0, 3); // reserviert
    eintrag.writeUInt16LE(1, 4); // Ebenen
    eintrag.writeUInt16LE(32, 6); // Bit je Bildpunkt
    eintrag.writeUInt32LE(daten.length, 8);
    eintrag.writeUInt32LE(versatz, 12);
    versatz += daten.length;
    return eintrag;
  });

  return Buffer.concat([kopf, ...eintraege, ...bilder.map((b) => b.daten)]);
}

const dateien: [string, number, Zuschnitt][] = [
  ["public/icon-192.png", 192, VOLL],
  ["public/icon-512.png", 512, VOLL],
  ["public/icon-maskierbar-512.png", 512, MASKIERBAR],
  // Von Next automatisch als <link rel="apple-touch-icon"> eingehängt.
  ["src/app/apple-icon.png", 180, VOLL],
];

for (const [pfad, kante, zuschnitt] of dateien) {
  await Bun.write(pfad, await png(kante, zuschnitt));
  console.log(`${pfad} — ${kante}×${kante}`);
}

await Bun.write(
  "src/app/favicon.ico",
  ico([
    { kante: 32, daten: await png(32, KLEIN) },
    { kante: 48, daten: await png(48, KLEIN) },
  ]),
);
console.log("src/app/favicon.ico — 32×32, 48×48");

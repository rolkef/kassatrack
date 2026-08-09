import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Der Schlüssel ist der Dateiname im Bildverzeichnis. Er entsteht aus der
 * EAN, weil eine EAN pro Definition genau ein Bild meint — ein zweiter Scan
 * derselben EAN muss denselben Schlüssel treffen, sonst würde jedes Mal neu
 * heruntergeladen.
 *
 * Die Prüfung auf Ziffern schließt Pfadtrennzeichen aus. Ohne sie könnte eine
 * verunstaltete EAN aus einem beschädigten Scan zu einem Pfad außerhalb des
 * Bildverzeichnisses führen.
 */
export function erzeugeBildSchluessel(ean: string): string {
  if (!/^\d+$/.test(ean)) {
    throw new Error(`Ungültige EAN für einen Bildschlüssel: ${ean}`);
  }
  return `${ean}.jpg`;
}

export function lesePfadZuBild(verzeichnis: string, schluessel: string): string {
  return join(verzeichnis, schluessel);
}

export async function schreibeBild(
  verzeichnis: string,
  schluessel: string,
  daten: Buffer,
): Promise<void> {
  const pfad = lesePfadZuBild(verzeichnis, schluessel);
  await mkdir(dirname(pfad), { recursive: true });
  await writeFile(pfad, daten);
}

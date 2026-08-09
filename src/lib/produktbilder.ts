import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { product } from "@/db/schema/katalog";
import { env } from "@/lib/env";
import type { DbOderTransaktion } from "@/lib/zugriff";

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

/**
 * Lädt ein Produktbild herunter, legt es im konfigurierten Verzeichnis ab
 * und trägt den Schlüssel im Produkt ein. Ein Fehlschlag — Netzwerk, HTTP-
 * Fehler, was auch immer — liefert `null` und lässt `bild_schluessel` leer,
 * statt die Erfassung zu blockieren: Ein fehlendes Bild ist kein Grund, eine
 * Preiserfassung abzuweisen.
 */
export async function ladeUndSpeichereBild(
  db: DbOderTransaktion,
  produktId: string,
  ean: string,
  bildUrl: string,
  abrufen: typeof fetch,
): Promise<string | null> {
  try {
    const antwort = await abrufen(bildUrl);
    if (!antwort.ok) return null;

    const bytes = Buffer.from(await antwort.arrayBuffer());
    const schluessel = erzeugeBildSchluessel(ean);
    await schreibeBild(env.PRODUKTBILDER_VERZEICHNIS, schluessel, bytes);

    await db.update(product).set({ bildSchluessel: schluessel }).where(eq(product.id, produktId));

    return schluessel;
  } catch {
    return null;
  }
}

import { readFile } from "node:fs/promises";
import { env } from "@/lib/env";
import { lesePfadZuBild } from "@/lib/produktbilder";

/**
 * Liefert ein zwischengespeichertes Produktbild aus. Kein `requireUser()`
 * — Produktbilder sind kein Preis- oder Kontodaten, dieselbe Einstufung wie
 * `/manifest.webmanifest` und die App-Icons.
 *
 * Der Schlüssel muss exakt einem `[0-9]+\.jpg`-Muster entsprechen. Ohne
 * diese Prüfung könnte ein Schlüssel mit `..`-Segmenten aus dem
 * Bildverzeichnis ausbrechen — derselbe Grund, aus dem `erzeugeBildSchluessel`
 * beim Schreiben schon auf Ziffern besteht.
 */
export async function GET(
  _anfrage: Request,
  { params }: { params: Promise<{ schluessel: string }> },
): Promise<Response> {
  const { schluessel } = await params;
  if (!/^\d+\.jpg$/.test(schluessel)) {
    return new Response("Ungültiger Bildschlüssel", { status: 400 });
  }

  try {
    const bytes = await readFile(lesePfadZuBild(env.PRODUKTBILDER_VERZEICHNIS, schluessel));
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Nicht gefunden", { status: 404 });
  }
}

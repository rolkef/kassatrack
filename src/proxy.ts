import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest): NextResponse {
  const token = Buffer.from(crypto.randomUUID()).toString("base64");
  const entwicklung = process.env.NODE_ENV === "development";

  const csp = `
    default-src 'self';
    script-src 'self' 'nonce-${token}' 'strict-dynamic'${entwicklung ? " 'unsafe-eval'" : ""};
    style-src 'self' 'nonce-${token}';
    img-src 'self' blob: data:;
    font-src 'self';
    connect-src 'self';
    worker-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `
    .replace(/\s{2,}/g, " ")
    .trim();

  /*
   * `worker-src` steht ausdrücklich da, obwohl `default-src 'self'` es scheinbar
   * schon abdeckt. Ohne die eigene Direktive prüft der Browser die Registrierung
   * eines Service Workers gegen `child-src` und dann gegen `script-src` — und
   * dort steht `'strict-dynamic'`, das jede Herkunftsangabe unwirksam macht,
   * `'self'` eingeschlossen. Die Registrierung schlüge fehl, sichtbar nur als
   * eine Zeile in der Browser-Konsole.
   */

  // Auch auf der ANFRAGE setzen: daran erkennt Next, dass es seine eigenen
  // Hydration-Skripte mit dem Token versehen soll.
  const anfrageKopf = new Headers(request.headers);
  anfrageKopf.set("x-nonce", token);
  anfrageKopf.set("content-security-policy", csp);

  const antwort = NextResponse.next({ request: { headers: anfrageKopf } });

  antwort.headers.set("content-security-policy", csp);
  antwort.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  antwort.headers.set("x-frame-options", "DENY");
  antwort.headers.set("x-content-type-options", "nosniff");
  antwort.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  antwort.headers.set("permissions-policy", "geolocation=(), microphone=(), camera=(self)");

  return antwort;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

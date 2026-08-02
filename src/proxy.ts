import { NextResponse, type NextRequest } from "next/server";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function proxy(_request: NextRequest): NextResponse {
  const antwort = NextResponse.next();

  antwort.headers.set("content-security-policy", CSP);
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

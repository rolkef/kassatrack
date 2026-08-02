import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

function anfrage(pfad: string): NextRequest {
  return new NextRequest(new URL(pfad, "https://kassatrack.example.at"));
}

describe("Sicherheits-Header", () => {
  it("setzt eine Content-Security-Policy", () => {
    const kopf = proxy(anfrage("/")).headers.get("content-security-policy");
    expect(kopf).toContain("default-src 'self'");
    expect(kopf).toContain("frame-ancestors 'none'");
  });

  it("setzt HSTS", () => {
    const kopf = proxy(anfrage("/")).headers.get("strict-transport-security");
    expect(kopf).toContain("max-age=");
  });

  it("verbietet das Einbetten in Frames", () => {
    expect(proxy(anfrage("/")).headers.get("x-frame-options")).toBe("DENY");
  });

  it("unterdrückt Referrer an fremde Ziele", () => {
    expect(proxy(anfrage("/")).headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("setzt die Header auch auf der Anmeldeseite", () => {
    expect(proxy(anfrage("/anmelden")).headers.get("x-frame-options")).toBe("DENY");
  });

  it("erlaubt keine beliebigen Inline-Skripte", () => {
    const kopf = proxy(anfrage("/")).headers.get("content-security-policy");
    expect(kopf).not.toContain("'unsafe-inline'");
  });

  it("vergibt pro Antwort ein frisches Einmal-Token", () => {
    const erste = proxy(anfrage("/")).headers.get("content-security-policy");
    const zweite = proxy(anfrage("/")).headers.get("content-security-policy");

    expect(erste).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(erste).not.toBe(zweite);
  });

  it("leitet das Nonce-Token an die Anfrage weiter, damit Next eigene Skripte markieren kann", () => {
    // NextResponse.next({ request: { headers } }) spiegelt jeden weitergegebenen
    // Anfrage-Header auf der Antwort als "x-middleware-request-<name>" und listet
    // die Namen in "x-middleware-override-headers" (next/dist/server/web/spec-extension/response.js).
    // Das ist der Mechanismus, über den Next beim Rendern das Token wiederfindet.
    const antwort = proxy(anfrage("/"));

    expect(antwort.headers.get("x-middleware-override-headers")).toContain("x-nonce");
    expect(antwort.headers.get("x-middleware-request-x-nonce")).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

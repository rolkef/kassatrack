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
});

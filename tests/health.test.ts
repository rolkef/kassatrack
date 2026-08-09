import { describe, expect, it } from "bun:test";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("antwortet mit Status 200 und ok", async () => {
    const antwort = await GET();

    expect(antwort.status).toBe(200);
    const daten = (await antwort.json()) as { status: string; zeit: string };
    expect(daten.status).toBe("ok");
    expect(Number.isNaN(Date.parse(daten.zeit))).toBe(false);
  });
});

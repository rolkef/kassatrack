import { describe, expect, it } from "bun:test";
import { parseEnv } from "@/lib/env";

const vollstaendig = {
  DATABASE_URL: "postgres://u:p@localhost:5432/kassatrack",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://kassatrack.example.at",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
};

describe("parseEnv", () => {
  it("akzeptiert eine vollständige Konfiguration", () => {
    expect(parseEnv(vollstaendig).DATABASE_URL).toBe(vollstaendig.DATABASE_URL);
  });

  it("wirft, wenn DATABASE_URL fehlt", () => {
    const { DATABASE_URL, ...ohne } = vollstaendig;
    expect(() => parseEnv(ohne)).toThrow(/DATABASE_URL/);
  });

  it("wirft, wenn das Secret zu kurz ist", () => {
    expect(() => parseEnv({ ...vollstaendig, BETTER_AUTH_SECRET: "kurz" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("wirft, wenn BETTER_AUTH_URL keine URL ist", () => {
    expect(() => parseEnv({ ...vollstaendig, BETTER_AUTH_URL: "keine-url" })).toThrow(
      /BETTER_AUTH_URL/,
    );
  });
});

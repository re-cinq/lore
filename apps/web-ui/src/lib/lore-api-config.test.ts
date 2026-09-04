import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveLoreApiConfig } from "./lore-api-config";

describe("resolveLoreApiConfig", () => {
  const original = {
    apiUrl: process.env.LORE_API_URL,
    token: process.env.LORE_INGEST_TOKEN,
  };

  beforeEach(() => {
    process.env.LORE_API_URL = "https://lore-api.example";
    process.env.LORE_INGEST_TOKEN = "tok";
  });

  afterEach(() => {
    process.env.LORE_API_URL = original.apiUrl;
    process.env.LORE_INGEST_TOKEN = original.token;
  });

  it("returns the URL and token when both are set", () => {
    expect(resolveLoreApiConfig()).toEqual({
      apiUrl: "https://lore-api.example",
      token: "tok",
    });
  });

  it("returns null when LORE_API_URL is unset", () => {
    delete process.env.LORE_API_URL;

    expect(resolveLoreApiConfig()).toBeNull();
  });

  it("returns null when LORE_INGEST_TOKEN is unset", () => {
    delete process.env.LORE_INGEST_TOKEN;

    expect(resolveLoreApiConfig()).toBeNull();
  });
});

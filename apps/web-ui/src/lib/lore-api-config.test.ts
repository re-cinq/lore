import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sessionToken = vi.fn();

vi.mock("@/lib/session-token", () => ({ sessionToken }));

const { resolveLoreApiConfig } = await import("./lore-api-config");

describe("resolveLoreApiConfig", () => {
  const original = process.env.LORE_API_URL;

  beforeEach(() => {
    process.env.LORE_API_URL = "https://lore-api.example";
    sessionToken.mockResolvedValue("session-1");
  });

  afterEach(() => {
    process.env.LORE_API_URL = original;
  });

  it("returns the URL and the person's session token when both are there", async () => {
    expect(await resolveLoreApiConfig()).toEqual({
      apiUrl: "https://lore-api.example",
      token: "session-1",
    });
  });

  it("returns null when LORE_API_URL is unset", async () => {
    delete process.env.LORE_API_URL;

    expect(await resolveLoreApiConfig()).toBeNull();
  });

  it("returns null when there is no session", async () => {
    sessionToken.mockResolvedValue(null);

    expect(await resolveLoreApiConfig()).toBeNull();
  });
});

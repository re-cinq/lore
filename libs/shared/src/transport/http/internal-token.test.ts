import { describe, it, expect } from "vitest";
import { internalToken } from "./internal-token.js";

describe("internalToken", () => {
  it("prefers the service-to-service token over the org ingest token", () => {
    expect(
      internalToken({
        LORE_AGENT_INTERNAL_TOKEN: "internal",
        LORE_INGEST_TOKEN: "ingest",
      }),
    ).toBe("internal");
  });

  it("falls back to the ingest token for local dev, which sets only one", () => {
    expect(internalToken({ LORE_INGEST_TOKEN: "ingest" })).toBe("ingest");
  });

  it("returns undefined when neither is configured", () => {
    expect(internalToken({})).toBeUndefined();
  });

  it("falls back rather than presenting an empty token", () => {
    expect(
      internalToken({
        LORE_AGENT_INTERNAL_TOKEN: "",
        LORE_INGEST_TOKEN: "ingest",
      }),
    ).toBe("ingest");
  });
});

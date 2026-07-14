import { describe, it, expect } from "vitest";
import { displayAgentId } from "./agent-id";

describe("displayAgentId", () => {
  it("keeps a readable name whole", () => {
    expect(displayAgentId("anonymous")).toBe("anonymous");
  });

  it("keeps a longer readable name whole", () => {
    expect(displayAgentId("organisation")).toBe("organisation");
  });

  it("keeps a hyphenated name whole", () => {
    expect(displayAgentId("gap-detector")).toBe("gap-detector");
  });

  it("truncates a long opaque hex id", () => {
    expect(displayAgentId("abcdef0123456789")).toBe("abcdef01…");
  });

  it("truncates a dashed uuid", () => {
    expect(displayAgentId("abcdef01-2345-6789-abcd-ef0123456789")).toBe(
      "abcdef01…",
    );
  });

  it("keeps a short hex string whole", () => {
    expect(displayAgentId("deadbeef")).toBe("deadbeef");
  });
});

import { describe, it, expect } from "vitest";
import { returnPathOf, signInStartHref } from "./return-path";

describe("returnPathOf", () => {
  it("keeps a page of this site with its query", () => {
    expect(returnPathOf("/repos/re-cinq/lore/plans?tab=open")).toBe(
      "/repos/re-cinq/lore/plans?tab=open",
    );
  });

  it("falls back to the home page when no page was asked for", () => {
    expect(returnPathOf(null)).toBe("/");
  });

  it.each([
    ["an address on another site", "https://evil.example/x"],
    ["a protocol-relative address", "//evil.example/x"],
    ["a backslash that browsers read as a slash", "/\\evil.example"],
    ["a header-splitting line break", "/ok\r\nSet-Cookie: x=1"],
    ["a bare word", "repos"],
  ])("falls back to the home page for %s", (_name, requested) => {
    expect(returnPathOf(requested)).toBe("/");
  });

  it.each(["/auth/signin", "/auth/start?next=/x", "/auth"])(
    "falls back to the home page for %s, which would loop through the sign-in",
    (requested) => {
      expect(returnPathOf(requested)).toBe("/");
    },
  );
});

describe("signInStartHref", () => {
  it("carries the page that was asked for", () => {
    expect(signInStartHref("/assembly-runs/run-1?x=1")).toBe(
      "/auth/start?next=%2Fassembly-runs%2Frun-1%3Fx%3D1",
    );
  });

  it("carries nothing when the home page is all there is to return to", () => {
    expect(signInStartHref("https://evil.example")).toBe("/auth/start");
  });
});

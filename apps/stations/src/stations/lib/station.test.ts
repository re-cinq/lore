import { describe, it, expect } from "vitest";
import { unsupportedPort } from "./station.js";

/**
 * Not every host can serve every port — lore-api runs the scheduled data
 * operations and has no GitHub App — and the alternative to saying so was a cast
 * claiming otherwise, which fails as `undefined is not a function` somewhere
 * inside a station.
 */
describe("unsupportedPort", () => {
  it("does not throw when it is merely declared, so a host can be built", () => {
    expect(() => unsupportedPort("repoFor", "lore-api")).not.toThrow();
  });

  it("names the port and the host when something actually reaches for it", () => {
    expect(() => unsupportedPort("repoFor", "lore-api")()).toThrow(
      /station port "repoFor" is not served by the lore-api host/,
    );
  });
});

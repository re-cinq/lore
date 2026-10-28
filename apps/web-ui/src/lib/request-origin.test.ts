import { describe, it, expect } from "vitest";
import { requestOrigin } from "./request-origin";

const headers = (init: Record<string, string>) => new Headers(init);

describe("requestOrigin", () => {
  it("rebuilds the public address from the proxy's forwarded headers", () => {
    expect(
      requestOrigin(
        headers({
          "x-forwarded-proto": "https",
          "x-forwarded-host": "lore.gcp.re-cinq.com",
          host: "10.0.0.7:3000",
        }),
      ),
    ).toBe("https://lore.gcp.re-cinq.com");
  });

  it("falls back to the host header over http when nothing is forwarded", () => {
    expect(requestOrigin(headers({ host: "localhost:3000" }))).toBe(
      "http://localhost:3000",
    );
  });

  it("takes the first of several forwarded hosts, the one the client asked for", () => {
    expect(
      requestOrigin(
        headers({
          "x-forwarded-proto": "https",
          "x-forwarded-host": "lore.example, proxy.internal",
        }),
      ),
    ).toBe("https://lore.example");
  });
});

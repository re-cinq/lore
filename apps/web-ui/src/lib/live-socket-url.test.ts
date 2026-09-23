import { describe, it, expect } from "vitest";
import { liveSocketUrl } from "./live-socket-url";

describe("liveSocketUrl", () => {
  it("uses the public socket address the deployment names", () => {
    expect(
      liveSocketUrl({
        LORE_WS_URL: "wss://lore-api.example/api/ws",
        LORE_API_URL: "http://lore-api.lore-api.svc:3000",
      }),
    ).toBe("wss://lore-api.example/api/ws");
  });

  it("derives ws://localhost:3002/api/ws from a local lore-api", () => {
    expect(liveSocketUrl({ LORE_API_URL: "http://localhost:3002" })).toBe(
      "ws://localhost:3002/api/ws",
    );
  });

  it("names no address when neither is set", () => {
    expect(liveSocketUrl({})).toBeUndefined();
  });
});

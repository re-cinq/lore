import { describe, it, expect } from "vitest";
import { decideLlmSource } from "./local-station-credentials.js";

describe("decideLlmSource", () => {
  it("returns personal when opted in and local creds present without a key", () => {
    expect(decideLlmSource({ allowPersonal: true, hasLocalCreds: true, hasApiKey: false })).toBe("personal");
  });

  it("returns personal over api-key when opted in and both available", () => {
    expect(decideLlmSource({ allowPersonal: true, hasLocalCreds: true, hasApiKey: true })).toBe("personal");
  });

  it("returns api-key when opted in but no local creds", () => {
    expect(decideLlmSource({ allowPersonal: true, hasLocalCreds: false, hasApiKey: true })).toBe("api-key");
  });

  it("returns api-key when not opted in even with local creds present", () => {
    expect(decideLlmSource({ allowPersonal: false, hasLocalCreds: true, hasApiKey: true })).toBe("api-key");
  });

  it("returns none when not opted in and no api key", () => {
    expect(decideLlmSource({ allowPersonal: false, hasLocalCreds: true, hasApiKey: false })).toBe("none");
  });

  it("returns none when opted in but neither local creds nor api key", () => {
    expect(decideLlmSource({ allowPersonal: true, hasLocalCreds: false, hasApiKey: false })).toBe("none");
  });
});

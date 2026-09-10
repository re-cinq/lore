import { describe, it, expect } from "vitest";
import { signRunCredential, verifyRunCredential } from "./run-credential.js";

const KEY = "run-credential-test-key";
const claims = {
  stationRunId: "4fd0f8d9-3fc2-4c4d-9471-a9e4f1eb24c7",
  repo: "re-cinq/bowman-ui",
  expiresAt: "2026-09-10T18:00:00.000Z",
};

describe("verifyRunCredential", () => {
  it("returns the claims of a credential signed with the same key before it expires", () => {
    const credential = signRunCredential(claims, KEY);

    expect(
      verifyRunCredential(credential, KEY, new Date("2026-09-10T17:00:00Z")),
    ).toEqual({ ok: true, claims });
  });
});

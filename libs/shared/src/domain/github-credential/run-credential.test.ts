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

  it("refuses a credential signed with another key as bad-signature", () => {
    const credential = signRunCredential(claims, "another-key");

    expect(
      verifyRunCredential(credential, KEY, new Date("2026-09-10T17:00:00Z")),
    ).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("refuses a correctly signed credential presented after 18:00 when it expired at 18:00, as expired", () => {
    const credential = signRunCredential(claims, KEY);

    expect(
      verifyRunCredential(credential, KEY, new Date("2026-09-10T18:00:01Z")),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses not-a-credential as malformed rather than throwing", () => {
    expect(
      verifyRunCredential(
        "not-a-credential",
        KEY,
        new Date("2026-09-10T17:00:00Z"),
      ),
    ).toEqual({ ok: false, reason: "malformed" });
  });
});

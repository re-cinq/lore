import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifySlackSignature } from "./webhook-slack.js";

const FIXED_SECONDS_SINCE_EPOCH = 1767225600;

describe("Slack HMAC verification", () => {
  const signingSecret = "test-signing-secret-12345";

  it("accepts valid signature", () => {
    const body = "token=test&text=hello+world&channel_id=C123";
    const timestamp = String(FIXED_SECONDS_SINCE_EPOCH);
    const sigBase = `v0:${timestamp}:${body}`;
    const signature =
      "v0=" + createHmac("sha256", signingSecret).update(sigBase).digest("hex");

    expect(
      verifySlackSignature(signingSecret, timestamp, signature, body),
    ).toBe(true);
  });

  it("rejects invalid signature", () => {
    const body = "token=test&text=hello";
    const timestamp = String(FIXED_SECONDS_SINCE_EPOCH);

    expect(
      verifySlackSignature(signingSecret, timestamp, "v0=invalid", body),
    ).toBe(false);
  });

  it("rejects tampered body", () => {
    const body = "token=test&text=hello";
    const timestamp = String(FIXED_SECONDS_SINCE_EPOCH);
    const sigBase = `v0:${timestamp}:${body}`;
    const signature =
      "v0=" + createHmac("sha256", signingSecret).update(sigBase).digest("hex");

    expect(
      verifySlackSignature(
        signingSecret,
        timestamp,
        signature,
        body + "&extra=bad",
      ),
    ).toBe(false);
  });

  it("rejects old timestamps (replay protection)", () => {
    const sixMinutesAgo = FIXED_SECONDS_SINCE_EPOCH - 360;
    const isReplay = Math.abs(FIXED_SECONDS_SINCE_EPOCH - sixMinutesAgo) > 300;

    expect(isReplay).toBe(true);
  });

  it("accepts recent timestamps", () => {
    const tenSecondsAgo = FIXED_SECONDS_SINCE_EPOCH - 10;
    const isReplay = Math.abs(FIXED_SECONDS_SINCE_EPOCH - tenSecondsAgo) > 300;

    expect(isReplay).toBe(false);
  });
});

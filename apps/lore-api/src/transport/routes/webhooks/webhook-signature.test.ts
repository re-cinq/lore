import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifySlackSignature } from "./webhook-slack.js";

const SECRET = "shhh";

describe("verifySlackSignature", () => {
  const timestamp = "1700000000";
  const body = "text=hello&channel_id=C1";
  const valid =
    "v0=" +
    createHmac("sha256", SECRET)
      .update(`v0:${timestamp}:${body}`)
      .digest("hex");

  it("returns true for a matching v0 signature", () => {
    expect(verifySlackSignature(SECRET, timestamp, valid, body)).toBe(true);
  });

  it("returns false when the timestamp differs", () => {
    expect(verifySlackSignature(SECRET, "1700000001", valid, body)).toBe(false);
  });

  it("returns false on a length mismatch without throwing", () => {
    expect(verifySlackSignature(SECRET, timestamp, "v0=short", body)).toBe(
      false,
    );
  });
});

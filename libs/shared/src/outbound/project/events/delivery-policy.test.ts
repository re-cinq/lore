import { describe, it, expect } from "vitest";
import { isUnauthorized, nextDeliveryStep } from "./delivery-policy.js";

const refusal = (status: number): Error =>
  Object.assign(new Error(`event insert failed: ${status}`), { status });

describe("isUnauthorized", () => {
  it("reads 401 and 403 as a refused credential", () => {
    expect([
      isUnauthorized(refusal(401)),
      isUnauthorized(refusal(403)),
    ]).toEqual([true, true]);
  });

  it("reads 503 as a blip, not a refusal, so a busy router never rotates the token", () => {
    expect(isUnauthorized(refusal(503))).toBe(false);
  });

  it("reads a status-less error as a blip, so a fetch timeout never rotates the token", () => {
    expect(isUnauthorized(new Error("fetch failed"))).toBe(false);
  });
});

describe("nextDeliveryStep", () => {
  it("retries a blip with a delay that grows with the attempt", () => {
    expect(
      nextDeliveryStep({
        error: refusal(503),
        attempt: 2,
        attempts: 5,
        delayMs: 500,
      }),
    ).toEqual({ reauth: false, next: { kind: "retry", delayMs: 1000 } });
  });

  it("rotates the credential before retrying a refusal", () => {
    expect(
      nextDeliveryStep({
        error: refusal(401),
        attempt: 1,
        attempts: 5,
        delayMs: 500,
      }),
    ).toEqual({ reauth: true, next: { kind: "retry", delayMs: 500 } });
  });

  it("drops after the last attempt, leaving the reconcile cron as the backstop", () => {
    expect(
      nextDeliveryStep({
        error: refusal(503),
        attempt: 5,
        attempts: 5,
        delayMs: 500,
      }),
    ).toEqual({ reauth: false, next: { kind: "drop" } });
  });

  it("still rotates on a refusal at the last attempt, so the NEXT message is not lost too", () => {
    expect(
      nextDeliveryStep({
        error: refusal(401),
        attempt: 5,
        attempts: 5,
        delayMs: 500,
      }),
    ).toEqual({ reauth: true, next: { kind: "drop" } });
  });
});

import { describe, it, expect } from "vitest";
import { nextDeliveryStep } from "./delivery-policy.js";

describe("nextDeliveryStep", () => {
  it("retries with a delay that grows with the attempt", () => {
    expect(nextDeliveryStep({ attempt: 2, attempts: 5, delayMs: 500 })).toEqual(
      { kind: "retry", delayMs: 1000 },
    );
  });

  it("drops after the last attempt, leaving the reconcile cron as the backstop", () => {
    expect(nextDeliveryStep({ attempt: 5, attempts: 5, delayMs: 500 })).toEqual(
      { kind: "drop" },
    );
  });
});

import { describe, it, expect } from "vitest";
import {
  billingAlertMessage,
  BillingAlertThrottle,
  maybeAlertBilling,
} from "./billing-alert.js";

const billingOutput = JSON.stringify({
  type: "result",
  is_error: true,
  result: "Credit balance is too low",
});

describe("billingAlertMessage", () => {
  it("names the repo, node type, and the account error for a billing failure", () => {
    const message = billingAlertMessage("re-cinq/lore", "review", {
      output: billingOutput,
      failureReason: "BackoffLimitExceeded: Job has reached the backoff limit",
    });

    expect(message).toContain("out of credits");
    expect(message).toContain("Credit balance is too low");
    expect(message).toContain("re-cinq/lore");
    expect(message).toContain("review");
  });

  it("falls back to failureReason when the output carries no result line", () => {
    expect(
      billingAlertMessage("re-cinq/lore", "refine", {
        failureReason: "insufficient credit balance for this request",
      }),
    ).toContain("out of credits");
  });

  it("returns null for a non-billing failure", () => {
    expect(
      billingAlertMessage("re-cinq/lore", "review", {
        output: JSON.stringify({
          type: "result",
          is_error: true,
          result: "ENOENT: no such file",
        }),
        failureReason: "deadline",
      }),
    ).toBeNull();
  });
});

describe("BillingAlertThrottle", () => {
  it("allows the first claim, blocks a second within the window, allows again after it", () => {
    let now = 1000;
    const throttle = new BillingAlertThrottle(60_000, () => now);

    expect(throttle.claim()).toBe(true);
    now = 30_000;
    expect(throttle.claim()).toBe(false);
    now = 61_001;
    expect(throttle.claim()).toBe(true);
  });
});

describe("maybeAlertBilling", () => {
  const status = { output: billingOutput };

  it("sends one throttled alert for a billing failure and reports it sent", async () => {
    const sent: string[] = [];
    const throttle = new BillingAlertThrottle(60_000, () => 0);
    const ports = {
      notify: async (_level: string, message: string) => {
        sent.push(message);
      },
      throttle,
    };

    expect(
      await maybeAlertBilling("re-cinq/lore", "review", status, ports),
    ).toBe(true);
    // A second drowned run in the same window is suppressed by the throttle.
    expect(
      await maybeAlertBilling("re-cinq/other", "refine", status, ports),
    ).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("does not send or consume the throttle for a non-billing failure", async () => {
    let sends = 0;
    const throttle = new BillingAlertThrottle(60_000, () => 0);
    const ports = {
      notify: async () => {
        sends += 1;
      },
      throttle,
    };

    expect(
      await maybeAlertBilling(
        "re-cinq/lore",
        "review",
        { failureReason: "deadline" },
        ports,
      ),
    ).toBe(false);
    expect(sends).toBe(0);
    // The throttle was never consumed, so a real billing failure still alerts.
    expect(
      await maybeAlertBilling("re-cinq/lore", "review", status, ports),
    ).toBe(true);
  });

  it("swallows a notify throw so a failed alert never fails the node-event handler", async () => {
    const ports = {
      notify: async () => {
        throw new Error("slack down");
      },
      throttle: new BillingAlertThrottle(60_000, () => 0),
    };

    expect(
      await maybeAlertBilling("re-cinq/lore", "review", status, ports),
    ).toBe(false);
  });
});

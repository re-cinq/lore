// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { billingSourceSplit, BillingSource } from "./SpendBillingSource";

// Rows that cross-wire billing_mode against cluster to expose whether the split
// uses the recorded mode or falls back to the cluster proxy.
//
// Row A: billing_mode api  + cluster satellite  → should count as api  (cluster says subscription)
// Row B: billing_mode sub  + cluster null        → should count as sub  (cluster says api)
// Row C: billing_mode unknown + cluster null     → fallback to cluster  → api
// Row D: billing_mode unknown + cluster satellite → fallback to cluster → subscription
//
// Expected after the fix:
//   api          = A + C = 100 + 30 = 130 calls, $13.00
//   subscription = B + D =  50 + 20 =  70 calls, $7.00
//
// Current (cluster-only) behaviour produces the opposite for A and B:
//   api          = B + C = 80 calls, $8.00   ← wrong
//   subscription = A + D = 120 calls, $12.00 ← wrong
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows: any = [
  { cluster: "satellite-a", billing_mode: "api", calls: 100, cost_usd: 10.0 },
  { cluster: null, billing_mode: "subscription", calls: 50, cost_usd: 5.0 },
  { cluster: null, billing_mode: "unknown", calls: 30, cost_usd: 3.0 },
  { cluster: "satellite-b", billing_mode: "unknown", calls: 20, cost_usd: 2.0 },
];

describe("billingSourceSplit — billing_mode takes precedence over cluster", () => {
  it("classifies rows by their recorded billing_mode and falls back to cluster only for unknown", () => {
    const split = billingSourceSplit(rows);

    expect(split.api).toEqual({ calls: 130, cost_usd: 13.0 });
    expect(split.subscription).toEqual({ calls: 70, cost_usd: 7.0 });
  });
});

describe("BillingSource — note removes proxy language when billing_mode is present", () => {
  it("does not say the split is derived from cluster when billing_mode is recorded on rows", () => {
    render(<BillingSource byCluster={rows} />);

    expect(
      screen.queryByText(/Derived from which cluster ran each call/i),
    ).not.toBeInTheDocument();
  });
});

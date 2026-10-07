// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { billingSourceSplit, BillingSource } from "./SpendBillingSource";

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

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BillingSource, billingSourceSplit } from "./SpendBillingSource";

const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const byCluster = [
  { cluster: null, calls: 1500, cost_usd: 260.3 },
  { cluster: "colleague-satellite", calls: 340, cost_usd: 52.17 },
  { cluster: "second-satellite", calls: 60, cost_usd: 8.0 },
];

describe("billingSourceSplit", () => {
  it("counts the no-cluster bucket as the org API key", () => {
    expect(billingSourceSplit(byCluster).api).toEqual({
      calls: 1500,
      cost_usd: 260.3,
    });
  });

  it("sums every named cluster as subscription spend", () => {
    expect(billingSourceSplit(byCluster).subscription).toEqual({
      calls: 400,
      cost_usd: 60.17,
    });
  });

  it("reports zero subscription spend when nothing ran on a satellite", () => {
    expect(
      billingSourceSplit([{ cluster: null, calls: 10, cost_usd: 1 }])
        .subscription,
    ).toEqual({ calls: 0, cost_usd: 0 });
  });
});

describe("BillingSource", () => {
  const table = () =>
    screen.getByRole("heading", { name: "Billing Source", level: 2 })
      .nextElementSibling as HTMLElement;

  it("shows the org API-key row with its cost", () => {
    render(<BillingSource byCluster={byCluster} />);

    expect(within(table()).getByText(/API key/)).toBeInTheDocument();
    expect(within(table()).getByText(usd(260.3))).toBeInTheDocument();
  });

  it("sums the satellite subscription rows into one billed cost", () => {
    render(<BillingSource byCluster={byCluster} />);

    expect(within(table()).getByText(/Subscription/)).toBeInTheDocument();
    expect(within(table()).getByText(usd(60.17))).toBeInTheDocument();
  });

  it("notes that the billed figure covers only the API-key portion", () => {
    render(<BillingSource byCluster={byCluster} />);

    expect(
      screen.getByText(/billed figure covers only the API-key/i),
    ).toBeInTheDocument();
  });

  it("renders nothing when no spend is cluster-attributed", () => {
    const { container } = render(<BillingSource byCluster={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

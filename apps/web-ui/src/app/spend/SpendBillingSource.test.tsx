// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BillingSource } from "./SpendBillingSource";

const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const byBillingMode = [
  { mode: "api_key" as const, calls: 1500, cost_usd: 260.3 },
  { mode: "subscription" as const, calls: 400, cost_usd: 60.17 },
  { mode: "unknown" as const, calls: 12, cost_usd: 3.5 },
];

describe("BillingSource", () => {
  const table = () =>
    screen.getByRole("heading", { name: "Billing Source", level: 2 })
      .nextElementSibling as HTMLElement;

  it("shows the org API-key row with its cost", () => {
    render(<BillingSource byBillingMode={byBillingMode} />);

    expect(within(table()).getByText(/API key/)).toBeInTheDocument();
    expect(within(table()).getByText(usd(260.3))).toBeInTheDocument();
  });

  it("shows the subscription row with its cost", () => {
    render(<BillingSource byBillingMode={byBillingMode} />);

    expect(within(table()).getByText(/Subscription/)).toBeInTheDocument();
    expect(within(table()).getByText(usd(60.17))).toBeInTheDocument();
  });

  it("shows runs whose agent named no credential as unknown", () => {
    render(<BillingSource byBillingMode={byBillingMode} />);

    expect(within(table()).getByText(/Unknown/)).toBeInTheDocument();
    expect(within(table()).getByText(usd(3.5))).toBeInTheDocument();
  });

  it("notes that the billed figure covers only the API-key portion", () => {
    render(<BillingSource byBillingMode={byBillingMode} />);

    expect(
      screen.getByText(/billed figure covers only the API-key/i),
    ).toBeInTheDocument();
  });

  it("renders nothing when there is no spend to split", () => {
    const { container } = render(<BillingSource byBillingMode={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

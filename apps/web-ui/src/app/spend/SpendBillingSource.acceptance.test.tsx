// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BillingSource } from "./SpendBillingSource";

describe("SpendBillingSource (acceptance)", () => {
  it("stops calling the billing source a proxy once the recorded mode is present", () => {
    const byBillingMode = [
      { mode: "api_key" as const, calls: 1500, cost_usd: 260.3 },
      { mode: "subscription" as const, calls: 400, cost_usd: 60.17 },
    ];

    render(<BillingSource byBillingMode={byBillingMode} />);

    expect(
      screen.queryByText(
        /under the credential its agent reported when it started/,
      ),
    ).not.toBeInTheDocument();
  });
});

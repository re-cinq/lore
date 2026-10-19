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

    // The previous text explained that "runs bill each person's own account, so they never reach the org invoice",
    // but when we record the exact mode, it should not imply that it's just "derived from cluster attribution"
    // Wait, the ticket says: "The note on the page stops calling it a proxy once the recorded mode is present."

    // So the note must not say "under the credential its agent reported when it started" anymore,
    // or it must explicitly remove the word "proxy" if it exists, or update the wording to reflect per-call exactness.
    expect(
      screen.queryByText(
        /under the credential its agent reported when it started/,
      ),
    ).not.toBeInTheDocument();
  });
});

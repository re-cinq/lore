// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PlatformOutageBanner from "./PlatformOutageBanner";
import type { PlatformLlmStatus } from "@/lib/api/platform-status";

const healthy: PlatformLlmStatus = {
  degraded: false,
  failure_class: null,
  detail: null,
  since: null,
  affected_runs: 0,
};

const outage: PlatformLlmStatus = {
  degraded: true,
  failure_class: "anthropic-credit",
  detail: "Credit balance is too low",
  since: "2026-08-20T09:14:00Z",
  affected_runs: 12,
};

describe("PlatformOutageBanner", () => {
  it("renders nothing while the platform is healthy", () => {
    const { container } = render(<PlatformOutageBanner status={healthy} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("names the outage as the platform's rather than the feature's", () => {
    render(<PlatformOutageBanner status={outage} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "platform outage, not your feature",
    );
  });

  it("quotes the account's own error", () => {
    render(<PlatformOutageBanner status={outage} />);

    expect(screen.getByText("Credit balance is too low")).toBeInTheDocument();
  });

  it("says retrying will not help and counts the runs affected", () => {
    render(<PlatformOutageBanner status={outage} />);
    const alert = screen.getByRole("alert");

    expect(alert).toHaveTextContent("retrying now will not help");
    expect(alert).toHaveTextContent("12 runs affected");
  });

  it("says run, not runs, for a single affected run", () => {
    render(<PlatformOutageBanner status={{ ...outage, affected_runs: 1 }} />);

    expect(screen.getByRole("alert")).toHaveTextContent("1 run affected");
  });

  it("omits the count entirely when no run has been affected yet", () => {
    render(<PlatformOutageBanner status={{ ...outage, affected_runs: 0 }} />);

    expect(screen.getByRole("alert")).not.toHaveTextContent("affected");
  });

  it("renders without a detail line when the cause was never recorded", () => {
    render(<PlatformOutageBanner status={{ ...outage, detail: null }} />);

    expect(screen.getByRole("alert")).toHaveTextContent("model access is down");
  });
});

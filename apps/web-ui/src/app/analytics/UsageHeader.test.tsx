// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UsageHeader } from "./UsageHeader";

describe("UsageHeader", () => {
  it("links the Activity tab to /analytics and the Spend tab to /spend", () => {
    render(<UsageHeader active="activity" />);
    expect(screen.getByRole("link", { name: "Activity" })).toHaveAttribute(
      "href",
      "/analytics",
    );
    expect(screen.getByRole("link", { name: "Spend" })).toHaveAttribute(
      "href",
      "/spend",
    );
  });

  it("marks only the active route's tab as the current page", () => {
    render(<UsageHeader active="spend" />);
    expect(screen.getByRole("link", { name: "Spend" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Activity" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("titles both routes Usage & spend under the insights caption", () => {
    render(<UsageHeader active="spend" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Usage & spend" }),
    ).toBeInTheDocument();
    expect(screen.getByText("{insights}")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SpendSection } from "./SpendSection";

describe("SpendSection", () => {
  it("labels an estimate section with an estimate pill", () => {
    render(
      <SpendSection title="Lore-computed LLM spend" kind="estimate">
        <div>child</div>
      </SpendSection>,
    );

    const section = screen.getByRole("region", {
      name: "Lore-computed LLM spend",
    });

    expect(
      within(section).getByRole("heading", { name: "Lore-computed LLM spend" }),
    ).toBeInTheDocument();
    expect(within(section).getByText("estimate")).toBeInTheDocument();
    expect(within(section).getByText("child")).toBeInTheDocument();
  });

  it("labels a billed section with a billed pill", () => {
    render(
      <SpendSection title="Vendor invoices" kind="billed">
        <div>child</div>
      </SpendSection>,
    );

    expect(screen.getByText("billed")).toBeInTheDocument();
    expect(screen.queryByText("estimate")).toBeNull();
  });

  it("renders the caption when one is given", () => {
    render(
      <SpendSection
        title="Kubernetes compute"
        kind="estimate"
        caption="what pods cost"
      >
        <div>child</div>
      </SpendSection>,
    );

    expect(screen.getByText("what pods cost")).toBeInTheDocument();
  });
});

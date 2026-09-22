// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { UnitCosts } from "./SpendUnitCosts";
import type { SpendWindow } from "./SpendView";

const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const tableByHeading = (heading: string): HTMLElement => {
  const h2 = screen.getByRole("heading", { name: heading, level: 2 });

  return h2.nextElementSibling as HTMLElement;
};

const rowTexts = (heading: string): string[] =>
  within(tableByHeading(heading))
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent ?? "");

const LORE_1648 = {
  label: "re-cinq/lore#1648",
  url: "https://github.com/re-cinq/lore/issues/1648",
  runs: 4,
  cost_usd: 70.27,
};

const DESCRIBED = {
  label: "Old ticket text",
  url: null,
  runs: 1,
  cost_usd: 0.46,
};

const BOWMAN_127 = {
  label: "re-cinq/bowman-ui#127",
  url: "https://github.com/re-cinq/bowman-ui/pull/127",
  runs: 9,
  cost_usd: 13.54,
};

const NO_UNITS = {
  count: 0,
  total_usd: 0,
  avg_usd: 0,
  median_usd: 0,
  most: [],
  least: [],
};

const unitCosts: SpendWindow["unit_costs"] = {
  tickets: {
    count: 71,
    total_usd: 872,
    avg_usd: 12.28,
    median_usd: 5.99,
    most: [LORE_1648],
    least: [DESCRIBED],
  },
  reviews: {
    per_pr: {
      count: 40,
      total_usd: 67.2,
      avg_usd: 1.68,
      median_usd: 0.9,
      most: [BOWMAN_127],
      least: [],
    },
    by_line: [
      { blueprint: "code-review", runs: 30, total_usd: 35.4, avg_usd: 1.18 },
      {
        blueprint: "code-review-recheck",
        runs: 20,
        total_usd: 3.8,
        avg_usd: 0.19,
      },
    ],
    by_model: [{ model: "gemini-3.1-pro-preview", calls: 50, cost_usd: 39.2 }],
  },
  nodes: [
    {
      blueprint: "implementation-loop",
      node_id: "tdd-round",
      visits: 10,
      total_usd: 14,
      per_visit_usd: 1.4,
      models: ["claude-opus-4-7", "claude-sonnet-4-6"],
    },
  ],
};

describe("UnitCosts", () => {
  it("shows 71 tickets at 872 USD total, 12.28 average and 5.99 median", () => {
    render(<UnitCosts unitCosts={unitCosts} />);

    expect(rowTexts("Cost per Ticket")).toEqual([
      `71${usd(872)}${usd(12.28)}${usd(5.99)}`,
    ]);
  });

  it("links the dearest ticket lore 1648 to its issue", () => {
    render(<UnitCosts unitCosts={unitCosts} />);

    const link = within(tableByHeading("Most Expensive Tickets")).getByRole(
      "link",
      { name: "re-cinq/lore#1648" },
    );

    expect(link.getAttribute("href")).toEqual(
      "https://github.com/re-cinq/lore/issues/1648",
    );
  });

  it("names a ticket known only by its description without a link", () => {
    render(<UnitCosts unitCosts={unitCosts} />);

    const cheapest = tableByHeading("Cheapest Tickets");

    expect({
      text: rowTexts("Cheapest Tickets"),
      links: within(cheapest).queryAllByRole("link").length,
    }).toEqual({ text: [`Old ticket text1${usd(0.46)}`], links: 0 });
  });

  it("shows the review line averages: 1.18 per review, 0.19 per recheck", () => {
    render(<UnitCosts unitCosts={unitCosts} />);

    expect(rowTexts("Review Cost by Line")).toEqual([
      `code-review30${usd(35.4)}${usd(1.18)}`,
      `code-review-recheck20${usd(3.8)}${usd(0.19)}`,
    ]);
  });

  it("links the dearest PR bowman-ui 127 to its pull request", () => {
    render(<UnitCosts unitCosts={unitCosts} />);

    const link = within(tableByHeading("Most Expensive PRs")).getByRole(
      "link",
      { name: "re-cinq/bowman-ui#127" },
    );

    expect(link.getAttribute("href")).toEqual(
      "https://github.com/re-cinq/bowman-ui/pull/127",
    );
  });

  it("lists review cost by model, gemini-3.1-pro-preview at 39.20", () => {
    render(<UnitCosts unitCosts={unitCosts} />);

    expect(rowTexts("Review Cost by Model")).toEqual([
      `gemini-3.1-pro-preview50${usd(39.2)}`,
    ]);
  });

  it("shows tdd-round at 10 visits, 1.40 per visit, on its two models", () => {
    render(<UnitCosts unitCosts={unitCosts} />);

    expect(rowTexts("Cost per Node")).toEqual([
      `implementation-looptdd-round10${usd(14)}${usd(1.4)}claude-opus-4-7, claude-sonnet-4-6`,
    ]);
  });

  it("says so when the window holds no tickets, reviews or node visits", () => {
    render(
      <UnitCosts
        unitCosts={{
          tickets: NO_UNITS,
          reviews: { per_pr: NO_UNITS, by_line: [], by_model: [] },
          nodes: [],
        }}
      />,
    );

    expect({
      tickets: rowTexts("Most Expensive Tickets"),
      prs: rowTexts("Cheapest PRs"),
      nodes: rowTexts("Cost per Node"),
    }).toEqual({
      tickets: ["No ticket spend in this window"],
      prs: ["No review spend in this window"],
      nodes: ["No node-attributed spend in this window"],
    });
  });
});

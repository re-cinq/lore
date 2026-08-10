// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SpendView, { type SpendViewProps, type OrgMtdRow } from "./SpendView";

const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const num = (n: number) => Number(n).toLocaleString();

const tableByHeading = (heading: string): HTMLElement => {
  const h2 = screen.getByRole("heading", { name: heading, level: 2 });
  const table = h2.nextElementSibling as HTMLElement;

  expect(table.tagName).toBe("TABLE");

  return table;
};

const orgMtd: OrgMtdRow = {
  billed_usd: 1234.5,
  input_tokens: 1234567,
  output_tokens: 89012,
  as_of: "2026-06-04T10:00:00.000Z",
};

const populated: SpendViewProps = {
  orgMtd,
  orgAvailable: true,
  orgByModel: [
    {
      model: "claude-opus-4",
      cost_usd: 900.25,
      input_tokens: 1000000,
      output_tokens: 50000,
    },
    { model: "", cost_usd: 12.75, input_tokens: 0, output_tokens: 0 },
  ],
  orgDaily: [
    { bucket_date: "2026-06-04", cost_usd: 400.1 },
    { bucket_date: "2026-06-03", cost_usd: 300.2 },
  ],
  loreComputedUsd: 555.55,
  loreByRepo: [
    { target_repo: "re-cinq/lore", tasks: 42, cost_usd: 333.33 },
    { target_repo: "re-cinq/other", tasks: 7, cost_usd: 11.11 },
  ],
  loreByTaskType: [
    { task_type: "implementation", tasks: 30, cost_usd: 222.22 },
    { task_type: "review", tasks: 12, cost_usd: 44.44 },
  ],
};

const empty: SpendViewProps = {
  orgMtd: { billed_usd: 0, input_tokens: 0, output_tokens: 0, as_of: null },
  orgAvailable: false,
  orgByModel: [],
  orgDaily: [],
  loreComputedUsd: 0,
  loreByRepo: [],
  loreByTaskType: [],
};

describe("SpendView", () => {
  it("renders the page title and all section headings", () => {
    render(<SpendView {...populated} />);
    expect(
      screen.getByRole("heading", { name: "Claude API Spend", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Month to Date", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Billed Cost by Model (MTD)",
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Daily Billed Cost (This Month)",
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Lore-Computed Cost by Repo (MTD)",
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Lore-Computed Cost by Task Type (MTD)",
        level: 2,
      }),
    ).toBeInTheDocument();
  });

  it("shows billed cost, computed cost, and token totals when org data is available", () => {
    render(<SpendView {...populated} />);
    expect(screen.getByText(usd(1234.5))).toBeInTheDocument();
    expect(
      screen.getByText(
        `as of ${new Date("2026-06-04T10:00:00.000Z").toLocaleString()}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(usd(555.55))).toBeInTheDocument();
    expect(screen.getByText("estimate from token counts")).toBeInTheDocument();
    expect(screen.getByText(num(1234567))).toBeInTheDocument();
    expect(screen.getByText(num(89012))).toBeInTheDocument();
    // warning card absent when available
    expect(
      screen.queryByText("Org-wide billed cost unavailable."),
    ).not.toBeInTheDocument();
  });

  it("renders billed-cost-by-model rows including the (non-token) fallback label", () => {
    render(<SpendView {...populated} />);
    const table = tableByHeading("Billed Cost by Model (MTD)");

    expect(within(table).getByText("claude-opus-4")).toBeInTheDocument();
    expect(within(table).getByText("(non-token)")).toBeInTheDocument();
    expect(within(table).getByText(usd(900.25))).toBeInTheDocument();
    expect(within(table).getByText(usd(12.75))).toBeInTheDocument();
    expect(within(table).getByText(num(1000000))).toBeInTheDocument();
    expect(
      within(table).queryByText("No billed data yet"),
    ).not.toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header + 2
  });

  it("renders daily billed cost rows with localized dates", () => {
    render(<SpendView {...populated} />);
    const table = tableByHeading("Daily Billed Cost (This Month)");

    expect(
      within(table).getByText(new Date("2026-06-04").toLocaleDateString()),
    ).toBeInTheDocument();
    expect(
      within(table).getByText(new Date("2026-06-03").toLocaleDateString()),
    ).toBeInTheDocument();
    expect(within(table).getByText(usd(400.1))).toBeInTheDocument();
    expect(within(table).getByText(usd(300.2))).toBeInTheDocument();
  });

  it("renders lore-computed cost by repo rows with task counts", () => {
    render(<SpendView {...populated} />);
    const table = tableByHeading("Lore-Computed Cost by Repo (MTD)");

    expect(within(table).getByText("re-cinq/lore")).toBeInTheDocument();
    expect(within(table).getByText("re-cinq/other")).toBeInTheDocument();
    expect(within(table).getByText("42")).toBeInTheDocument();
    expect(within(table).getByText(usd(333.33))).toBeInTheDocument();
  });

  it("renders lore-computed cost by task type rows with badges", () => {
    render(<SpendView {...populated} />);
    const table = tableByHeading("Lore-Computed Cost by Task Type (MTD)");

    expect(within(table).getByText("implementation")).toBeInTheDocument();
    expect(within(table).getByText("review")).toBeInTheDocument();
    expect(within(table).getByText("30")).toBeInTheDocument();
    expect(within(table).getByText(usd(222.22))).toBeInTheDocument();
  });

  it("shows dashes and the warning card when org billed data is unavailable", () => {
    render(<SpendView {...empty} />);
    // three em-dash placeholders: billed cost, input tokens, output tokens
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.getByText("admin key not configured")).toBeInTheDocument();
    expect(
      screen.getByText("Org-wide billed cost unavailable."),
    ).toBeInTheDocument();
    expect(screen.getByText("ANTHROPIC_ADMIN_KEY")).toBeInTheDocument();
    expect(screen.getByText("anthropic-cost-sync")).toBeInTheDocument();
    // lore-computed cost still renders ($0.00) even when org is unavailable
    expect(screen.getByText(usd(0))).toBeInTheDocument();
  });

  it("shows empty-state rows for every table when there is no data", () => {
    render(<SpendView {...empty} />);
    expect(screen.getAllByText("No billed data yet")).toHaveLength(2); // model + daily
    expect(screen.getAllByText("No data")).toHaveLength(2); // repo + task type
  });

  it("reports a zero month as known and live rather than as a missing key", () => {
    render(<SpendView {...empty} orgSource="live" />);

    expect(
      screen.getByText("no billed spend this month yet"),
    ).toBeInTheDocument();
    expect(screen.getByText("live from Anthropic")).toBeInTheDocument();
    expect(
      screen.queryByText("admin key not configured"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Org-wide billed cost unavailable."),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByText("—")).toHaveLength(0);
  });

  it("labels a DB-rollup read as coming from the nightly sync", () => {
    render(<SpendView {...populated} orgSource="cache" />);

    expect(screen.getByText("from the last nightly sync")).toBeInTheDocument();
  });
});

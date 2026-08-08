// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SpendView, { type SpendViewProps, type LoreMtdRow } from "./SpendView";

const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const num = (n: number) => Number(n).toLocaleString();

const tableByHeading = (heading: string): HTMLElement => {
  const h2 = screen.getByRole("heading", { name: heading, level: 2 });
  const table = h2.nextElementSibling as HTMLElement;

  expect(table.tagName).toBe("TABLE");

  return table;
};

const loreMtd: LoreMtdRow = {
  computed_usd: 37.7,
  calls: 85,
  input_tokens: 12345,
  output_tokens: 735021,
};

// The no-admin-key case (orgAvailable false) with full Lore-computed data.
const loreOnly: SpendViewProps = {
  orgMtd: { billed_usd: 0, input_tokens: 0, output_tokens: 0, as_of: null },
  orgAvailable: false,
  orgByModel: [],
  orgDaily: [],
  loreMtd,
  loreByModel: [
    {
      model: "claude-sonnet-4-6",
      calls: 50,
      cost_usd: 31.73,
      input_tokens: 3372,
      output_tokens: 597948,
    },
    { model: "", calls: 3, cost_usd: 0, input_tokens: 0, output_tokens: 0 },
  ],
  loreByKind: [
    { kind: "Code review / detection line", calls: 78, cost_usd: 37.68 },
    { kind: "Memory & curation", calls: 7, cost_usd: 0.02 },
  ],
  loreDaily: [
    { bucket_date: "2026-08-07", calls: 32, cost_usd: 14.24 },
    { bucket_date: "2026-08-06", calls: 20, cost_usd: 6.75 },
  ],
  loreByRepo: [{ target_repo: "re-cinq/lore", tasks: 42, cost_usd: 333.33 }],
  loreByTaskType: [
    { task_type: "implementation", tasks: 30, cost_usd: 222.22 },
  ],
};

// Same data plus a configured admin key (the optional billed sections light up).
const withAdminKey: SpendViewProps = {
  ...loreOnly,
  orgAvailable: true,
  orgMtd: {
    billed_usd: 1234.5,
    input_tokens: 1000000,
    output_tokens: 50000,
    as_of: "2026-08-07T10:00:00.000Z",
  },
  orgByModel: [
    {
      model: "claude-opus-4",
      cost_usd: 900.25,
      input_tokens: 1000000,
      output_tokens: 50000,
    },
    { model: "", cost_usd: 12.75, input_tokens: 0, output_tokens: 0 },
  ],
  orgDaily: [{ bucket_date: "2026-08-07", cost_usd: 400.1 }],
};

const empty: SpendViewProps = {
  orgMtd: { billed_usd: 0, input_tokens: 0, output_tokens: 0, as_of: null },
  orgAvailable: false,
  orgByModel: [],
  orgDaily: [],
  loreMtd: { computed_usd: 0, calls: 0, input_tokens: 0, output_tokens: 0 },
  loreByModel: [],
  loreByKind: [],
  loreDaily: [],
  loreByRepo: [],
  loreByTaskType: [],
};

describe("SpendView", () => {
  it("renders the title and every Lore-computed section heading", () => {
    render(<SpendView {...loreOnly} />);

    for (const name of [
      "Claude API Spend",
      "Month to Date",
      "Cost by Model (MTD)",
      "Cost by Kind (MTD)",
      "Daily Cost (This Month)",
      "Cost by Repo (MTD)",
      "Cost by Task Type (MTD)",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
  });

  it("headlines the Lore-computed cost, call count, and token totals", () => {
    render(<SpendView {...loreOnly} />);
    expect(screen.getByText(usd(37.7))).toBeInTheDocument();
    expect(screen.getByText("estimate from token counts")).toBeInTheDocument();
    expect(screen.getByText(num(85))).toBeInTheDocument();
    expect(screen.getByText(num(12345))).toBeInTheDocument();
    expect(screen.getByText(num(735021))).toBeInTheDocument();
  });

  it("renders cost-by-model rows, including the (non-token) fallback label", () => {
    render(<SpendView {...loreOnly} />);
    const table = tableByHeading("Cost by Model (MTD)");

    expect(within(table).getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(within(table).getByText("(non-token)")).toBeInTheDocument();
    expect(within(table).getByText(usd(31.73))).toBeInTheDocument();
    expect(within(table).getByText(num(597948))).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header + 2
  });

  it("renders cost-by-kind rows attributing spend to reviews vs tasks", () => {
    render(<SpendView {...loreOnly} />);
    const table = tableByHeading("Cost by Kind (MTD)");

    expect(
      within(table).getByText("Code review / detection line"),
    ).toBeInTheDocument();
    expect(within(table).getByText(num(78))).toBeInTheDocument();
    expect(within(table).getByText(usd(37.68))).toBeInTheDocument();
    expect(within(table).getByText("Memory & curation")).toBeInTheDocument();
  });

  it("renders daily cost rows with localized dates and call counts", () => {
    render(<SpendView {...loreOnly} />);
    const table = tableByHeading("Daily Cost (This Month)");

    expect(
      within(table).getByText(new Date("2026-08-07").toLocaleDateString()),
    ).toBeInTheDocument();
    expect(within(table).getByText(usd(14.24))).toBeInTheDocument();
    expect(within(table).getByText(num(32))).toBeInTheDocument();
  });

  it("renders by-repo and by-task-type rows when tasks are attributed", () => {
    render(<SpendView {...loreOnly} />);
    expect(
      within(tableByHeading("Cost by Repo (MTD)")).getByText("re-cinq/lore"),
    ).toBeInTheDocument();
    const byType = tableByHeading("Cost by Task Type (MTD)");

    expect(within(byType).getByText("implementation")).toBeInTheDocument();
    expect(within(byType).getByText(usd(222.22))).toBeInTheDocument();
  });

  it("hides the billed card and Anthropic sections without an admin key", () => {
    render(<SpendView {...loreOnly} />);
    expect(
      screen.queryByText("Billed cost (Anthropic)"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Anthropic Billed by Model (MTD)",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Anthropic Daily Billed (This Month)",
      }),
    ).not.toBeInTheDocument();
    // no em-dash placeholders — the page is complete on Lore data alone
    expect(screen.queryAllByText("—")).toHaveLength(0);
  });

  it("shows the billed card and Anthropic sections when an admin key is configured", () => {
    render(<SpendView {...withAdminKey} />);
    expect(screen.getByText("Billed cost (Anthropic)")).toBeInTheDocument();
    expect(screen.getByText(usd(1234.5))).toBeInTheDocument();
    expect(
      screen.getByText(
        `as of ${new Date("2026-08-07T10:00:00.000Z").toLocaleString()}`,
      ),
    ).toBeInTheDocument();
    expect(
      within(tableByHeading("Anthropic Billed by Model (MTD)")).getByText(
        "claude-opus-4",
      ),
    ).toBeInTheDocument();
    expect(
      within(tableByHeading("Anthropic Daily Billed (This Month)")).getByText(
        usd(400.1),
      ),
    ).toBeInTheDocument();
  });

  it("shows empty-state rows for every table when there is no data", () => {
    render(<SpendView {...empty} />);
    expect(screen.getByText(usd(0))).toBeInTheDocument();
    expect(screen.getAllByText("No data")).toHaveLength(3); // model + kind + daily
    expect(
      screen.getByText(/No task-attributed spend \(e\.g\./),
    ).toBeInTheDocument(); // repo
    expect(screen.getByText("No task-attributed spend")).toBeInTheDocument(); // task type
  });
});

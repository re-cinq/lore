// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SpendView, {
  budgetOutlook,
  type SpendViewProps,
  type LoreMtdRow,
} from "./SpendView";

const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const num = (n: number) => Number(n).toLocaleString();

/** Mirrors the view's own `day`, for the reason stated there: parsing a
 *  `YYYY-MM-DD` string as a Date makes it UTC midnight, which is the previous
 *  day for every viewer west of Greenwich. */
const day = (isoDay: string) => {
  const [y, m, d] = isoDay.split("-").map(Number);

  return new Date(y, m - 1, d).toLocaleDateString();
};

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
  orgMtd: {
    billed_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    as_of: null,
    billed_through: null,
  },
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
    billed_through: "2026-08-07",
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
  orgMtd: {
    billed_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    as_of: null,
    billed_through: null,
  },
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
    // No em-dash placeholders anywhere Lore data reaches — the Anthropic
    // sections are absent rather than degraded, which is the point of this
    // test. The balance card is the one exception and is not one of these: no
    // amount of Lore data can fill it, because Anthropic publishes no credit
    // balance, so an unrecorded one has nothing to degrade FROM.
    const balance = screen.getByRole("heading", { name: "Balance", level: 2 })
      .nextElementSibling as HTMLElement;
    const placeholders = screen.queryAllByText("—");

    expect(placeholders).toHaveLength(1);
    expect(balance.contains(placeholders[0])).toBe(true);
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

  it("brings the billed card current with today's Lore-computed spend, labeled", () => {
    render(
      <SpendView
        {...withAdminKey}
        loreUnbilledUsd={1.95}
        loreUnbilledDays={1}
      />,
    );

    const note = screen.getByText(/billed through/);

    expect(note.textContent).toContain(usd(1.95));
    expect(note.textContent).toContain("today (Lore-computed)");
  });

  it("omits the unbilled line when the unbilled Lore-computed spend is zero", () => {
    render(
      <SpendView {...withAdminKey} loreUnbilledUsd={0} loreUnbilledDays={0} />,
    );

    expect(screen.queryByText(/billed through/)).not.toBeInTheDocument();
  });

  it("shows no unbilled line without billed data even when there is spend", () => {
    render(
      <SpendView {...empty} loreUnbilledUsd={1.95} loreUnbilledDays={1} />,
    );

    expect(screen.queryByText(/billed through/)).not.toBeInTheDocument();
  });

  it("names the last billed day and the whole span when two days are unbilled", () => {
    // The reported case: the sync stamped 8/19 but its buckets ended at 8/18,
    // so 8/19 AND 8/20 were unbilled while the card claimed only today's
    // $11.95 was missing — understating the gap by a full day's spend.
    render(
      <SpendView
        {...withAdminKey}
        loreUnbilledUsd={47.74}
        loreUnbilledDays={2}
      />,
    );

    const note = screen.getByText(/billed through/);

    expect(note.textContent).toContain(usd(47.74));
    expect(note.textContent).toContain("over 2 days since");
    expect(note.textContent).not.toContain("today (Lore-computed)");
  });

  it("dates the billed-through day in local time, not the UTC instant", () => {
    // `new Date("2026-08-07")` is UTC midnight, which renders as the 6th for
    // every viewer west of Greenwich: an off-by-one day inside the fix for an
    // off-by-one day.
    render(
      <SpendView
        {...withAdminKey}
        loreUnbilledUsd={1.95}
        loreUnbilledDays={1}
      />,
    );

    expect(screen.getByText(/billed through/).textContent).toContain(
      new Date(2026, 7, 7).toLocaleDateString(),
    );
  });

  it("falls back to the undated wording when nothing has ever been billed", () => {
    render(
      <SpendView
        {...withAdminKey}
        orgMtd={{ ...withAdminKey.orgMtd, billed_through: null }}
        loreUnbilledUsd={47.74}
        loreUnbilledDays={2}
      />,
    );

    const note = screen.getByText(/not yet billed/);

    expect(note.textContent).toContain(usd(47.74));
  });

  const budget = {
    ledger_total_usd: 500,
    spent_since_usd: 312.5,
    remaining_usd: 187.5,
    anchored_at: "2026-08-01",
  };

  const balanceCard = () =>
    screen.getByRole("heading", { name: "Balance", level: 2 })
      .nextElementSibling as HTMLElement;

  it("renders the remaining balance above the month-to-date figures", () => {
    // Position is the point: "how much is left" is what the page is opened
    // for, and everything below it is context for that one number.
    render(<SpendView {...loreOnly} budget={budget} />);

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);

    expect(headings.indexOf("Balance")).toBeLessThan(
      headings.indexOf("Month to Date"),
    );
    expect(within(balanceCard()).getByText(usd(187.5))).toBeTruthy();
  });

  it("shows the recorded total, the spend and the day the count starts", () => {
    render(<SpendView {...loreOnly} budget={budget} />);

    const note = within(balanceCard()).getByText(/recorded/);

    expect(note.textContent).toContain(usd(500));
    expect(note.textContent).toContain(usd(312.5));
    expect(note.textContent).toContain(day("2026-08-01"));
  });

  it("shows an em dash and a prompt when no balance has been recorded", () => {
    // Never "$0.00": an unrecorded balance and an exhausted one are different
    // facts, and only one of them is a number.
    render(<SpendView {...loreOnly} />);

    const card = balanceCard();

    expect(within(card).getByText("—")).toBeTruthy();
    expect(within(card).queryByText(usd(0))).toBeNull();
    expect(within(card).getByText(/No balance recorded yet/)).toBeTruthy();
  });

  it("says the balance is overrun when spend has passed it", () => {
    render(
      <SpendView
        {...loreOnly}
        budget={{ ...budget, spent_since_usd: 545, remaining_usd: -45 }}
      />,
    );

    const card = balanceCard();

    expect(within(card).getByText(usd(-45))).toBeTruthy();
    expect(within(card).getByText(/already over the recorded balance/));
  });
});

describe("budgetOutlook", () => {
  const budget = {
    ledger_total_usd: 500,
    spent_since_usd: 300,
    remaining_usd: 200,
    anchored_at: "2026-08-01",
  };

  it("averages spend over the days elapsed since the anchor, inclusive", () => {
    // 8/01 through 8/10 is ten days, not nine: the anchor day itself counts,
    // otherwise a balance recorded this morning divides by zero.
    expect(budgetOutlook(budget, new Date(2026, 7, 10))).toEqual({
      burnPerDay: 30,
      daysLeft: 6,
    });
  });

  it("counts a single day when the balance was recorded today", () => {
    expect(budgetOutlook(budget, new Date(2026, 7, 1))).toMatchObject({
      burnPerDay: 300,
    });
  });

  it("returns null when nothing has been spent yet", () => {
    // No rate to project from. A zero burn would divide into infinity days,
    // which renders as a confident promise nobody made.
    expect(
      budgetOutlook({ ...budget, spent_since_usd: 0 }, new Date(2026, 7, 10)),
    ).toBeNull();
  });

  it("returns null when the anchor is in the future", () => {
    expect(budgetOutlook(budget, new Date(2026, 6, 20))).toBeNull();
  });

  it("reports zero days left when the balance is already overrun", () => {
    expect(
      budgetOutlook(
        { ...budget, spent_since_usd: 600, remaining_usd: -100 },
        new Date(2026, 7, 10),
      ),
    ).toMatchObject({ daysLeft: 0 });
  });
});

describe("SpendView top-up form", () => {
  const recordAction = async () => ({});

  it("asks for the opening balance when no balance is recorded", () => {
    // Mounting matters as much as the wording: the form is the one client
    // component on an otherwise server-rendered page, and a broken boundary
    // shows up here rather than at runtime.
    render(<SpendView {...loreOnly} recordAction={recordAction} />);

    expect(
      screen.getByRole("button", { name: "Record balance" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Amount/)).toBeInTheDocument();
  });

  it("asks for a top-up once a balance exists", () => {
    render(
      <SpendView
        {...loreOnly}
        recordAction={recordAction}
        budget={{
          ledger_total_usd: 500,
          spent_since_usd: 100,
          remaining_usd: 400,
          anchored_at: "2026-08-01",
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Record top-up" }),
    ).toBeInTheDocument();
  });

  it("omits the form entirely when no record action is supplied", () => {
    render(<SpendView {...loreOnly} />);

    expect(screen.queryByLabelText(/Amount/)).toBeNull();
  });
});

describe("SpendView runout wording", () => {
  const withDaysLeft = (spent: number, remaining: number) => ({
    ledger_total_usd: spent + remaining,
    spent_since_usd: spent,
    remaining_usd: remaining,
    anchored_at: "2026-08-01",
  });

  it("says a day, not 1 days, on the last day of runway", () => {
    // Caught by rendering the component and reading it, not by an assertion —
    // every figure was correct and the sentence was still wrong. This is the
    // line someone reads on the day it matters most.
    render(<SpendView {...loreOnly} budget={withDaysLeft(561, 39)} />);

    expect(screen.getByText(/about a day left/)).toBeTruthy();
    expect(screen.queryByText(/1 days left/)).toBeNull();
  });

  it("pluralises every other runway length", () => {
    render(<SpendView {...loreOnly} budget={withDaysLeft(214, 386)} />);

    expect(screen.getByText(/about 37 days left/)).toBeTruthy();
  });
});

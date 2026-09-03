// @vitest-environment jsdom
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SpendView, { budgetOutlook, type SpendWindow } from "./SpendView";

const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const num = (n: number) => Number(n).toLocaleString();

const day = (isoDay: string) => {
  const [year, month, dayOfMonth] = isoDay.split("-");

  return `${dayOfMonth}-${month}-${year}`;
};

const tableByHeading = (heading: string): HTMLElement => {
  const h2 = screen.getByRole("heading", { name: heading, level: 2 });
  const table = h2.nextElementSibling as HTMLElement;

  expect(table.tagName).toBe("TABLE");

  return table;
};

const loreOnly: SpendWindow = {
  interval: { from: "2026-08-26", to: "2026-09-02" },
  llm: {
    total_usd: 37.7,
    calls: 85,
    input_tokens: 12345,
    output_tokens: 735021,
    by_blueprint: [{ blueprint: "implementation-loop", runs: 15, usd: 27.47 }],
    by_repo: [{ repo: "re-cinq/lore", usd: 80.1 }],
    by_model: [
      {
        model: "claude-sonnet-4-6",
        calls: 50,
        cost_usd: 31.73,
        input_tokens: 3372,
        output_tokens: 597948,
      },
      { model: "", calls: 3, cost_usd: 0, input_tokens: 0, output_tokens: 0 },
    ],
    by_kind: [
      { kind: "Code review / detection line", calls: 78, cost_usd: 37.68 },
      { kind: "Memory & curation", calls: 7, cost_usd: 0.02 },
    ],
    daily: [
      { bucket_date: "2026-09-01", calls: 32, cost_usd: 14.24 },
      { bucket_date: "2026-08-31", calls: 20, cost_usd: 6.75 },
    ],
    by_task_type: [
      { task_type: "implementation", tasks: 30, cost_usd: 222.22 },
    ],
    by_cluster: [],
    by_vendor: [
      { vendor: "anthropic", calls: 82, cost_usd: 24.02 },
      { vendor: "gemini", calls: 3, cost_usd: 13.68 },
    ],
  },
  billed: {
    available: false,
    total_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    as_of: null,
    billed_through: null,
    by_model: [],
    daily: [],
    unbilled_usd: 0,
    unbilled_days: 0,
  },
  budget: null,
  gcp: {
    available: false,
    total_usd: 0,
    as_of: null,
    billed_through: null,
    by_service: [],
    daily: [],
  },
  compute: {
    rates: { cpu_hour_usd: 0.022, mem_gib_hour_usd: 0.003 },
    assumed_profile: { cpu: "1", memory: "4Gi" },
    pod_hours: [
      { blueprint: "implementation-loop", pods: 9, hours: 6.5, est_usd: 0.22 },
    ],
    est_total_usd: 0.22,
    live_pods: [
      {
        name: "agent-job-run1-tdd-round-abc",
        phase: "Running",
        started_at: "2026-09-02T11:00:00.000Z",
        requests: { cpu: "1", memory: "16Gi" },
        usd_per_hour: 0.07,
        usd_so_far: 0.07,
        station_run_id: "sr-1",
      },
    ],
    live_usd_per_hour: 0.07,
  },
};

const withAdminKey: SpendWindow = {
  ...loreOnly,
  billed: {
    available: true,
    total_usd: 1234.5,
    input_tokens: 1000000,
    output_tokens: 50000,
    as_of: "2026-09-02T10:00:00.000Z",
    billed_through: "2026-09-01",
    by_model: [
      {
        model: "claude-opus-4",
        cost_usd: 900.25,
        input_tokens: 1000000,
        output_tokens: 50000,
      },
      { model: "", cost_usd: 12.75, input_tokens: 0, output_tokens: 0 },
    ],
    daily: [{ bucket_date: "2026-09-01", cost_usd: 400.1 }],
    unbilled_usd: 0,
    unbilled_days: 0,
  },
};

const withGcpBilling: SpendWindow = {
  ...loreOnly,
  gcp: {
    available: true,
    total_usd: 210.4,
    as_of: "2026-09-02T08:00:00.000Z",
    billed_through: "2026-09-01",
    by_service: [
      { service: "Kubernetes Engine", cost_usd: 180.2 },
      { service: "Networking", cost_usd: 12.6 },
    ],
    daily: [{ bucket_date: "2026-09-01", cost_usd: 30.5 }],
  },
};

const unbilled = (spend: SpendWindow, usdValue: number, days: number) => ({
  ...spend,
  billed: { ...spend.billed, unbilled_usd: usdValue, unbilled_days: days },
});

const empty: SpendWindow = {
  ...loreOnly,
  llm: {
    ...loreOnly.llm,
    total_usd: 0,
    calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    by_blueprint: [],
    by_repo: [],
    by_model: [],
    by_kind: [],
    daily: [],
    by_task_type: [],
    by_cluster: [],
  },
  compute: {
    ...loreOnly.compute,
    pod_hours: [],
    est_total_usd: 0,
    live_pods: [],
    live_usd_per_hour: 0,
  },
};

describe("SpendView", () => {
  it("renders every interval-scoped section heading with no month-to-date scope", () => {
    render(<SpendView spend={loreOnly} />);

    for (const name of [
      "Balance",
      "LLM by Assembly Line",
      "Cost by Model",
      "Cost by Kind",
      "Daily Cost",
      "Cost by Repo",
      "Cost by Task Type",
      "Cost by Cluster",
      "Pods Running Now",
      "Pod-Hours in Interval",
    ]) {
      expect(
        screen.getByRole("heading", { name, level: 2 }),
      ).toBeInTheDocument();
    }
    expect(screen.queryByText(/Month to Date|MTD|This Month/)).toBeNull();
  });

  it("headlines the interval, the Lore-computed cost, calls and token totals", () => {
    render(<SpendView spend={loreOnly} />);
    expect(
      screen.getByText(
        `Lore-computed cost ${day("2026-08-26")} → ${day("2026-09-02")}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(usd(37.7))).toBeInTheDocument();
    expect(screen.getByText("estimate from token counts")).toBeInTheDocument();
    expect(screen.getByText(num(85))).toBeInTheDocument();
    expect(screen.getByText(num(12345))).toBeInTheDocument();
    expect(screen.getByText(num(735021))).toBeInTheDocument();
  });

  it("renders the Kubernetes estimate card with the live burn rate", () => {
    render(<SpendView spend={loreOnly} />);
    expect(screen.getByText("Kubernetes (estimated)")).toBeInTheDocument();
    expect(
      screen.getByText(`+ ${usd(0.07)}/h burning now`),
    ).toBeInTheDocument();
  });

  it("renders the assembly-line, live-pod and pod-hours breakdowns with the rate note", () => {
    render(<SpendView spend={loreOnly} />);
    expect(
      within(tableByHeading("LLM by Assembly Line")).getByText(usd(27.47)),
    ).toBeInTheDocument();
    expect(
      screen.getByText("agent-job-run1-tdd-round-abc"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("implementation-loop")).toHaveLength(2);
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          /estimate from resource requests × on-demand rates \(\$0\.022\/cpu-h/.test(
            element.textContent ?? "",
          ),
      ),
    ).toBeInTheDocument();
  });

  it("renders the Google Cloud billed card with the net total and its closed-through day", () => {
    render(<SpendView spend={withGcpBilling} />);
    expect(screen.getByText("Google Cloud (billed)")).toBeInTheDocument();
    expect(screen.getByText(usd(210.4))).toBeInTheDocument();
    expect(
      screen.getByText(`billed through ${day("2026-09-01")} — net of credits`),
    ).toBeInTheDocument();
  });

  it("renders the GCP by-service and daily billed tables from the export", () => {
    render(<SpendView spend={withGcpBilling} />);
    const byService = tableByHeading("GCP Billed by Service");

    expect(
      within(byService).getByText("Kubernetes Engine"),
    ).toBeInTheDocument();
    expect(within(byService).getByText(usd(180.2))).toBeInTheDocument();
    expect(within(byService).getByText("Networking")).toBeInTheDocument();

    const daily = tableByHeading("GCP Daily Billed");

    expect(within(daily).getByText(day("2026-09-01"))).toBeInTheDocument();
    expect(within(daily).getByText(usd(30.5))).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          /the Google Cloud \(billed\) figures above are that invoice\./.test(
            element.textContent ?? "",
          ),
      ),
    ).toBeInTheDocument();
  });

  it("hides the GCP card and sections until the billing export has synced", () => {
    render(<SpendView spend={loreOnly} />);
    expect(screen.queryByText("Google Cloud (billed)")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "GCP Billed by Service" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "GCP Daily Billed" }),
    ).not.toBeInTheDocument();
  });

  it("says so when no run pods are live", () => {
    render(<SpendView spend={empty} />);
    expect(
      screen.getByText("No run pods are live right now."),
    ).toBeInTheDocument();
  });

  it("renders cost-by-model rows, including the (non-token) fallback label", () => {
    render(<SpendView spend={loreOnly} />);
    const table = tableByHeading("Cost by Model");

    expect(within(table).getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(within(table).getByText("(non-token)")).toBeInTheDocument();
    expect(within(table).getByText(usd(31.73))).toBeInTheDocument();
    expect(within(table).getByText(num(597948))).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(3);
  });

  it("renders cost-by-kind rows attributing spend to reviews vs tasks", () => {
    render(<SpendView spend={loreOnly} />);
    const table = tableByHeading("Cost by Kind");

    expect(
      within(table).getByText("Code review / detection line"),
    ).toBeInTheDocument();
    expect(within(table).getByText(num(78))).toBeInTheDocument();
    expect(within(table).getByText(usd(37.68))).toBeInTheDocument();
    expect(within(table).getByText("Memory & curation")).toBeInTheDocument();
  });

  it("renders daily cost rows with localized dates and call counts", () => {
    render(<SpendView spend={loreOnly} />);
    const table = tableByHeading("Daily Cost");

    expect(within(table).getByText(day("2026-09-01"))).toBeInTheDocument();
    expect(within(table).getByText(usd(14.24))).toBeInTheDocument();
    expect(within(table).getByText(num(32))).toBeInTheDocument();
  });

  it("renders by-repo and by-task-type rows", () => {
    render(<SpendView spend={loreOnly} />);
    expect(
      within(tableByHeading("Cost by Repo")).getByText("re-cinq/lore"),
    ).toBeInTheDocument();
    const byType = tableByHeading("Cost by Task Type");

    expect(within(byType).getByText("implementation")).toBeInTheDocument();
    expect(within(byType).getByText(usd(222.22))).toBeInTheDocument();
  });

  it("hides the billed card and Anthropic sections without an admin key", () => {
    render(<SpendView spend={loreOnly} />);
    expect(
      screen.queryByText("Billed cost (Anthropic)"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Anthropic Billed by Model" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Anthropic Daily Billed" }),
    ).not.toBeInTheDocument();
    const balance = screen.getByRole("heading", { name: "Balance", level: 2 })
      .nextElementSibling as HTMLElement;
    const placeholders = screen.queryAllByText("—");

    expect(placeholders).toHaveLength(1);
    expect(balance.contains(placeholders[0])).toBe(true);
  });

  it("shows the billed card and Anthropic sections when an admin key is configured", () => {
    render(<SpendView spend={withAdminKey} />);
    expect(screen.getByText("Billed cost (Anthropic)")).toBeInTheDocument();
    expect(screen.getByText(usd(1234.5))).toBeInTheDocument();
    const asOf = screen.getByText(/^as of /).textContent ?? "";

    expect(asOf).toMatch(/^as of \d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);
    expect(asOf).toContain("-09-2026");
    expect(asOf).not.toContain("/");
    expect(
      within(tableByHeading("Anthropic Billed by Model")).getByText(
        "claude-opus-4",
      ),
    ).toBeInTheDocument();
    expect(
      within(tableByHeading("Anthropic Daily Billed")).getByText(usd(400.1)),
    ).toBeInTheDocument();
  });

  it("shows empty-state rows for every table when there is no data", () => {
    render(<SpendView spend={empty} />);
    expect(screen.getAllByText("No data")).toHaveLength(5);
    expect(screen.getByText("No run-attributed spend")).toBeInTheDocument();
    expect(screen.getByText("No task-attributed spend")).toBeInTheDocument();
    expect(screen.getByText("No cluster-attributed spend")).toBeInTheDocument();
  });

  it("brings the billed card current with today's Lore-computed spend, labeled", () => {
    render(<SpendView spend={unbilled(withAdminKey, 1.95, 1)} />);

    const note = screen.getByText(/billed through/);

    expect(note.textContent).toContain(usd(1.95));
    expect(note.textContent).toContain("today (Lore-computed)");
  });

  it("omits the unbilled line when the unbilled Lore-computed spend is zero", () => {
    render(<SpendView spend={withAdminKey} />);

    expect(screen.queryByText(/billed through/)).not.toBeInTheDocument();
  });

  it("shows no unbilled line without billed data even when there is spend", () => {
    render(<SpendView spend={unbilled(loreOnly, 1.95, 1)} />);

    expect(screen.queryByText(/billed through/)).not.toBeInTheDocument();
  });

  it("names the last billed day and the whole span when two days are unbilled", () => {
    render(<SpendView spend={unbilled(withAdminKey, 47.74, 2)} />);

    const note = screen.getByText(/billed through/);

    expect(note.textContent).toContain(usd(47.74));
    expect(note.textContent).toContain("over 2 days since");
    expect(note.textContent).not.toContain("today (Lore-computed)");
  });

  it("dates the billed-through day in local time, not the UTC instant", () => {
    render(<SpendView spend={unbilled(withAdminKey, 1.95, 1)} />);

    expect(screen.getByText(/billed through/).textContent).toContain(
      "01-09-2026",
    );
  });

  it("falls back to the undated wording when nothing has ever been billed", () => {
    render(
      <SpendView
        spend={{
          ...unbilled(withAdminKey, 47.74, 2),
          billed: {
            ...unbilled(withAdminKey, 47.74, 2).billed,
            billed_through: null,
          },
        }}
      />,
    );

    const note = screen.getByText(/not yet billed/);

    expect(note.textContent).toContain(usd(47.74));
  });

  const budget = {
    ledger_total_usd: 500,
    spent_since_usd: 312.5,
    remaining_usd: 187.5,
    anchored_at: "2026-08-01T00:00:00Z",
  };

  const balanceCard = () =>
    screen.getByRole("heading", { name: "Balance", level: 2 })
      .nextElementSibling as HTMLElement;

  it("renders the remaining balance below the interval figures", () => {
    render(<SpendView spend={{ ...loreOnly, budget }} />);

    expect(within(balanceCard()).getByText(usd(187.5))).toBeTruthy();
  });

  it("shows the recorded total, the spend and the day the count starts", () => {
    render(<SpendView spend={{ ...loreOnly, budget }} />);

    const note = within(balanceCard()).getByText(/recorded/);

    expect(note.textContent).toContain(usd(500));
    expect(note.textContent).toContain(usd(312.5));
    expect(note.textContent).toContain(day("2026-08-01"));
  });

  it("shows an em dash and a prompt when no balance has been recorded", () => {
    render(<SpendView spend={loreOnly} />);

    const card = balanceCard();

    expect(within(card).getByText("—")).toBeTruthy();
    expect(within(card).queryByText(usd(0))).toBeNull();
    expect(within(card).getByText(/No balance recorded yet/)).toBeTruthy();
  });

  it("says the balance is overrun when spend has passed it", () => {
    render(
      <SpendView
        spend={{
          ...loreOnly,
          budget: { ...budget, spent_since_usd: 545, remaining_usd: -45 },
        }}
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
    anchored_at: "2026-08-01T00:00:00Z",
  };

  it("averages spend over the days elapsed since the anchor, inclusive", () => {
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
    render(<SpendView spend={loreOnly} recordAction={recordAction} />);

    expect(
      screen.getByRole("button", { name: "Record balance" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Amount/)).toBeInTheDocument();
  });

  it("asks for a top-up once a balance exists", () => {
    render(
      <SpendView
        spend={{
          ...loreOnly,
          budget: {
            ledger_total_usd: 500,
            spent_since_usd: 100,
            remaining_usd: 400,
            anchored_at: "2026-08-01T00:00:00Z",
          },
        }}
        recordAction={recordAction}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Record top-up" }),
    ).toBeInTheDocument();
  });

  it("omits the form entirely when no record action is supplied", () => {
    render(<SpendView spend={loreOnly} />);

    expect(screen.queryByLabelText(/Amount/)).toBeNull();
  });
});

describe("SpendView runout wording", () => {
  const NOW = new Date("2026-08-21T00:00:00Z");

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  const withDaysLeft = (spent: number, remaining: number) => ({
    ...loreOnly,
    budget: {
      ledger_total_usd: spent + remaining,
      spent_since_usd: spent,
      remaining_usd: remaining,
      anchored_at: "2026-08-01T00:00:00Z",
    },
  });

  it("says a day, not 1 days, on the last day of runway", () => {
    render(<SpendView spend={withDaysLeft(561, 39)} />);

    expect(screen.getByText(/about a day left/)).toBeTruthy();
    expect(screen.queryByText(/1 days left/)).toBeNull();
  });

  it("pluralises every other runway length", () => {
    render(<SpendView spend={withDaysLeft(214, 386)} />);

    expect(screen.getByText(/about 37 days left/)).toBeTruthy();
  });
});

describe("SpendView anchor precision", () => {
  const at = (anchored_at: string) => ({
    ...loreOnly,
    budget: {
      ledger_total_usd: 600,
      spent_since_usd: 214,
      remaining_usd: 386,
      anchored_at,
    },
  });

  it("shows no clock when the balance anchors to the start of its day", () => {
    render(<SpendView spend={at("2026-08-01T00:00:00Z")} />);

    const note = screen.getByText(/recorded/);

    expect(note.textContent).toContain(day("2026-08-01"));
    expect(note.textContent).not.toContain("00:00");
  });

  it("shows the clock when the balance anchors to a known moment", () => {
    render(<SpendView spend={at("2026-08-01T14:30:00Z")} />);

    expect(screen.getByText(/14:30 UTC/)).toBeTruthy();
  });

  it("measures elapsed days from the anchor's day, not from its clock", () => {
    expect(
      budgetOutlook(at("2026-08-01T14:30:00Z").budget, new Date(2026, 7, 10)),
    ).toEqual(
      budgetOutlook(at("2026-08-01T00:00:00Z").budget, new Date(2026, 7, 10)),
    );
  });
});

describe("SpendView top-up legend", () => {
  const recordAction = async () => ({});

  it("states that a blank date counts from the start of today", () => {
    render(<SpendView spend={loreOnly} recordAction={recordAction} />);

    expect(
      screen.getByText(/Leave both blank to count from the start of today/),
    ).toBeTruthy();
    expect(screen.queryByText(/defaults to today/)).toBeNull();
  });

  it("explains which entry moves the counting window", () => {
    render(<SpendView spend={loreOnly} recordAction={recordAction} />);

    const legend = screen.getByText(/Which entry moves the window/)
      .nextElementSibling as HTMLElement;

    expect(legend.textContent).toMatch(/Only the opening entry/);
    expect(legend.textContent).toMatch(/recording one days late/);
  });

  it("explains that a negative amount is a correction", () => {
    render(<SpendView spend={loreOnly} recordAction={recordAction} />);

    const legend = screen.getByText("Amount").nextElementSibling as HTMLElement;

    expect(legend.textContent).toMatch(
      /negative amount is recorded as a correction/,
    );
  });

  it("omits the legend along with the form when no record action is supplied", () => {
    render(<SpendView spend={loreOnly} />);

    expect(screen.queryByText(/Which entry moves the window/)).toBeNull();
  });
});

describe("SpendView cost by cluster", () => {
  const withClusters = {
    ...loreOnly,
    llm: {
      ...loreOnly.llm,
      by_cluster: [
        { cluster: "colleague-satellite", calls: 12, cost_usd: 88.5 },
        { cluster: null, calls: 40, cost_usd: 20 },
      ],
    },
  };

  it("renders a cost-by-cluster row per execution cluster", () => {
    render(<SpendView spend={withClusters} />);
    const table = tableByHeading("Cost by Cluster");

    expect(within(table).getByText("colleague-satellite")).toBeInTheDocument();
    expect(within(table).getByText("(no cluster)")).toBeInTheDocument();
    expect(within(table).getByText(usd(88.5))).toBeInTheDocument();
    expect(within(table).getByText(num(12))).toBeInTheDocument();
  });

  it("notes that satellite spend is excluded from the balance only when a cluster exists", () => {
    render(<SpendView spend={withClusters} />);
    expect(screen.getByText(/excluded from this balance/)).toBeInTheDocument();
  });

  it("omits the satellite note and shows an empty state without cluster rows", () => {
    render(<SpendView spend={loreOnly} />);

    expect(screen.queryByText(/excluded from this balance/)).toBeNull();
    expect(
      within(tableByHeading("Cost by Cluster")).getByText(
        "No cluster-attributed spend",
      ),
    ).toBeInTheDocument();
  });
});

describe("SpendView cost-per-run and vendor split", () => {
  it("shows what one run of each assembly line costs", () => {
    render(<SpendView spend={loreOnly} />);
    const table = tableByHeading("LLM by Assembly Line");

    expect(within(table).getByText(usd(27.47 / 15))).toBeInTheDocument();
  });

  it("splits metered spend by the account each vendor bills, and says only Anthropic draws the balance", () => {
    render(<SpendView spend={loreOnly} />);
    const table = tableByHeading("Cost by Vendor");

    expect(within(table).getByText("anthropic")).toBeInTheDocument();
    expect(within(table).getByText(usd(24.02))).toBeInTheDocument();
    expect(within(table).getByText("gemini")).toBeInTheDocument();
    expect(within(table).getByText(usd(13.68))).toBeInTheDocument();
    expect(
      screen.getByText(/Only Anthropic spend draws the balance above/),
    ).toBeInTheDocument();
  });

  it("omits the vendor note when every call billed Anthropic", () => {
    const anthropicOnly = {
      ...loreOnly,
      llm: {
        ...loreOnly.llm,
        by_vendor: [{ vendor: "anthropic", calls: 85, cost_usd: 37.7 }],
      },
    };

    render(<SpendView spend={anthropicOnly} />);
    expect(
      screen.queryByText(/Only Anthropic spend draws the balance above/),
    ).not.toBeInTheDocument();
  });
});

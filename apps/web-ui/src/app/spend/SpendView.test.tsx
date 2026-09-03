// @vitest-environment jsdom
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SpendView, { budgetOutlook, type SpendWindow } from "./SpendView";

const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const num = (n: number) => Number(n).toLocaleString();

/** Mirrors the view's own `day`, for the reason stated there: parsing a
 *  `YYYY-MM-DD` string as a Date makes it UTC midnight, which is the previous
 *  day for every viewer west of Greenwich. */
const day = (isoDay: string) => {
  const [y, m, d] = isoDay.split("-");

  return `${d}-${m}-${y}`;
};

const tableByHeading = (heading: string): HTMLElement => {
  const h2 = screen.getByRole("heading", { name: heading, level: 2 });
  const table = h2.nextElementSibling as HTMLElement;

  expect(table.tagName).toBe("TABLE");

  return table;
};

// The no-admin-key case (billed unavailable) with full Lore-computed data.
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

// Same data plus a configured admin key (the optional billed sections light up).
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

// Same data plus a synced billing export (the optional GCP sections light up).
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
    // The merge's whole point: nothing on the page is month-to-date any more.
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
    // Twice: the LLM table and the pod-hours table each carry the line.
    expect(screen.getAllByText("implementation-loop")).toHaveLength(2);
    // The estimate is labeled as one, with the rates it assumed.
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
    // The estimate's disclaimer now points at the invoice it defers to.
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
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header + 2
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
    render(<SpendView spend={withAdminKey} />);
    expect(screen.getByText("Billed cost (Anthropic)")).toBeInTheDocument();
    expect(screen.getByText(usd(1234.5))).toBeInTheDocument();
    // Asserted by SHAPE, not by rebuilding the string the way the view does:
    // a mirrored helper would agree with any format change and catch nothing.
    // Hardcoding the rendered text is no good either — the stamp is a real
    // instant shown in local time, so `10:00Z` reads 10:00 on CI (UTC) and
    // 12:00 in Amsterdam, and the assertion would only hold in one timezone.
    // The month and year survive any real offset, and the slash is the tell
    // that someone reverted to `toLocaleString`.
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
    // assembly line + model + kind + daily + pod-hours
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
    // The reported case: the sync stamped 8/19 but its buckets ended at 8/18,
    // so 8/19 AND 8/20 were unbilled while the card claimed only today's
    // spend was missing — understating the gap by a full day's spend.
    render(<SpendView spend={unbilled(withAdminKey, 47.74, 2)} />);

    const note = screen.getByText(/billed through/);

    expect(note.textContent).toContain(usd(47.74));
    expect(note.textContent).toContain("over 2 days since");
    expect(note.textContent).not.toContain("today (Lore-computed)");
  });

  it("dates the billed-through day in local time, not the UTC instant", () => {
    // `new Date("2026-09-01")` is UTC midnight, which renders as 31-08 for
    // every viewer west of Greenwich: an off-by-one day inside the fix for an
    // off-by-one day. Formatted from the string's parts, so no Date is built
    // and no timezone can shift it.
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
    // Position is deliberate: the balance is spend subtracted from what was
    // recorded, so it reads better after those figures than before them.
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
    // Never "$0.00": an unrecorded balance and an exhausted one are different
    // facts, and only one of them is a number.
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
  // The runway is burn rate over the window from the anchor to NOW, so with a
  // fixed anchor and a real clock the expected sentence changes by one day every
  // day: these assertions went red on main at a date rollover, with no code
  // change (#1475). Freezing the clock makes the window the fixture, not the
  // calendar.
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
    // Caught by rendering the component and reading it, not by an assertion —
    // every figure was correct and the sentence was still wrong. This is the
    // line someone reads on the day it matters most.
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
    // Printing "00:00" would dress a deliberate approximation up as a
    // measurement: a day without a known time counts the WHOLE day.
    render(<SpendView spend={at("2026-08-01T00:00:00Z")} />);

    const note = screen.getByText(/recorded/);

    expect(note.textContent).toContain(day("2026-08-01"));
    expect(note.textContent).not.toContain("00:00");
  });

  it("shows the clock when the balance anchors to a known moment", () => {
    // An opening entered at 14:30 on an already-spending day: the precision is
    // real, so it is stated rather than implied.
    render(<SpendView spend={at("2026-08-01T14:30:00Z")} />);

    expect(screen.getByText(/14:30 UTC/)).toBeTruthy();
  });

  it("measures elapsed days from the anchor's day, not from its clock", () => {
    // The outlook divides by whole days; an afternoon anchor must not parse to
    // NaN, which is what splitting an ISO instant on "-" used to produce.
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
    // The wording this replaces said "defaults to today", which a reader could
    // equally take as "defaults to now" — and those anchor the arithmetic at
    // opposite ends of a day's spend.
    render(<SpendView spend={loreOnly} recordAction={recordAction} />);

    expect(
      screen.getByText(/Leave both blank to count from the start of today/),
    ).toBeTruthy();
    // The wording it replaces, which read equally as "defaults to now".
    expect(screen.queryByText(/defaults to today/)).toBeNull();
  });

  it("explains which entry moves the counting window", () => {
    // Counter-intuitive enough to have been got wrong during this feature's
    // own review, so it is stated on the form rather than inferred.
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

    // 15 runs of implementation-loop at $27.47 — the figure that says whether
    // a model switch paid off, which the total alone hides.
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

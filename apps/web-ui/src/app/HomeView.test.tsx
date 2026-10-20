// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import HomeView, { type Repo } from "./HomeView";
import { type IngestWorkflowStatus } from "@/lib/ingest-workflow";
import { type RepoFilter } from "./HomeView.filters";

vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => <i data-testid={`icon-${name}`} />,
}));

const repo = (over: Partial<Repo>): Repo => ({
  full_name: "re-cinq/lore",
  owner: "re-cinq",
  name: "lore",
  team: null,
  onboarded_at: "2026-01-01T00:00:00Z",
  last_ingested_at: new Date().toISOString(),
  onboarding_pr_merged: true,
  task_count: 0,
  active_agents: 0,
  ...over,
});

const statValue = (label: string) =>
  screen
    .getByText(label, { selector: "dt" })
    .parentElement!.querySelector("dd");

vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-01-01") });
const action = vi.fn();

interface HomeOptions {
  impactMisaligned?: string[];
  filter?: RepoFilter;
}

const renderHome = (
  repos: Repo[],
  status: Record<string, IngestWorkflowStatus> = {},
  misaligned: string[] = [],
  { impactMisaligned = [], filter }: HomeOptions = {},
) =>
  render(
    <HomeView
      repos={repos}
      ingestStatus={new Map(Object.entries(status))}
      misaligned={misaligned}
      fixIngestWorkflows={action}
      impactMisaligned={impactMisaligned}
      fixTraceImpactWorkflows={action}
      filter={filter}
    />,
  );

describe("HomeView", () => {
  it("renders one card per repo with the full name", () => {
    renderHome([
      repo({ full_name: "re-cinq/lore", name: "lore" }),
      repo({ full_name: "re-cinq/atlas", name: "atlas" }),
    ]);
    expect(
      screen.getByRole("heading", { level: 3, name: /re-cinq\/lore/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: /re-cinq\/atlas/ }),
    ).toBeInTheDocument();
  });

  it("links each card to the repo overview page", () => {
    renderHome([repo({ owner: "re-cinq", name: "lore" })]);
    const card = screen
      .getByRole("heading", { level: 3, name: /re-cinq\/lore/ })
      .closest("a");

    expect(card).toHaveAttribute("href", "/repos/re-cinq/lore");
  });

  it("shows the empty state when there are no repos", () => {
    renderHome([]);
    expect(
      screen.getByText("No repositories onboarded yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Add your first repo" }),
    ).toHaveAttribute("href", "/onboard");
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });

  it("always renders the + Add Repo link to onboard", () => {
    renderHome([]);
    expect(screen.getByRole("link", { name: /Add repo/ })).toHaveAttribute(
      "href",
      "/onboard",
    );
  });

  it("renders the team badge and task count when a team is set", () => {
    renderHome([repo({ team: "platform", task_count: 7 })]);
    expect(screen.getByText("platform")).toBeInTheDocument();
    expect(statValue("Tasks")).toHaveTextContent("7");
  });

  it("omits the team badge when team is null", () => {
    renderHome([repo({ team: null })]);
    expect(screen.queryByText("platform")).not.toBeInTheDocument();
  });

  it("renders the running-agents badge when active_agents is positive", () => {
    renderHome([repo({ active_agents: 3 })]);
    expect(screen.getByTitle("3 running")).toBeInTheDocument();
    expect(statValue("Agents running")).toHaveTextContent("3");
  });

  it("omits the running-agents badge when active_agents is zero", () => {
    renderHome([repo({ active_agents: 0 })]);
    expect(screen.queryByTitle(/running/)).not.toBeInTheDocument();
  });

  it("renders the missing-workflow badge for a repo with missing ingest status", () => {
    renderHome([repo({ full_name: "re-cinq/lore" })], {
      "re-cinq/lore": "missing",
    });
    expect(screen.getByText("No ingest workflow")).toBeInTheDocument();
  });

  it("renders the stale-workflow badge for a repo with stale ingest status", () => {
    renderHome([repo({ full_name: "re-cinq/lore" })], {
      "re-cinq/lore": "stale",
    });
    expect(screen.getByText("Ingest workflow outdated")).toBeInTheDocument();
  });

  it("renders no workflow badge for aligned or unknown ingest status", () => {
    renderHome([repo({ full_name: "re-cinq/lore" })], {
      "re-cinq/lore": "aligned",
    });
    expect(screen.queryByText(/ingest workflow/i)).not.toBeInTheDocument();
  });

  it("shows the last-ingested date when last_ingested_at is present", () => {
    const card = repo({
      full_name: "re-cinq/lore",
      last_ingested_at: "2026-05-01T12:00:00Z",
    });

    renderHome([card]);
    const expected = `Last ingested ${new Date("2026-05-01T12:00:00Z").toLocaleDateString()}`;

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("shows awaiting-ingestion when never ingested but PR merged", () => {
    renderHome([repo({ last_ingested_at: null, onboarding_pr_merged: true })]);
    expect(
      screen.getByText("Onboarded, awaiting ingestion"),
    ).toBeInTheDocument();
  });

  it("shows pending-PR when never ingested and PR not merged", () => {
    renderHome([repo({ last_ingested_at: null, onboarding_pr_merged: false })]);
    expect(screen.getByText("Onboarding PR pending")).toBeInTheDocument();
  });

  it("uses the fresh freshness indicator for a recent ingest", () => {
    renderHome([
      repo({
        full_name: "re-cinq/lore",
        last_ingested_at: new Date().toISOString(),
      }),
    ]);
    const dot = screen.getByTitle("Fresh (< 24h)");

    expect(dot.style.getPropertyValue("--dot-color")).toBe("var(--success)");
  });

  it("uses the stale freshness indicator for an ingest within a week", () => {
    const threeDaysAgo = new Date(
      Date.now() - 3 * 24 * 60 * 60 * 1000,
    ).toISOString();

    renderHome([
      repo({ full_name: "re-cinq/lore", last_ingested_at: threeDaysAgo }),
    ]);
    expect(
      screen.getByTitle("Stale (< 7d)").style.getPropertyValue("--dot-color"),
    ).toBe("var(--warning)");
  });

  it("uses the outdated freshness indicator for an ingest older than a week", () => {
    const tenDaysAgo = new Date(
      Date.now() - 10 * 24 * 60 * 60 * 1000,
    ).toISOString();

    renderHome([
      repo({ full_name: "re-cinq/lore", last_ingested_at: tenDaysAgo }),
    ]);
    expect(
      screen
        .getByTitle("Outdated (> 7d)")
        .style.getPropertyValue("--dot-color"),
    ).toBe("var(--danger)");
  });

  it("uses the never-ingested freshness indicator when last_ingested_at is null", () => {
    renderHome([repo({ full_name: "re-cinq/lore", last_ingested_at: null })]);
    expect(
      screen.getByTitle("Never ingested").style.getPropertyValue("--dot-color"),
    ).toBe("var(--text-muted)");
  });

  it("renders the Fix-ingest button wired to the injected action when repos are misaligned", () => {
    renderHome(
      [repo({ full_name: "re-cinq/lore" })],
      { "re-cinq/lore": "missing" },
      ["re-cinq/lore"],
    );
    expect(
      screen.getByRole("button", { name: "Fix ingest workflow (1)" }),
    ).toBeInTheDocument();
  });

  it("hides the Fix-ingest button when no repos are misaligned", () => {
    renderHome(
      [repo({ full_name: "re-cinq/lore" })],
      { "re-cinq/lore": "aligned" },
      [],
    );
    expect(
      screen.queryByRole("button", { name: /Fix ingest workflow/ }),
    ).not.toBeInTheDocument();
  });

  it("renders a fully-populated card with every badge present", () => {
    renderHome(
      [
        repo({
          full_name: "re-cinq/lore",
          team: "platform",
          task_count: 5,
          active_agents: 2,
        }),
      ],
      { "re-cinq/lore": "stale" },
    );
    const card = screen
      .getByRole("heading", { level: 3, name: /re-cinq\/lore/ })
      .closest("a")!;
    const scope = within(card);

    expect(scope.getByText("platform")).toBeInTheDocument();
    expect(scope.getByTitle("2 running")).toBeInTheDocument();
    expect(scope.getByText("Ingest workflow outdated")).toBeInTheDocument();
  });

  it("summarises onboarded, attention and running counts under the title", () => {
    renderHome(
      [repo({ active_agents: 2 }), repo({ full_name: "re-cinq/atlas" })],
      { "re-cinq/atlas": "missing" },
    );
    expect(
      screen.getByText("2 onboarded · 1 need attention · 2 agents running"),
    ).toBeInTheDocument();
  });

  it("flags a repo whose spec-impact workflow is outdated", () => {
    renderHome([repo({ full_name: "re-cinq/lore" })], {}, [], {
      impactMisaligned: ["re-cinq/lore"],
    });
    expect(
      screen.getByText("Spec-impact workflow outdated"),
    ).toBeInTheDocument();
  });

  it("keeps only the repos needing attention under the Needs attention chip", () => {
    renderHome(
      [
        repo({ name: "lore" }),
        repo({ full_name: "re-cinq/atlas", name: "atlas" }),
      ],
      { "re-cinq/atlas": "stale" },
      [],
      { filter: "attention" },
    );
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: /Needs attention/ }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("keeps only repos with running agents under the Agents running chip", () => {
    renderHome(
      [repo({ name: "lore", active_agents: 1 }), repo({ name: "atlas" })],
      {},
      [],
      { filter: "running" },
    );
    expect(
      screen.getByRole("heading", { level: 3, name: /lore/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /atlas/ })).toBeNull();
  });

  it("links each chip to its filter with the count it would show", () => {
    renderHome([repo({ active_agents: 1 })]);
    expect(screen.getByRole("link", { name: "All1" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      screen.getByRole("link", { name: "Agents running1" }),
    ).toHaveAttribute("href", "/?filter=running");
  });

  it("says no repo matches when a chip hides every repo", () => {
    renderHome([repo({})], {}, [], { filter: "running" });
    expect(
      screen.getByText("No repositories match this filter."),
    ).toBeInTheDocument();
  });
});

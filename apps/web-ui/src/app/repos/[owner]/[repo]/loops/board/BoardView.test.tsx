// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { ImplementationLoop, LoopTicket } from "@/lib/api/backlog";
import type { RepoLoop } from "@/lib/api/loops";
import {
  implementationNotice,
  implementationSections,
  loopBoard,
} from "./board";
import BoardView from "./BoardView";

const ticket = (over: Partial<LoopTicket> = {}): LoopTicket => ({
  issue_number: 7,
  issue_url: "https://gh/i/7",
  title: "Slow queries",
  priority: "priority:high",
  pr_url: null,
  state: "queued",
  created_at: "2026-08-01T00:00:00Z",
  hold: null,
  run_id: null,
  pipeline: null,
  ...over,
});

function renderView(over: Partial<ImplementationLoop> = {}) {
  const backlog: ImplementationLoop = {
    enabled: false,
    onboarding: { merged: true, pr_url: null, last_task: null },
    current: [],
    current_run_id: null,
    next: [],
    parked: [],
    recent: [],
    awaiting_merge: [],
    ...over,
  };
  const loop: RepoLoop = {
    key: "implementation",
    label: "Implementation loop",
    description: "",
    enabled: backlog.enabled,
  };
  const board = loopBoard(
    [
      {
        loop,
        sections: implementationSections(loop, backlog),
        backlogNotice: implementationNotice(loop),
      },
    ],
    EVERY_ROW,
  );

  return render(
    <BoardView
      board={board}
      subject="Ticket"
      showLoop={false}
      loadMore={() => "/more"}
    />,
  );
}

describe("BoardView for the implementation loop", () => {
  it("renders a mini pipeline dot per node, linked to the run", () => {
    const { getByTestId } = renderView({
      current: [
        ticket({
          state: "running",
          run_id: "run-42",
          pipeline: [
            { node_id: "implement", state: "success" },
            { node_id: "validate", state: "running" },
            { node_id: "await-pr", state: "waiting" },
            { node_id: "push", state: "exploded" },
          ],
        }),
      ],
    });

    const toneOf = (node: string) =>
      getByTestId(`mini-node-${node}`).className.match(
        /success|running|waiting|failed/,
      )?.[0];

    expect({
      href: getByTestId("mini-pipeline").getAttribute("href"),
      title: getByTestId("mini-node-implement").getAttribute("title"),
      tones: ["implement", "validate", "await-pr", "push"].map(toneOf),
    }).toEqual({
      href: "/assembly-runs/run-42",
      title: "implement: success",
      tones: ["success", "running", "waiting", "failed"],
    });
  });

  it("renders no mini pipeline for a queued ticket with no run", () => {
    const { queryByTestId } = renderView({ next: [ticket()] });

    expect(queryByTestId("mini-pipeline")).toBeNull();
  });

  it("renders worked tickets as table rows with status, ticket, stages, actions", () => {
    const { getByTestId, getByText } = renderView({
      current: [
        ticket({
          state: "running",
          run_id: "run-42",
          created_at: "2026-08-26T06:00:00Z",
          pr_url: "https://gh/pr/70",
        }),
      ],
    });

    expect({
      table: Boolean(getByTestId("board-table")),
      status: getByTestId("row-status").textContent,
      tone: getByTestId("row-status").className.includes("tone_info"),
      time: getByTestId("row-time").getAttribute("title"),
      run: getByText("Run").getAttribute("href"),
      pr: getByText("PR").getAttribute("href"),
    }).toEqual({
      table: true,
      status: "running",
      tone: true,
      time: "2026-08-26T06:00:00Z",
      run: "/assembly-runs/run-42",
      pr: "https://gh/pr/70",
    });
  });

  it("shows why the failed #7 failed and how to fix it on its row", () => {
    const { getByTestId } = renderView({
      recent: [
        ticket({
          state: "failed",
          run_id: "run-9",
          hold: {
            kind: "failed",
            message: "The last attempt failed: the run ended failed: 403.",
            fix: "Check the Lore GitHub App's repository permissions.",
          },
        }),
      ],
    });

    expect(getByTestId("row-hold-#7").textContent).toEqual(
      "The last attempt failed: the run ended failed: 403.Fix: Check the Lore GitHub App's repository permissions.",
    );
  });

  it("renders no hold on a running ticket nothing holds", () => {
    const { queryByTestId } = renderView({
      current: [ticket({ state: "running", run_id: "run-9" })],
    });

    expect(queryByTestId("row-hold-#7")).toBeNull();
  });

  it("badges an unknown task status in the danger tone", () => {
    const { getByTestId } = renderView({
      current: [ticket({ state: "haunted", created_at: null })],
    });

    expect(getByTestId("row-status").className).toContain("tone_danger");
  });

  it("says plainly when no ticket is in flight instead of an empty container", () => {
    const { getByText } = renderView();

    expect(getByText("Nothing is being worked right now.")).toBeTruthy();
  });

  it("lists two current tickets together, the loop's own pick and a by-hand-revived one", () => {
    const { getAllByTestId } = renderView({
      current: [
        ticket({ issue_number: 7, state: "running" }),
        ticket({ issue_number: 158, title: "Revived ticket", state: "failed" }),
      ],
    });

    expect(getAllByTestId("board-row")).toHaveLength(2);
  });

  it("renders the current ticket with issue and PR links", () => {
    const { getByText } = renderView({
      current: [ticket({ pr_url: "https://gh/pr/70", state: "running" })],
    });

    const issueLink = getByText("#7 Slow queries") as HTMLAnchorElement;

    expect(issueLink.href).toBe("https://gh/i/7");
    expect((getByText("PR") as HTMLAnchorElement).href).toBe(
      "https://gh/pr/70",
    );
    expect(getByText("running")).toBeTruthy();
  });

  it("renders the queue in order even while the loop is disabled", () => {
    const { container } = renderView({
      next: [
        ticket(),
        ticket({
          issue_number: 9,
          title: "Flaky test",
          priority: "priority:low",
        }),
      ],
    });

    const rows = Array.from(container.querySelectorAll("a")).map(
      (a) => a.textContent,
    );

    expect(rows).toEqual(["#7 Slow queries", "#9 Flaky test"]);
  });

  it("explains the priority labels when the backlog is empty", () => {
    const { getByText } = renderView();

    expect(getByText(/Label an issue priority:high/)).toBeTruthy();
  });

  it("lists recently addressed tickets with their state", () => {
    const { getByText } = renderView({
      recent: [
        ticket({
          pr_url: "https://gh/pr/70",
          state: "completed",
          priority: null,
        }),
      ],
    });

    expect(getByText("completed")).toBeTruthy();
  });
});

describe("BoardView with tickets the loop is not working", () => {
  const blockers = {
    kind: "waits_on_blockers" as const,
    message: "Waits on #12, which is still open.",
    fix: "Close them, or remove the blocked-by link if it no longer applies.",
  };
  const parked = {
    kind: "parked" as const,
    message: "The loop parked this ticket: it asks for a decision.",
    fix: "Fix what it names, then remove the lore:blocked label on the issue — the loop re-queues it on its own next tick, no need to run anything by hand.",
  };

  it("pills the queued #7 waits on blockers with its reason and fix, and leaves #8 bare", () => {
    const { getAllByTestId, getByTestId, queryByTestId } = renderView({
      next: [
        ticket({ hold: blockers }),
        ticket({ issue_number: 8, title: "Short issue" }),
      ],
    });

    expect(
      getAllByTestId("row-hold-kind").map((pill) => pill.textContent),
    ).toEqual(["waits on blockers"]);
    expect(getByTestId("row-hold-#7").textContent).toEqual(
      "Waits on #12, which is still open.Fix: Close them, or remove the blocked-by link if it no longer applies.",
    );
    expect(queryByTestId("row-hold-#8")).toBeNull();
  });

  it("words the text_too_long pill as text too long", () => {
    const { getByTestId } = renderView({
      next: [
        ticket({
          hold: {
            kind: "text_too_long",
            message: "The issue's title and body are longer than allowed.",
            fix: "Shorten the issue text.",
          },
        }),
      ],
    });

    expect(getByTestId("row-hold-kind").textContent).toEqual("text too long");
  });

  it("lists the parked #7 under a Parked heading, badged parked once, with its reason and fix", () => {
    const { getByRole, getByTestId, queryByTestId } = renderView({
      parked: [ticket({ state: "parked", hold: parked })],
    });

    expect({
      heading: getByRole("heading", { name: "Parked" }).textContent,
      status: getByTestId("row-status").textContent,
      kindPill: queryByTestId("row-hold-kind"),
      hold: getByTestId("row-hold-#7").textContent,
    }).toEqual({
      heading: "Parked",
      status: "parked",
      kindPill: null,
      hold: "The loop parked this ticket: it asks for a decision.Fix: Fix what it names, then remove the lore:blocked label on the issue — the loop re-queues it on its own next tick, no need to run anything by hand.",
    });
  });

  it("shows no Parked heading when nothing is parked", () => {
    const { queryByRole } = renderView();

    expect(queryByRole("heading", { name: "Parked" })).toBeNull();
  });

  it("lists an awaiting-merge ticket under its own heading with the pill and fix", () => {
    const awaitingMerge = {
      kind: "awaiting_merge" as const,
      message: "The loop's pull request is open and still awaiting a merge.",
      fix: "Review and merge the pull request to free this ticket's slot.",
    };
    const { getByRole, getByTestId } = renderView({
      awaiting_merge: [
        ticket({
          state: "completed",
          pr_url: "https://gh/pr/7",
          hold: awaitingMerge,
        }),
      ],
    });

    expect(getByRole("heading", { name: "Awaiting merge" })).toBeTruthy();
    expect(getByTestId("row-hold-kind").textContent).toEqual("awaiting merge");
    expect(getByTestId("row-hold-#7").textContent).toEqual(
      "The loop's pull request is open and still awaiting a merge.Fix: Review and merge the pull request to free this ticket's slot.",
    );
  });

  it("shows no Awaiting merge heading when nothing is awaiting merge", () => {
    const { queryByRole } = renderView();

    expect(queryByRole("heading", { name: "Awaiting merge" })).toBeNull();
  });

  it("says above the Backlog that the loop is paused while it is switched off, and still lists its queue", () => {
    const { getByRole, getByTestId, getAllByTestId } = renderView({
      enabled: false,
      next: [ticket()],
    });

    expect({
      heading: getByRole("heading", { name: "Backlog" }).textContent,
      notice: getByTestId("section-notice").textContent,
      rows: getAllByTestId("board-row").length,
    }).toEqual({
      heading: "Backlog",
      notice:
        "Paused: Implementation loop is switched off. Nothing in its backlog is picked until it is switched on above.",
      rows: 1,
    });
  });

  it("heads the queue Backlog with no notice while the loop is on", () => {
    const { getByRole, queryByTestId } = renderView({ enabled: true });

    expect(getByRole("heading", { name: "Backlog" })).toBeTruthy();
    expect(queryByTestId("section-notice")).toBeNull();
  });
});

describe("BoardView for every loop", () => {
  it("names each row's loop beside its title when more than one loop is shown", () => {
    const review: RepoLoop = {
      key: "review",
      label: "Code review",
      description: "",
      enabled: true,
    };
    const implementation: RepoLoop = {
      ...review,
      key: "implementation",
      label: "Implementation loop",
    };
    const board = loopBoard(
      [
        {
          loop: implementation,
          sections: implementationSections(implementation, {
            enabled: true,
            onboarding: { merged: true, pr_url: null, last_task: null },
            current: [ticket({ state: "running" })],
            current_run_id: null,
            next: [],
            parked: [],
            recent: [],
            awaiting_merge: [],
          }),
        },
      ],
      EVERY_ROW,
    );
    const { getByText } = render(
      <BoardView
        board={board}
        subject="Work"
        showLoop
        loadMore={() => "/more"}
      />,
    );

    expect([
      getByText("Implementation loop").textContent,
      getByText("Work").tagName,
    ]).toEqual(["Implementation loop", "TH"]);
  });
});

describe("BoardView load more", () => {
  it("links Load more to the address that asks for 5 more recent rows, under the one section that has more", () => {
    const board = {
      failures: [],
      loading: [],
      runIds: [],
      sections: [
        {
          key: "recent" as const,
          heading: "Recently addressed",
          rows: [],
          hasMore: true,
          emptyText: "",
          notices: [],
        },
        {
          key: "backlog" as const,
          heading: "Backlog",
          rows: [],
          hasMore: false,
          emptyText: "",
          notices: [],
        },
      ],
    };
    const { getAllByTestId } = render(
      <BoardView
        board={board}
        subject="Work"
        showLoop
        loadMore={(key) => `/repos/acme/widgets/loops?${key}=10`}
      />,
    );

    expect(
      getAllByTestId("load-more").map((link) => link.getAttribute("href")),
    ).toEqual(["/repos/acme/widgets/loops?recent=10"]);
  });
});

const EVERY_ROW = {
  backlog: 200,
  parked: 200,
  awaiting_merge: 200,
  recent: 200,
};

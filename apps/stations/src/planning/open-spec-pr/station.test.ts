import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  openSpecPrHandle,
  type OpenSpecPrDeps,
  type OpenSpecPrProject,
} from "./station.js";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

function brief(target = "https://github.com/re-cinq/lore@spec/widget") {
  return { visitId: "visit-pr", iteration: 1, needs: { target } };
}

function openedTitleFor(planTitle: string): Promise<string> {
  const titles: string[] = [];
  const handle = scene({
    pulls: {
      update: () => Promise.reject(new Error("unused")),
      list: () => Promise.resolve([]),
      open: (_branch, pr) => {
        titles.push(pr.title);

        return Promise.resolve(pullRef());
      },
    },
  });

  return handle(briefTitled(planTitle), TOOLS).then(() => titles[0]);
}

function briefTitled(planTitle: string) {
  return {
    visitId: "visit-pr",
    iteration: 1,
    needs: {
      target: "https://github.com/re-cinq/lore@spec/widget",
      plan_title: planTitle,
    },
  };
}

function pullRef(overrides: Partial<PullRef> = {}): PullRef {
  return {
    repo: "re-cinq/lore",
    number: 42,
    title: "spec: spec/widget",
    branch: "spec/widget",
    state: "open",
    labels: [],
    url: "https://github.com/re-cinq/lore/pull/42",
    ...overrides,
  };
}

function scene(project: OpenSpecPrProject) {
  const deps: OpenSpecPrDeps = {
    project: (repo) =>
      repo === "re-cinq/lore"
        ? Promise.resolve(project)
        : Promise.reject(new Error(`Not Found: ${repo}`)),
  };

  return openSpecPrHandle(deps);
}

describe("openSpecPrHandle", () => {
  it("produces the existing open PR's url on spec/widget rather than opening a second one", async () => {
    const existing = pullRef();
    const opened: unknown[] = [];
    const handle = scene({
      pulls: {
        update: () => Promise.reject(new Error("unused")),
        list: () => Promise.resolve([existing]),
        open: (branch, pr) => {
          opened.push({ branch, pr });

          return Promise.reject(new Error("should not open a second PR"));
        },
      },
    });

    expect(await handle(brief(), TOOLS)).toEqual({
      outcome: "success",
      produced: { pr_url: "https://github.com/re-cinq/lore/pull/42" },
    });
    expect(opened).toEqual([]);
  });

  it("opens spec: spec/widget on spec/widget when no PR is open on that branch yet", async () => {
    const opened: { branch: string; pr: { title: string; body: string } }[] =
      [];
    const handle = scene({
      pulls: {
        update: () => Promise.reject(new Error("unused")),
        list: () => Promise.resolve([]),
        open: (branch, pr) => {
          opened.push({ branch, pr });

          return Promise.resolve(
            pullRef({
              number: 43,
              url: "https://github.com/re-cinq/lore/pull/43",
            }),
          );
        },
      },
    });

    const result = await handle(brief(), TOOLS);

    expect(result).toEqual({
      outcome: "success",
      produced: { pr_url: "https://github.com/re-cinq/lore/pull/43" },
    });
    expect(opened).toEqual([
      {
        branch: "spec/widget",
        pr: {
          title: "spec: spec/widget",
          body: "Opened by the Lore feature-planning line from `spec/widget`.",
        },
      },
    ]);
  });

  it("titles the PR spec: Notify people when a run fails after the plan it came from", async () => {
    expect(await openedTitleFor("Notify people when a run fails")).toBe(
      "spec: Notify people when a run fails",
    );
  });

  it("cuts a plan title past 70 characters with an ellipsis, so it does not fill a reader's list", async () => {
    const title = await openedTitleFor(`${"long plan title ".repeat(8)}end`);

    expect({ length: title.length, tail: title.slice(-1) }).toEqual({
      length: 70,
      tail: "\u2026",
    });
  });

  it("reports failed with the error message when opening the PR fails", async () => {
    const handle = scene({
      pulls: {
        update: () => Promise.reject(new Error("unused")),
        list: () => Promise.resolve([]),
        open: () => Promise.reject(new Error("GitHub is down")),
      },
    });

    expect(await handle(brief(), TOOLS)).toEqual({
      outcome: "failed",
      error: "GitHub is down",
    });
  });

  it("produces spec_path specs/widget/spec.md beside the PR url, from the first spec spec_plan creates", async () => {
    const handle = scene({
      pulls: {
        update: () => Promise.reject(new Error("unused")),
        list: () => Promise.resolve([pullRef()]),
        open: () => Promise.reject(new Error("unused")),
      },
    });
    const specPlan = JSON.stringify({
      creates: [{ path: "specs/widget/spec.md" }],
      updates: [],
    });

    expect(
      await handle(brief(), {
        ...TOOLS,
        read: (need) =>
          Promise.resolve(Buffer.from(need === "spec_plan" ? specPlan : "")),
      }),
    ).toEqual({
      outcome: "success",
      produced: {
        pr_url: "https://github.com/re-cinq/lore/pull/42",
        spec_path: "specs/widget/spec.md",
      },
    });
  });

  it("produces an empty issue_coverage, so the decompose after this spec merges is not briefed with what an earlier decomposition missed", async () => {
    const produced: Record<string, string> = {};
    const handle = scene({
      pulls: {
        update: () => Promise.reject(new Error("unused")),
        list: () => Promise.resolve([pullRef()]),
        open: () => Promise.reject(new Error("unused")),
      },
    });

    await handle(brief(), {
      ...TOOLS,
      produce: async (name, bytes) => {
        produced[name] = bytes.toString();
      },
    });

    expect(produced).toEqual({ issue_coverage: "" });
  });

  it("adds the plan coverage to the body of the PR it opens when the run carries one", async () => {
    const bodies: string[] = [];
    const handle = scene({
      pulls: {
        list: () => Promise.resolve([]),
        open: (_branch, pr) => (
          bodies.push(pr.body),
          Promise.resolve(pullRef())
        ),
        update: async () => {},
      },
    });

    await handle(coveredBrief(), coverageTools());

    expect(bodies).toEqual([
      `Opened by the Lore feature-planning line from \`spec/widget\`.\n\n${COVERAGE}`,
    ]);
  });

  it("lists the QA checks the spec still fails in the body of the PR it opens, above the plan coverage", async () => {
    const bodies: string[] = [];
    const handle = scene({
      pulls: {
        list: () => Promise.resolve([]),
        open: (_branch, pr) => (
          bodies.push(pr.body),
          Promise.resolve(pullRef())
        ),
        update: async () => {},
      },
    });
    const brief = coveredBrief();

    await handle(
      { ...brief, needs: { ...brief.needs, qa_failures: "blob://qa" } },
      {
        ...TOOLS,
        read: (need) =>
          Promise.resolve(
            Buffer.from(
              { qa_failures: QA_FAILURES, plan_coverage: COVERAGE }[need] ?? "",
            ),
          ),
      },
    );

    expect(bodies).toEqual([
      `Opened by the Lore feature-planning line from \`spec/widget\`.\n\n## Spec checks still failing\n\n${QA_FAILURES}\n${COVERAGE}`,
    ]);
  });

  it("rewrites the body of PR 42 already open on the branch with the plan coverage", async () => {
    const updates: unknown[] = [];
    const handle = scene({
      pulls: {
        list: () => Promise.resolve([pullRef()]),
        open: () => Promise.reject(new Error("unused")),
        update: async (number, fields) => {
          updates.push({ number, fields });
        },
      },
    });

    await handle(coveredBrief(), coverageTools());

    expect(updates).toEqual([
      {
        number: 42,
        fields: {
          body: `Opened by the Lore feature-planning line from \`spec/widget\`.\n\n${COVERAGE}`,
        },
      },
    ]);
  });
});

const QA_FAILURES =
  "These checks failed against the spec. Fix the spec so each one holds:\n- q1: Is billing out of scope? (Spec is silent.)\n";

const COVERAGE =
  "## Plan coverage\n\n1 of 2 plan blocks are cited by a spec statement. Not cited yet:\n";

function coveredBrief() {
  return {
    visitId: "visit-pr",
    iteration: 1,
    needs: {
      target: "https://github.com/re-cinq/lore@spec/widget",
      plan_coverage: "blob://coverage",
    },
  };
}

function coverageTools(): Tools {
  return {
    ...TOOLS,
    read: (need) =>
      Promise.resolve(Buffer.from(need === "plan_coverage" ? COVERAGE : "")),
  };
}

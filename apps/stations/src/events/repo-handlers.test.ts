// specs/issue-triage/spec.md#FR7 and #FR16
import { describe, expect, it } from "vitest";
import {
  REPO_EVENTS,
  repoEventHandlers,
  type RepoEventDeps,
} from "./repo-handlers.js";

/** Extended deps the ticket's implementation will add to RepoEventDeps for triage label dispatch (FR7, FR16). */
interface TriageRepoEventDeps extends RepoEventDeps {
  /** Starts a floor run for the issue-triage line (FR7). */
  startIssueTriage(
    repo: string,
    issueNumber: number,
    issueUrl: string,
  ): Promise<string>;
  /** Returns the floor visit-id of the issue-triage run parked at human-gate, or null (FR16). */
  findParkedTriageVisit(
    repo: string,
    issueNumber: number,
  ): Promise<string | null>;
  /** Reports success to the parked human-gate visit so the triage run advances (FR16). */
  reportTriageGate(visitId: string): Promise<void>;
}

function triageScene(over: Partial<TriageRepoEventDeps> = {}) {
  const started: Array<{
    repo: string;
    issueNumber: number;
    issueUrl: string;
  }> = [];
  const reported: string[] = [];
  const callOrder: string[] = [];

  const deps: TriageRepoEventDeps = {
    labelDispatch: () =>
      Promise.resolve({
        rawSettings: () => Promise.resolve({}),
        activeTaskByIssue: () => {
          callOrder.push("activeTaskByIssue");

          return Promise.resolve(null);
        },
        addLabel: () => Promise.resolve(),
        comment: () => Promise.resolve(),
      }),
    renameRepo: () => Promise.resolve("renamed"),
    dropOverlay: () => Promise.resolve(),
    relocateChunks: () => Promise.resolve("moved 0 of 0"),
    startIssueTriage: (repo, issueNumber, issueUrl) => {
      callOrder.push("startIssueTriage");
      started.push({ repo, issueNumber, issueUrl });

      return Promise.resolve("run-1");
    },
    findParkedTriageVisit: () => {
      callOrder.push("findParkedTriageVisit");

      return Promise.resolve(null);
    },
    reportTriageGate: (visitId) => {
      callOrder.push("reportTriageGate");
      reported.push(visitId);

      return Promise.resolve();
    },
    ...over,
  };
  const handlers = repoEventHandlers(deps as RepoEventDeps);
  const fire = (eventName: string, params: Record<string, unknown>) =>
    handlers.get(eventName)!(params);

  return { fire, started, reported, callOrder };
}

function scene() {
  const steps: string[] = [];
  const deps: RepoEventDeps = {
    labelDispatch: () =>
      Promise.resolve({
        rawSettings: () =>
          Promise.resolve({ implementation_loop: { enabled: true } }),
        activeTaskByIssue: () => Promise.resolve(null),
        addLabel: (issueNumber, label) => {
          steps.push(`label #${issueNumber} ${label}`);

          return Promise.resolve();
        },
        comment: (issueNumber) => {
          steps.push(`comment #${issueNumber}`);

          return Promise.resolve();
        },
      }),
    renameRepo: (from, to) => {
      steps.push(`rename ${from} to ${to}`);

      return Promise.resolve("renamed");
    },
    dropOverlay: (repo, branch) => {
      steps.push(`drop ${repo} ${branch}`);

      return Promise.resolve();
    },
    relocateChunks: (repo) => {
      steps.push(`relocate ${repo}`);

      return Promise.resolve("moved 5 of 7");
    },
  };
  const handlers = repoEventHandlers(deps);
  const fire = (eventName: string, params: Record<string, unknown>) =>
    handlers.get(eventName)!(params);

  return { fire, steps, handlers };
}

describe("repoEventHandlers", () => {
  it("answers exactly the label, rename, pull-request-closed and team-changed events", () => {
    expect([...scene().handlers.keys()].sort()).toEqual(
      [...REPO_EVENTS].sort(),
    );
  });

  it("queues issue 7 of acme/widgets in the loop's backlog when it is labelled lore", async () => {
    const { fire, steps } = scene();

    await fire("github.issues.labeled", {
      repo: "acme/widgets",
      label: "lore",
      issue: { number: 7, labels: ["lore"] },
    });

    expect(steps).toEqual(["label #7 priority:medium", "comment #7"]);
  });

  it("renames the repository row from acme/gadgets to acme/widgets", async () => {
    const { fire, steps } = scene();

    await fire("github.repository.renamed", {
      from: "acme/gadgets",
      to: "acme/widgets",
    });

    expect(steps).toEqual(["rename acme/gadgets to acme/widgets"]);
  });

  it("drops the graph overlay of branch feat/x when its pull request closes", async () => {
    const { fire, steps } = scene();

    await fire("github.pull_request.closed", {
      repo: "acme/widgets",
      branch: "feat/x",
      merged: false,
    });

    expect(steps).toEqual(["drop acme/widgets feat/x"]);
  });

  it("drops nothing for a closed pull request that names no head branch", async () => {
    const { fire, steps } = scene();

    await fire("github.pull_request.closed", { repo: "acme/widgets" });

    expect(steps).toEqual([]);
  });

  it("relocates acme/widgets's context when its team changes", async () => {
    const { fire, steps } = scene();

    await fire("internal.repo.team_changed", { repo: "acme/widgets" });

    expect(steps).toEqual(["relocate acme/widgets"]);
  });
});

describe("repoEventHandlers — issue-triage label dispatch (T006)", () => {
  it("lore:triage label starts an issue-triage floor run with repo, issue_number, and issue_url args", async () => { // specs/issue-triage/spec.md#FR7
    const { fire, started } = triageScene();

    await fire("github.issues.labeled", {
      repo: "acme/widgets",
      label: "lore:triage",
      issue: {
        number: 7,
        html_url: "https://github.com/acme/widgets/issues/7",
        labels: ["lore:triage"],
      },
    });

    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ repo: "acme/widgets", issueNumber: 7 });
  });

  it("triage: needs-triage label also starts an issue-triage floor run", async () => { // specs/issue-triage/spec.md#FR7
    const { fire, started } = triageScene();

    await fire("github.issues.labeled", {
      repo: "acme/widgets",
      label: "triage: needs-triage",
      issue: {
        number: 42,
        html_url: "https://github.com/acme/widgets/issues/42",
        labels: ["triage: needs-triage"],
      },
    });

    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ issueNumber: 42 });
  });

  it("lore:implementation on a parked triage run reports to the human-gate visit before activeTaskByIssue fires", async () => { // specs/issue-triage/spec.md#FR16
    const callOrder: string[] = [];
    const reported: string[] = [];
    const { fire } = triageScene({
      findParkedTriageVisit: () => {
        callOrder.push("findParkedTriageVisit");

        return Promise.resolve("visit-abc");
      },
      reportTriageGate: (visitId) => {
        callOrder.push("reportTriageGate");
        reported.push(visitId);

        return Promise.resolve();
      },
      labelDispatch: () =>
        Promise.resolve({
          rawSettings: () => Promise.resolve({}),
          activeTaskByIssue: () => {
            callOrder.push("activeTaskByIssue");

            return Promise.resolve(null);
          },
          addLabel: () => Promise.resolve(),
          comment: () => Promise.resolve(),
        }),
    });

    await fire("github.issues.labeled", {
      repo: "acme/widgets",
      label: "lore:implementation",
      issue: {
        number: 99,
        html_url: "https://github.com/acme/widgets/issues/99",
        labels: ["lore:implementation"],
      },
    });

    expect(reported).toHaveLength(1);
    expect(reported[0]).toBe("visit-abc");
    const reportIdx = callOrder.indexOf("reportTriageGate");
    const activeIdx = callOrder.indexOf("activeTaskByIssue");

    expect(reportIdx).toBeGreaterThanOrEqual(0);
    expect(activeIdx).toBeGreaterThanOrEqual(0);
    expect(reportIdx).toBeLessThan(activeIdx);
  });
});

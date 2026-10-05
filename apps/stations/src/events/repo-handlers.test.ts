import { describe, expect, it } from "vitest";
import {
  REPO_EVENTS,
  repoEventHandlers,
  type RepoEventDeps,
} from "./repo-handlers.js";

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

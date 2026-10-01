import { describe, expect, it } from "vitest";
import {
  dispatchLabeledIssue,
  type LabelDispatchDeps,
} from "./label-dispatch.js";

function scene(over: Partial<LabelDispatchDeps> = {}) {
  const steps: string[] = [];
  const deps: LabelDispatchDeps = {
    rawSettings: () =>
      Promise.resolve({ implementation_loop: { enabled: true } }),
    activeTaskByIssue: () => Promise.resolve(null),
    addLabel: (issueNumber, label) => {
      steps.push(`label #${issueNumber} ${label}`);

      return Promise.resolve();
    },
    comment: (issueNumber, body) => {
      steps.push(`comment #${issueNumber}: ${body.split(".")[0]}`);

      return Promise.resolve();
    },
    ...over,
  };

  return { deps, steps };
}

const ISSUE = { number: 7, labels: ["lore"] };

describe("dispatchLabeledIssue", () => {
  it("queues issue 7 at priority:medium when it is labelled lore", async () => {
    const { deps, steps } = scene();

    await dispatchLabeledIssue(deps, {
      repo: "acme/widgets",
      label: "lore",
      issue: ISSUE,
    });

    expect(steps).toEqual([
      "label #7 priority:medium",
      "comment #7: Queued for Lore's implementation loop at `priority:medium`",
    ]);
  });

  it("does nothing for a label that is not the repository's dispatch label", async () => {
    const { deps, steps } = scene();

    await dispatchLabeledIssue(deps, {
      repo: "acme/widgets",
      label: "bug",
      issue: { number: 7, labels: ["lore", "bug"] },
    });

    expect(steps).toEqual([]);
  });

  it("answers to the label a repository configured as its dispatch label, here agent", async () => {
    const { deps, steps } = scene({
      rawSettings: () => Promise.resolve({ dispatch_label: "agent" }),
    });

    await dispatchLabeledIssue(deps, {
      repo: "acme/widgets",
      label: "agent",
      issue: { number: 7, labels: ["agent", "priority:high"] },
    });

    expect(steps).toEqual([
      "comment #7: Queued for Lore's implementation loop at `priority:high`, but the loop is switched off for acme/widgets, so nothing picks this ticket up until it is switched on in the repository's settings",
    ]);
  });

  it("says issue 7 is already being worked on by task t-1 and queues nothing", async () => {
    const { deps, steps } = scene({
      activeTaskByIssue: () => Promise.resolve({ id: "t-1" }),
    });

    await dispatchLabeledIssue(deps, {
      repo: "acme/widgets",
      label: "lore",
      issue: ISSUE,
    });

    expect(steps).toEqual(["comment #7: Already being worked on: task `t-1`"]);
  });
});

import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { triageLabelHandle } from "./index.js";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

const REPO = "re-cinq/app";
const ISSUE_NUMBER = 42;
const VERDICT = "FR12 documents this as intended behaviour.";

function brief(overrides: Record<string, string> = {}) {
  return {
    visitId: "visit-triage-label",
    iteration: 1,
    needs: {
      repo: REPO,
      issue_number: String(ISSUE_NUMBER),
      verdict: VERDICT,
      ...overrides,
    },
  };
}

function scene(nodeId: string) {
  const labelled: Array<{ number: number; label: string }> = [];
  const commented: Array<{ number: number; body: string }> = [];

  const handle = triageLabelHandle({
    nodeOf: () => Promise.resolve(nodeId),
    issues: (repo) =>
      repo !== REPO
        ? Promise.reject(new Error(`Not Found: ${repo}`))
        : Promise.resolve({
            comment: (number: number, body: string) => {
              commented.push({ number, body });

              return Promise.resolve();
            },
            addLabel: (number: number, label: string) => {
              labelled.push({ number, label });

              return Promise.resolve();
            },
          }),
  });

  return { handle, labelled, commented };
}

describe("the triage-label station", () => {
  it("applies triage: reproduced after a confirmed reproduction", async () => {
    const { handle, labelled, commented } = scene("label-reproduced");

    await handle(brief(), TOOLS);

    expect({ labelled, commented }).toEqual({
      labelled: [{ number: ISSUE_NUMBER, label: "triage: reproduced" }],
      commented: [],
    });
  });

  it("applies triage: diagnosed after a root cause is found", async () => {
    const { handle, labelled, commented } = scene("label-diagnosed");

    await handle(brief(), TOOLS);

    expect({ labelled, commented }).toEqual({
      labelled: [{ number: ISSUE_NUMBER, label: "triage: diagnosed" }],
      commented: [],
    });
  });

  it("posts the reproduction request with the needs-reproduction label", async () => {
    const { handle, labelled, commented } = scene("label-needs-repro");

    await handle(brief(), TOOLS);

    expect({ labelled, commented }).toEqual({
      labelled: [
        { number: ISSUE_NUMBER, label: "triage: needs-reproduction" },
      ],
      commented: [{ number: ISSUE_NUMBER, body: VERDICT }],
    });
  });

  it("posts the reproduction failure with the unable-to-reproduce label", async () => {
    const { handle, labelled, commented } = scene("label-unable");

    await handle(brief(), TOOLS);

    expect({ labelled, commented }).toEqual({
      labelled: [
        { number: ISSUE_NUMBER, label: "triage: unable-to-reproduce" },
      ],
      commented: [{ number: ISSUE_NUMBER, body: VERDICT }],
    });
  });

  it("applies triage: not-actionable and posts the verdict on the issue", async () => {
    const { handle, labelled, commented } = scene("label-not-actionable");

    const report = await handle(brief(), TOOLS);

    expect({ report, labelled, commented }).toEqual({
      report: { outcome: "success" },
      labelled: [{ number: ISSUE_NUMBER, label: "triage: not-actionable" }],
      commented: [{ number: ISSUE_NUMBER, body: VERDICT }],
    });
  });

  it("applies triage: failed and says nothing, since a pass that failed has nothing to tell the reporter", async () => {
    const { handle, labelled, commented } = scene("label-failed");

    await handle(brief({ verdict: "" }), TOOLS);

    expect({ labelled, commented }).toEqual({
      labelled: [{ number: ISSUE_NUMBER, label: "triage: failed" }],
      commented: [],
    });
  });

  it("labels without a comment when the verify pass produced no verdict", async () => {
    const { handle, labelled, commented } = scene("label-not-actionable");

    await handle(
      { ...brief(), needs: { repo: REPO, issue_number: "42" } },
      TOOLS,
    );

    expect({ labelled, commented }).toEqual({
      labelled: [{ number: ISSUE_NUMBER, label: "triage: not-actionable" }],
      commented: [],
    });
  });

  it("refuses a visit on a node no label is declared for, naming it", async () => {
    const { handle } = scene("human-gate");

    await expect(handle(brief(), TOOLS)).rejects.toThrow(
      new Error('no triage label is declared for node "human-gate"'),
    );
  });
});

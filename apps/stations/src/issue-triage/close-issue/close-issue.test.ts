import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { closeIssueHandle } from "./index.js";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

const REPO = "re-cinq/app";
const ISSUE_NUMBER = 42;
const VERDICT = "This issue is already implemented in recent changes.";

function brief(overrides: Record<string, string> = {}) {
  return {
    visitId: "visit-close-issue",
    iteration: 1,
    needs: {
      repo: REPO,
      issue_number: String(ISSUE_NUMBER),
      verdict: VERDICT,
      ...overrides,
    },
  };
}

function scene() {
  const order: string[] = [];
  const commented: Array<{ number: number; body: string }> = [];
  const closed: Array<{ number: number }> = [];

  const handle = closeIssueHandle({
    issues: (repo) =>
      repo !== REPO
        ? Promise.reject(new Error(`Not Found: ${repo}`))
        : Promise.resolve({
            comment: (number: number, body: string) => {
              order.push("comment");
              commented.push({ number, body });
              return Promise.resolve();
            },
            close: (number: number) => {
              order.push("close");
              closed.push({ number });
              return Promise.resolve();
            },
          }),
  });

  return { handle, order, commented, closed };
}

describe("the close-issue station", () => {
  it("posts the verdict comment before closing the issue", async () => {
    const { handle, order } = scene();

    await handle(brief(), TOOLS);

    expect(order).toEqual(["comment", "close"]);
  });

  it("posts the verdict text on the correct issue and closes it", async () => {
    const { handle, commented, closed } = scene();

    await handle(brief(), TOOLS);

    expect(commented).toEqual([{ number: ISSUE_NUMBER, body: VERDICT }]);
    expect(closed).toEqual([{ number: ISSUE_NUMBER }]);
  });
});

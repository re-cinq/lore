import { expect, it } from "vitest";
import type { Brief, Tools } from "@re-cinq/floor-station";
import { shadowReviewProgressHandle } from "./station.js";

const visit = {
  lineId: "code-review-shadow",
  nodeId: "publish-code",
  runId: "shadow-run",
  repo: null,
  startedAt: 1,
};

const brief: Brief = {
  visitId: "visit",
  iteration: 1,
  needs: {
    revision: "a".repeat(40),
    code_reading: "blob://code",
  },
};

function station(reading: string[]) {
  const work: string[] = [];
  const handle = shadowReviewProgressHandle({
    async visit() {
      return visit;
    },
    async appLogin() {
      work.push("read GitHub App login");

      return undefined;
    },
    async project() {
      throw new Error("GitHub project is unavailable");
    },
    async serialize() {
      work.push("lock PR");
    },
  });
  const tools: Tools = {
    signal: new AbortController().signal,
    async read(name) {
      work.push(name);

      return Buffer.from(
        JSON.stringify({
          status: "complete",
          reading,
          evidence: [],
          requests: [],
        }),
      );
    },
    async produce() {},
    async modelCall() {},
  };

  return { work, handle: () => handle(brief, tools) };
}

it("validates two code readings without touching GitHub when there is no pull request", async () => {
  const { handle, work } = station([
    "Users can reserve items.",
    "Archived items stay unavailable.",
  ]);

  expect({ report: await handle(), work }).toEqual({
    report: { outcome: "success" },
    work: ["code_reading"],
  });
});

it("fails a code result with one reading even when there is no pull request", async () => {
  const { handle, work } = station(["Users can reserve items."]);

  expect({ report: await handle(), work }).toEqual({
    report: {
      outcome: "failed",
      error: "Incomplete review evidence: Code reading",
    },
    work: ["code_reading"],
  });
});

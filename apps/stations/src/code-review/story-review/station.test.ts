import { expect, it } from "vitest";
import type { Brief, Tools } from "@re-cinq/floor-station";
import { reviewProgressHandle } from "./station.js";

const complete = (answer: object) => JSON.stringify(answer);
const story = complete({
  status: "complete",
  story: [{ text: "A locked item keeps its name.", tests: [] }],
});
const matches = complete({ status: "complete", summary: "It does.", gaps: [] });

function station(nodeId: string, answers: Record<string, string>) {
  const work: string[] = [];
  const produced: Record<string, string> = {};
  const handle = reviewProgressHandle({
    async visit() {
      return {
        lineId: "code-review",
        nodeId,
        runId: "run-7",
        repo: null,
        startedAt: 1,
      };
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
  const brief: Brief = {
    visitId: "visit",
    iteration: 1,
    needs: {
      revision: "a".repeat(40),
      ...Object.fromEntries(
        Object.keys(answers).map((name) => [name, `blob://${name}`]),
      ),
    },
  };
  const tools: Tools = {
    signal: new AbortController().signal,
    async read(name) {
      work.push(name);

      return Buffer.from(answers[name]);
    },
    async produce(name, value) {
      produced[name] = value.toString();
    },
    async modelCall() {},
  };

  return { work, produced, handle: () => handle(brief, tools) };
}

it("accepts a told story at publish-story without touching GitHub when there is no pull request", async () => {
  const { handle, work } = station("publish-story", { story });

  expect({ report: await handle(), work }).toEqual({
    report: { outcome: "success" },
    work: ["story"],
  });
});

it("fails publish-story when tell-story gave no story", async () => {
  const { handle } = station("publish-story", { story: "I could not." });

  expect(await handle()).toEqual({
    outcome: "failed",
    error: "Incomplete review evidence: Story",
  });
});

it("produces the formal review at finalize and names the run that posts it", async () => {
  const { handle, produced } = station("finalize", {
    story,
    implementation_check: matches,
    issue_check: matches,
  });

  expect({
    report: await handle(),
    verdict: /"verdict":"(\w+)"/.exec(produced.review_output)?.[1],
  }).toEqual({
    report: { outcome: "success", produced: { review_run: "run-7" } },
    verdict: "approved",
  });
});

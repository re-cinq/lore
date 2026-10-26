import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type { PullDescription } from "@re-cinq/lore-shared/backlog/pr-description.js";
import { readyForReviewHandle, type ReadyForReviewDeps } from "./station.js";

const BRANCH = "lore/implementation-loop/issue-7";

const DELETED = (async () => true)();

function scene(
  over: Partial<ReadyForReviewDeps> & { answer?: PullDescription } = {},
) {
  const produced: Record<string, string> = {};
  const deleted: string[] = [];
  const prompts: string[] = [];
  const calls: unknown[] = [];
  const tools: Tools = {
    read: () => Promise.resolve(Buffer.from("# Add export (#7)")),
    produce: (name, bytes) => {
      produced[name] = bytes.toString();

      return Promise.resolve();
    },
    modelCall: (call) => {
      calls.push(call);

      return Promise.resolve();
    },
    signal: new AbortController().signal,
  };
  const deps: ReadyForReviewDeps = {
    diffOf: () => Promise.resolve("+export"),
    fileAt: (_repo, path) =>
      Promise.resolve(
        path === ".lore/dod.md" ? "Done when export.test.ts passes" : null,
      ),
    deleteFile: (_repo, branch, path, message) => {
      deleted.push(`${branch}:${path}:${message.split("\n")[0]}`);

      return DELETED;
    },
    describe: (prompt) => {
      prompts.push(prompt);

      return Promise.resolve({
        parsed: over.answer ?? {
          title: "Add the export button",
          body: "## Why\nThe ticket asks for it.",
          issue_coverage: "full",
        },
        model: "claude-haiku-4-5",
        costUsd: 0.002,
        inputTokens: 4000,
        outputTokens: 300,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        durationMs: 1200,
      });
    },
    ...over,
  };
  const brief = {
    visitId: "visit-ready",
    iteration: 1,
    needs: {
      target: `https://github.com/re-cinq/otto@${BRANCH}`,
      ticket: "blob",
      task_id: "task-1",
      pr_url: "https://github.com/re-cinq/otto/pull/12",
    },
  };

  return {
    run: () => readyForReviewHandle(deps)(brief, tools),
    produced,
    deleted,
    prompts,
    calls,
  };
}

describe("loop-ready-for-review", () => {
  it("writes pull request 12's title, description and coverage from its diff, ticket and definition of done with one small model call, and deletes .lore/dod.md from the branch (ready-for-review read 786k input tokens a visit on Gemini 3.1 Pro over the weekend of 2026-10-23)", async () => {
    const { run, produced, deleted, prompts, calls } = scene();

    expect({
      report: await run(),
      body: produced.pr_body,
      deleted,
      sawDod: prompts[0]?.includes("Done when export.test.ts passes"),
      calls: calls.length,
    }).toEqual({
      report: {
        outcome: "success",
        produced: { pr_title: "Add the export button", issue_coverage: "full" },
      },
      body: "## Why\nThe ticket asks for it.",
      deleted: [
        `${BRANCH}:.lore/dod.md:Remove the definition of done before review`,
      ],
      sawDod: true,
      calls: 1,
    });
  });

  it("reports failed with the reason when the model writes no title, so the step runs once more", async () => {
    const { run, deleted } = scene({
      answer: { title: "", body: "## Why", issue_coverage: "full" },
    });

    expect({ report: await run(), deleted }).toEqual({
      report: {
        outcome: "failed",
        error: "the model wrote no title or no description",
      },
      deleted: [],
    });
  });
});

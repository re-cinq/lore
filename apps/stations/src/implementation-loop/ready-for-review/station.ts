// The loop's ready-for-review step (specs/external-floor FR12.21): the pull request's title, description and coverage are written from its diff, the ticket and the definition of done by one small model call, and the definition of done is deleted from the branch through the API. No pod: the agent this replaced checked out the repository and read 786k input tokens a visit.
import {
  defineStation,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { formatTrailers } from "@re-cinq/lore-shared";
import {
  PR_DESCRIPTION_SCHEMA,
  describedPull,
  prDescriptionPrompt,
  templateHeadings,
  type PullDescription,
} from "@re-cinq/lore-shared/backlog/pr-description.js";
import {
  parseGitRef,
  parsePullRequestUrl,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import { Llm } from "@re-cinq/lore-shared/llm/llm.js";
import type { LlmToolResult } from "@re-cinq/lore-shared/llm/llm-provider.js";
import { projectFor } from "../../outbound/project-boot.js";
import { findPullRequestTemplate } from "../pr-sections.js";

export interface ReadyForReviewDeps {
  diffOf(repo: string, prNumber: number): Promise<string>;
  fileAt(repo: string, path: string, ref: string): Promise<string | null>;
  /** The repository's pull request template on its default branch, as mark-ready reads it. */
  template(repo: string): Promise<string | null>;
  deleteFile(
    repo: string,
    branch: string,
    path: string,
    message: string,
  ): Promise<boolean>;
  describe(prompt: string): Promise<LlmToolResult<PullDescription>>;
}

const LLM_USE = "pr_description";

const DOD_PATH = ".lore/dod.md";

const productionDeps: ReadyForReviewDeps = {
  diffOf: async (repo, prNumber) =>
    (await projectFor(repo)).pulls.getDiff(prNumber),
  fileAt: async (repo, path, ref) =>
    (await projectFor(repo)).repo.read(path, ref),
  template: async (repo) =>
    findPullRequestTemplate((await projectFor(repo)).repo),
  deleteFile: async (repo, branch, path, message) =>
    (await projectFor(repo)).repo.deleteFile(branch, path, message),
  describe: (prompt) =>
    Llm.for(LLM_USE).completeWithTool<PullDescription>({
      prompt,
      jobName: LLM_USE,
      temperature: 0,
      maxTokens: 2000,
      toolName: "pull_request_description",
      toolDescription:
        "The pull request's title, description and ticket coverage.",
      toolSchema: PR_DESCRIPTION_SCHEMA,
    }),
};

interface Branch {
  repo: string;
  branch: string;
  prNumber: number;
}

export function readyForReviewHandle(deps: ReadyForReviewDeps): Handle {
  return async ({ needs, iteration }, tools) => {
    const { repo, branch } = parseGitRef(needs.target);
    const { prNumber } = parsePullRequestUrl(needs.pr_url);
    const at = { repo, branch, prNumber };

    try {
      return await written(
        deps,
        tools,
        at,
        dodRemoval(needs.task_id, iteration),
      );
    } catch (err) {
      return { outcome: "failed", error: errorMessage(err) };
    }
  };
}

const UNWRITTEN = {
  outcome: "failed",
  error: "the model wrote no title or no description",
} as const;

async function written(
  deps: ReadyForReviewDeps,
  tools: Tools,
  at: Branch,
  removal: string,
) {
  const described = await describe(deps, tools, at);

  if (!described) {
    return UNWRITTEN;
  }
  await tools.produce("pr_body", described.body);
  await deps.deleteFile(at.repo, at.branch, DOD_PATH, removal);
  const { title, coverage } = described;

  return {
    outcome: "success",
    produced: { pr_title: title, issue_coverage: coverage },
  };
}

async function describe(deps: ReadyForReviewDeps, tools: Tools, at: Branch) {
  const [diff, dod, template, ticket] = await Promise.all([
    deps.diffOf(at.repo, at.prNumber),
    deps.fileAt(at.repo, DOD_PATH, at.branch),
    deps.template(at.repo),
    tools.read("ticket"),
  ]);
  const prompt = prDescriptionPrompt({
    ticket: ticket.toString("utf8"),
    dod,
    headings: templateHeadings(template),
    diff,
  });
  const answer = await deps.describe(prompt);

  await tools.modelCall(modelCallOf(answer));

  return describedPull(answer.parsed);
}

/** The scaffolding between pods goes before review, in a commit that carries the loop's trailers like every Lore-authored one. */
function dodRemoval(taskId: string | undefined, iteration: number): string {
  const trailers = formatTrailers({
    stage: "ready-for-review",
    iteration,
    taskId: taskId ?? "",
  });

  return `Remove the definition of done before review\n\n${trailers}`;
}

function modelCallOf(answer: LlmToolResult<PullDescription>) {
  const { model, costUsd } = answer;

  return {
    model,
    costUsd,
    usage: {
      input_tokens: answer.inputTokens,
      cache_read_input_tokens: answer.cacheReadTokens,
      output_tokens: answer.outputTokens,
    },
  };
}

export function startReadyForReviewStation(): RunningStation {
  return defineStation(
    "loop-ready-for-review",
    readyForReviewHandle(productionDeps),
  );
}

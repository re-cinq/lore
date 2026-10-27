// The implementation loop's "already done?" check (specs/external-floor FR12.20): before the definition-of-done pod, merged pull requests that name the ticket are judged against it by a small model. "Done" ends the run with the ticket resolved, naming the pull request; anything else, an error included, goes on to the pod.
import {
  defineStation,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import {
  DONE_CHECK_TOOL_SCHEMA,
  doneCheckCandidates,
  doneCheckEnabled,
  doneCheckPrompt,
  doneCheckVerdict,
  namedPaths,
  type DoneCheckAnswer,
} from "@re-cinq/lore-shared/backlog/done-check.js";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import { Llm } from "@re-cinq/lore-shared/llm/llm.js";
import type { LlmToolResult } from "@re-cinq/lore-shared/llm/llm-provider.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { settings } from "../../outbound/queues.js";
import { projectFor } from "../../outbound/project-boot.js";

export interface DoneCheckDeps {
  enabled(repo: string): Promise<boolean>;
  /** The repository's pull requests merged since the ticket was opened. */
  mergedSince(repo: string, issueNumber: number): Promise<PullRef[]>;
  /** The merged pull requests that touched `path`. */
  touching(repo: string, path: string): Promise<PullRef[]>;
  diffOf(number: number, repo: string): Promise<string>;
  judge(prompt: string): Promise<LlmToolResult<DoneCheckAnswer>>;
}

const LLM_USE = "done_check";

const productionDeps: DoneCheckDeps = {
  enabled: async (repo) => doneCheckEnabled(await settings().rawSettings(repo)),
  mergedSince: async (repo, issueNumber) => {
    const { pulls, issues } = await projectFor(repo);
    const issue = await issues.get(issueNumber);

    return issue?.createdAt ? pulls.listMergedSince(issue.createdAt) : [];
  },
  touching: async (repo, path) =>
    (await projectFor(repo)).repo.mergedPullsTouching(path),
  diffOf: async (number, repo) =>
    (await projectFor(repo)).pulls.getDiff(number),
  judge: (prompt) =>
    Llm.for(LLM_USE).completeWithTool<DoneCheckAnswer>({
      prompt,
      jobName: LLM_USE,
      temperature: 0,
      maxTokens: 400,
      toolName: "done_check",
      toolDescription:
        "Whether the ticket is already done, by which pull request, and why.",
      toolSchema: DONE_CHECK_TOOL_SCHEMA,
    }),
};

const GO_ON = { outcome: "success" } as const;

export function doneCheckHandle(deps: DoneCheckDeps): Handle {
  return async ({ needs }, tools) => {
    const { repo } = parseGitRef(needs.target);
    const issueNumber = Number(needs.issue_number);

    if (!issueNumber || !(await deps.enabled(repo))) {
      return GO_ON;
    }

    try {
      return await judged(deps, tools, { repo, issueNumber });
    } catch (err) {
      console.warn(`[done-check] ${repo}#${issueNumber}: ${errorMessage(err)}`);

      return GO_ON;
    }
  };
}

interface Ticket {
  repo: string;
  issueNumber: number;
}

async function judged(deps: DoneCheckDeps, tools: Tools, ticket: Ticket) {
  const text = (await tools.read("ticket")).toString("utf8");
  const shown = await withDiffs(
    deps,
    ticket.repo,
    await candidatesOf(deps, ticket, text),
  );

  if (shown.length === 0) {
    return GO_ON;
  }
  const answer = await deps.judge(doneCheckPrompt(text, shown));

  await tools.modelCall(modelCallOf(answer));
  const resolved = doneCheckVerdict(
    answer.parsed,
    shown.map(({ pull }) => pull),
  );

  return resolved
    ? { outcome: "changes_requested", produced: { dod_resolved: resolved } }
    : GO_ON;
}

/** The pull requests that touched the files the ticket names, and those that name it. */
async function candidatesOf(
  deps: DoneCheckDeps,
  { repo, issueNumber }: Ticket,
  text: string,
): Promise<PullRef[]> {
  const [touching, naming] = await Promise.all([
    Promise.all(namedPaths(text).map((path) => deps.touching(repo, path))),
    deps.mergedSince(repo, issueNumber),
  ]);

  return doneCheckCandidates({ touching, naming }, repo, issueNumber);
}

/** Each candidate with its diff; one GitHub will not serve, too large to read, is left out rather than failing the check. */
async function withDiffs(
  deps: DoneCheckDeps,
  repo: string,
  candidates: readonly PullRef[],
): Promise<Array<{ pull: PullRef; diff: string }>> {
  const read = await Promise.all(
    candidates.map((pull) =>
      deps.diffOf(pull.number, repo).then(
        (diff) => [{ pull, diff }],
        () => [],
      ),
    ),
  );

  return read.flat();
}

function modelCallOf(answer: LlmToolResult<DoneCheckAnswer>) {
  const { model, costUsd } = answer;

  return { model, costUsd, usage: usageOf(answer) };
}

function usageOf(answer: LlmToolResult<DoneCheckAnswer>) {
  return {
    input_tokens: answer.inputTokens,
    cache_read_input_tokens: answer.cacheReadTokens,
    output_tokens: answer.outputTokens,
  };
}

export function startDoneCheckStation(): RunningStation {
  return defineStation("loop-done-check", doneCheckHandle(productionDeps));
}

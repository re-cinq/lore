// Publishes the lore/implementation-loop GitHub check on the pull request's live head as the run enters each step, moves heads, and settles (specs/implementation-loop FR17).
import { LOOP_LINE } from "@re-cinq/lore-shared/backlog/floor-loop.js";
import type { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { floorIfConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  floorRepoOf,
  loreRepoOf,
  parsePullRequestUrl,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import {
  checkDisplayName,
  loreCheckName,
} from "@re-cinq/lore-shared/project/pulls/check-runs.js";
import { projectFor } from "./project-boot.js";
import { LOOP_STEP_DESCRIPTIONS } from "./loop-step-descriptions.js";

export { LOOP_STEP_DESCRIPTIONS };

type Floor = ReturnType<typeof floorClient>;
export type LoopRunView = Awaited<
  ReturnType<Floor["runs"]["list"]>
>["items"][number] & { args?: Record<string, unknown> };
export type LoopVisitView = Pick<
  Awaited<ReturnType<Floor["stationRuns"]["list"]>>[number],
  "nodeId" | "iteration" | "report"
>;

export interface LoopCheckContext {
  liveHeadSha?: string | null;
  uiUrl?: string;
  stepDescriptions?: Readonly<Record<string, string>>;
}

export interface LoopProgressDeps {
  run(runId: string): Promise<LoopRunView | null>;
  visits(runId: string): Promise<LoopVisitView[]>;
  openLoopRuns?(repo?: string): Promise<LoopRunView[]>;
  pullHeadSha(repo: string, prNumber: number): Promise<string | null>;
  upsertCheckRun(repo: string, input: CheckRunInput): Promise<void>;
  mergeArgs?(runId: string, patch: { pr_check_sha: string }): Promise<void>;
  readArgs?(runId: string): Record<string, unknown> | undefined;
  uiUrl?: string;
}

/** Publishes the run's check on its pull request's live head, closing the check left on any previous head as Superseded first. */
export async function publishLoopRunProgress(
  deps: LoopProgressDeps,
  run: LoopRunView,
  visits: readonly LoopVisitView[],
): Promise<void> {
  const prNumber = loopPrNumberOf(run, visits);

  if (run.lineId !== LOOP_LINE || !prNumber) {
    return;
  }
  const repo = loreRepoOf(run.repo);
  const liveHeadSha = await deps.pullHeadSha(repo, prNumber);
  const check = loopProgressCheck(run, visits, {
    liveHeadSha,
    uiUrl: deps.uiUrl,
  });

  if (!check) {
    return;
  }
  await publishWithSuperseded(deps, run, repo, check);
}

/** Maps an implementation-loop run and its visits to its GitHub check on the PR's live head, or null while the PR or its head is unknown. */
export function loopProgressCheck(
  run: LoopRunView,
  visits: readonly LoopVisitView[],
  context: LoopCheckContext = {},
): CheckRunInput | null {
  const prNumber = loopPrNumberOf(run, visits);
  const headSha = context.liveHeadSha ?? "";

  if (run.lineId !== LOOP_LINE || !prNumber || !headSha) {
    return null;
  }

  return {
    ...checkIdentity(run, headSha, context.uiUrl),
    ...checkState(run, visits, context.stepDescriptions),
  };
}

/** Extracts the pull request number a loop run works on, from open-pr's output or the run's start items. */
export function loopPrNumberOf(
  run: LoopRunView,
  visits: readonly LoopVisitView[],
): number | null {
  const argNumber = Number(run.args?.pr_number);

  if (argNumber > 0) {
    return argNumber;
  }
  const url = prUrlOf(run, visits);

  return url && /\/pull\/\d+/.test(url)
    ? parsePullRequestUrl(url).prNumber
    : null;
}

function prUrlOf(
  run: LoopRunView,
  visits: readonly LoopVisitView[],
): string | undefined {
  const fromVisit = visits
    .flatMap(({ report }) => report?.produced?.pr_url ?? [])
    .at(-1);

  return (
    fromVisit ??
    startItemValue(run, "pr_url") ??
    stringArgOf(run.args, "pr_url")
  );
}

function startItemValue(run: LoopRunView, key: string): string | undefined {
  const startItems = run.startItems as Partial<
    Record<string, { ref?: string }>
  >;

  return startItems[key]?.ref;
}

function stringArgOf(
  args: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  return typeof args?.[key] === "string" ? args[key] : undefined;
}

function checkIdentity(
  run: LoopRunView,
  headSha: string,
  uiUrl?: string,
): Pick<CheckRunInput, "headSha" | "name" | "title" | "detailsUrl"> {
  const trimmedUi = uiUrl?.replace(/\/+$/, "");

  return {
    headSha,
    name: loreCheckName(LOOP_LINE),
    title: `Lore ${checkDisplayName(LOOP_LINE)}`,
    ...(trimmedUi
      ? { detailsUrl: `${trimmedUi}/assembly-runs/${run.id}` }
      : {}),
  };
}

function checkState(
  run: LoopRunView,
  visits: readonly LoopVisitView[],
  stepDescriptions: Readonly<Record<string, string>> = LOOP_STEP_DESCRIPTIONS,
): Pick<CheckRunInput, "status" | "conclusion" | "summary"> &
  Partial<Pick<CheckRunInput, "title">> {
  if (run.finishedAt === null && run.outcome === null) {
    return { ...runningText(visits, stepDescriptions), status: "in_progress" };
  }

  return { ...terminalResult(run), status: "completed" };
}

function runningText(
  visits: readonly LoopVisitView[],
  stepDescriptions: Readonly<Record<string, string>>,
): Pick<CheckRunInput, "summary"> & Partial<Pick<CheckRunInput, "title">> {
  const running = `Running — ${LOOP_LINE}.`;
  const step = visits.filter((visit) => visit.report === null).at(-1);

  if (!step) {
    return { summary: running };
  }
  const description = stepDescriptions[step.nodeId];
  const at = `Now at ${"`"}${step.nodeId}${"`"} (visit ${step.iteration})`;
  const line = description ? `${at}: ${description}` : `${at}.`;

  return {
    ...(description ? { title: description } : {}),
    summary: [running, line].join(String.fromCharCode(10, 10)),
  };
}

type TerminalCheck = {
  conclusion: NonNullable<CheckRunInput["conclusion"]>;
  summary: string;
};

const COMPLETED_OUTCOMES = new Set(["success", "completed"]);
const CANCELLED_OUTCOMES = new Set(["cancelled", "pr_closed"]);

function terminalResult(run: LoopRunView): TerminalCheck {
  const outcome = run.outcome ?? "error";

  if (COMPLETED_OUTCOMES.has(outcome)) {
    return { conclusion: "success", summary: "Finished." };
  }

  if (CANCELLED_OUTCOMES.has(outcome)) {
    return cancelledTerminal(run);
  }
  const why = run.reason ? ` — ${run.reason}` : "";

  return { conclusion: "failure", summary: `${LOOP_LINE} failed${why}.` };
}

function cancelledTerminal(run: LoopRunView): TerminalCheck {
  const summary =
    run.outcome === "pr_closed" || !run.reason
      ? "PR closed."
      : `Cancelled — ${run.reason}.`;

  return { conclusion: "cancelled", summary };
}

async function publishWithSuperseded(
  deps: LoopProgressDeps,
  run: LoopRunView,
  repo: string,
  check: CheckRunInput,
): Promise<void> {
  const previousSha = previousCheckShaOf(deps, run);
  const superseded = supersededLoopCheck(previousSha, check);

  if (superseded) {
    await deps.upsertCheckRun(repo, superseded);
  }
  await deps.upsertCheckRun(repo, check);

  if (previousSha !== check.headSha) {
    recordCheckSha(run, check.headSha);
    await deps.mergeArgs?.(run.id, { pr_check_sha: check.headSha });
  }
}

/** Closes the check left on the previous head as neutral Superseded once the pull request moves on to a new head. */
export function supersededLoopCheck(
  previousOrArgs: { pr_check_sha?: unknown } | string | undefined,
  check: CheckRunInput,
): CheckRunInput | null {
  const previous =
    typeof previousOrArgs === "string"
      ? previousOrArgs
      : stringArgOf(previousOrArgs, "pr_check_sha");

  if (!previous || previous === check.headSha) {
    return null;
  }

  return {
    ...check,
    headSha: previous,
    status: "completed",
    conclusion: "neutral",
    title: "Superseded",
    summary: `The pull request moved on to ${check.headSha}; this run reports there now.`,
  };
}

const runArgsStore = new Map<string, Record<string, unknown>>();

function previousCheckShaOf(
  deps: LoopProgressDeps,
  run: LoopRunView,
): string | undefined {
  const fromDeps = stringArgOf(deps.readArgs?.(run.id), "pr_check_sha");
  const fromRun =
    stringArgOf(run.args, "pr_check_sha") ??
    stringArgOf(runArgsStore.get(run.id), "pr_check_sha");

  return fromDeps ?? fromRun ?? startItemValue(run, "pr_check_sha");
}

function recordCheckSha(run: LoopRunView, headSha: string): void {
  const existing = runArgsStore.get(run.id) ?? {};

  runArgsStore.set(run.id, { ...existing, pr_check_sha: headSha });

  if (run.args) {
    run.args.pr_check_sha = headSha;
  }
}

/** Clears the in-memory pr_check_sha store between tests. */
export function clearLoopProgressArgs(): void {
  runArgsStore.clear();
}

export const loopProgressProductionDeps: LoopProgressDeps = {
  run: async (runId) => {
    const floor = floorIfConfigured();

    return floor ? ((await floor.runs.get(runId))?.run ?? null) : null;
  },
  visits: async (runId) => {
    const floor = floorIfConfigured();

    return floor ? floor.stationRuns.list({ run: runId }) : [];
  },
  openLoopRuns: async (repo) => {
    const floor = floorIfConfigured();

    if (!floor) {
      return [];
    }
    const filter = {
      ...(repo ? { repo: floorRepoOf(repo) } : {}),
      line: LOOP_LINE,
      open: true,
    };

    return (await floor.runs.list(filter)).items;
  },
  pullHeadSha: async (repo, prNumber) => {
    const { pulls } = await projectFor(repo);

    return (await pulls.get(prNumber))?.headSha ?? null;
  },
  upsertCheckRun: async (repo, input) => {
    const { repo: repository } = await projectFor(repo);

    await repository.upsertCheckRun(input);
  },
  readArgs: (runId) => runArgsStore.get(runId),
  uiUrl: process.env.LORE_UI_URL,
};

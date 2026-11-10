// Publishes the lore/implementation-loop GitHub check as the loop run enters each step and once more when it settles (specs/implementation-loop FR17).
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import type { RunView } from "@re-cinq/lore-shared/floor/floor-client.js";
import { floorIfConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { loreRepoOf } from "@re-cinq/lore-shared/floor/floor-items.js";
import { startValueOf } from "@re-cinq/lore-shared/floor/run-start-items.js";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import { loreCheckName } from "@re-cinq/lore-shared/project/pulls/check-runs.js";
import { projectFor } from "../outbound/project-boot.js";
import { LOOP_BLUEPRINT } from "../work/pr-ready-check/sweep-contract.js";

export interface LoopProgressDeps {
  run(runId: string): Promise<RunView | null>;
  upsertCheckRun(repo: string, input: CheckRunInput): Promise<void>;
}

interface Ctx {
  prCheckSha: string;
  repo: string;
}

const STATION_RUN_DISPATCHED = "station_run.dispatched";
const RUN_SETTLED = "run.settled";

export const LOOP_PROGRESS_EVENTS: readonly string[] = [
  STATION_RUN_DISPATCHED,
  RUN_SETTLED,
];

export function loopProgressHandlers(
  deps: LoopProgressDeps,
): Map<string, EventHandler> {
  return new Map<string, EventHandler>([
    [STATION_RUN_DISPATCHED, onStationRunDispatched(deps)],
    [RUN_SETTLED, onRunSettled(deps)],
  ]);
}

function onStationRunDispatched(deps: LoopProgressDeps): EventHandler {
  return withLoopCtx(deps, async (ctx, p) => {
    const step = p["node_id"] ?? "step";

    await deps.upsertCheckRun(ctx.repo, {
      headSha: ctx.prCheckSha,
      name: loreCheckName(LOOP_BLUEPRINT),
      title: step,
      status: "in_progress",
      summary: `Running: ${step}`,
    });
  });
}

function onRunSettled(deps: LoopProgressDeps): EventHandler {
  return withLoopCtx(deps, async (ctx) => {
    await deps.upsertCheckRun(ctx.repo, {
      headSha: ctx.prCheckSha,
      name: loreCheckName(LOOP_BLUEPRINT),
      title: "Completed",
      status: "completed",
      conclusion: "success",
      summary: "The implementation loop run completed.",
    });
  });
}

function withLoopCtx(
  deps: LoopProgressDeps,
  fn: (ctx: Ctx, p: Record<string, string | undefined>) => Promise<void>,
): EventHandler {
  return async (params) => {
    const p = params as Record<string, string | undefined>;
    const ctx = await resolveCtx(deps, p["run_id"], p["line_id"]);

    if (!ctx) {
      return;
    }
    await fn(ctx, p);
  };
}

async function resolveCtx(
  deps: LoopProgressDeps,
  runId: string | undefined,
  lineId: string | undefined,
): Promise<Ctx | null> {
  if (!runId || lineId !== LOOP_BLUEPRINT) {
    return null;
  }
  const run = await deps.run(runId);

  if (!run?.repo) {
    return null;
  }
  const prCheckSha = startValueOf(run, "pr_check_sha");

  if (!prCheckSha) {
    return null;
  }

  return { prCheckSha, repo: loreRepoOf(run.repo) };
}

export const loopProgressProductionDeps: LoopProgressDeps = {
  run: async (runId) => {
    const floor = floorIfConfigured();

    return floor ? ((await floor.runs.get(runId))?.run ?? null) : null;
  },
  upsertCheckRun: async (repo, input) => {
    const { repo: repository } = await projectFor(repo);

    await repository.upsertCheckRun(input);
  },
};

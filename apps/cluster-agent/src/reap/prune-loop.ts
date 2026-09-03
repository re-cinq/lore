// The retention half of FR4: a cluster forgets what it finished with — 176 Agent CRs OOMKilled the controller on 2026-08-30. Runs HERE (not Floor-side, #1651); CONNECTION only, decisions live in `decidePrune`.

import { errorMessage } from "@re-cinq/lore-shared";
import { runPollLoop } from "@re-cinq/lore-shared/lib/poll-loop.js";
import { secondsEnvMs } from "../claim/intervals.js";
import {
  decidePrune,
  type PrunableAgent,
  type PrunableRecipe,
} from "./decide-prune.js";

/** Hourly — the backlog it bounds grows over days, so a tighter poll would only list the same objects more often. */
const DEFAULT_INTERVAL_S = 3600;
/** Three days, deliberately generous — run 129235d4 was diagnosed two days after it failed, from `.status.output` alone, after pod logs and telemetry were gone. */
const DEFAULT_TTL_HOURS = 72;
/** Ceiling per tick, so a first sweep over a backlog cannot storm the apiserver. */
const DEFAULT_MAX_PER_TICK = 50;

export function pruneIntervalMs(env: NodeJS.ProcessEnv): number {
  return secondsEnvMs(
    env.LORE_CLUSTER_AGENT_PRUNE_INTERVAL_S,
    DEFAULT_INTERVAL_S,
  );
}

export function pruneTtlMs(env: NodeJS.ProcessEnv): number {
  const hours = Number(env.LORE_CLUSTER_AGENT_CR_TTL_HOURS);

  return (
    (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS) *
    3_600_000
  );
}

/** The cluster reads and writes one sweep needs. */
export interface PruneCluster {
  listAgents(): Promise<PrunableAgent[]>;
  listStations(): Promise<PrunableRecipe[]>;
  listDefinitions(): Promise<PrunableRecipe[]>;
  deleteAgent(name: string): Promise<void>;
  deleteStation(name: string): Promise<void>;
  deleteDefinition(name: string): Promise<void>;
}

export interface PruneDeps {
  cluster: PruneCluster;
  ttlMs: number;
  maxPerTick?: number;
  now?: () => Date;
  log?: (line: string) => void;
}

export type PruneOutcome =
  | { kind: "swept"; agents: number; stations: number; definitions: number }
  | { kind: "nothing" }
  | { kind: "error"; message: string };

/** One sweep. Never throws — every failure shape is an outcome the loop logs. */
export async function pruneOnce(deps: PruneDeps): Promise<PruneOutcome> {
  try {
    const [agents, stations, definitions] = await Promise.all([
      deps.cluster.listAgents(),
      deps.cluster.listStations(),
      deps.cluster.listDefinitions(),
    ]);
    const plan = decidePrune({
      agents,
      stations,
      definitions,
      now: deps.now?.() ?? new Date(),
      ttlMs: deps.ttlMs,
      maxPerTick: deps.maxPerTick ?? DEFAULT_MAX_PER_TICK,
    });

    // Agents FIRST, then their clones — a clone deleted while its CR still stands would leave a run describing a missing recipe. CALLED THROUGH the port, never as a bare method reference (an unbound call loses `this`).
    const deleted = {
      agents: await deleteEach(
        plan.agents,
        (name) => deps.cluster.deleteAgent(name),
        deps,
      ),
      stations: await deleteEach(
        plan.stations,
        (name) => deps.cluster.deleteStation(name),
        deps,
      ),
      definitions: await deleteEach(
        plan.definitions,
        (name) => deps.cluster.deleteDefinition(name),
        deps,
      ),
    };

    if (deleted.agents + deleted.stations + deleted.definitions === 0) {
      return { kind: "nothing" };
    }

    return { kind: "swept", ...deleted };
  } catch (err) {
    return { kind: "error", message: errorMessage(err) };
  }
}

/** Delete each, counting what went. One failure is skipped rather than abandoning the sweep — a wedged finalizer must not keep the rest of the backlog cached. */
async function deleteEach(
  names: string[],
  remove: (name: string) => Promise<void>,
  deps: PruneDeps,
): Promise<number> {
  let deleted = 0;

  for (const name of names) {
    try {
      await remove(name);
      deleted++;
    } catch (err) {
      deps.log?.(
        `[cluster-agent] could not delete ${name}: ${errorMessage(err)}`,
      );
    }
  }

  return deleted;
}

export interface PruneLoopDeps {
  prune: () => Promise<PruneOutcome>;
  sleep: (ms: number) => Promise<void>;
  intervalMs: number;
  running?: () => boolean;
  log?: (line: string) => void;
}

export async function runPruneLoop(deps: PruneLoopDeps): Promise<void> {
  const log = deps.log ?? ((line: string): void => console.log(line));

  await runPollLoop<PruneOutcome>({
    tick: deps.prune,
    onOutcome: (outcome) => {
      if (outcome.kind === "swept") {
        log(
          `[cluster-agent] pruned ${outcome.agents} terminal Agent CR(s), ${outcome.stations} station(s), ${outcome.definitions} definition(s)`,
        );
      }

      if (outcome.kind === "error") {
        log(`[cluster-agent] prune sweep failed: ${outcome.message}`);
      }
    },
    // Flat — an hourly sweep that found nothing is normal, not idleness worth backing off from.
    delayFor: () => deps.intervalMs,
    sleep: deps.sleep,
    running: deps.running,
  });
}

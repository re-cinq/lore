#!/usr/bin/env node
/// <reference types="node" />
// lore-station <type> '<station_input json>' — one assembly-line node per pod; a thin shim over ../stations (shared with the pooled service) that resolves by type through the registry (not a hand-kept Record) so an unmapped type can't reach runtime undetected.

import { Llm } from "@re-cinq/lore-shared/llm/llm.js";
import { parseStationInput } from "@re-cinq/lore-shared/station-input.js";
import { UsageTrackingLlm } from "../stations/lib/llm-usage-tracker.js";
import {
  resultLine,
  eventLine,
  type NodeResult,
} from "@re-cinq/lore-assembly-lines";
import {
  nodeStationFor,
  type NodeStationRun,
  type StationEnv,
} from "../stations/index.js";

/** Resolve by node type; the registry owns the type-to-station mapping. */
const runnerFor = (type: string): NodeStationRun | undefined =>
  nodeStationFor(type)?.run;

// Sums every model call the runner makes for the terminal line, unless a UsagePort is already logging per-call cost (Llm.usageConfigured) — reporting both would double-count spend.
function acquireTracker(): UsageTrackingLlm | null {
  if (Llm.usageConfigured) {
    console.warn(
      "[station] UsagePort configured — per-call cost logging is active; terminal-line usage is suppressed to avoid double-counting",
    );

    return null;
  }

  const tracker = new UsageTrackingLlm(Llm.instance);

  Llm.setInstance(tracker);

  return tracker;
}

function releaseTracker(tracker: UsageTrackingLlm | null): void {
  if (tracker) {
    Llm.setInstance(tracker.inner);
  }
}

function successLine(
  tracker: UsageTrackingLlm | null,
  result: NodeResult,
): string {
  if (!tracker) {
    return resultLine({ ...result, usage: undefined });
  }

  return resultLine(result, undefined, result.usage ?? tracker.totalUsage());
}

export async function runStation(
  type: string,
  inputJson: string,
  env: StationEnv,
  resolve: (type: string) => NodeStationRun | undefined = runnerFor,
): Promise<{ line: string; exitCode: number }> {
  const runner = resolve(type);

  if (!runner) {
    return {
      line: resultLine(null, `unknown station type "${type}"`),
      exitCode: 1,
    };
  }

  const tracker = acquireTracker();

  try {
    const result = await runner(parseStationInput(inputJson), env);

    return { line: successLine(tracker, result), exitCode: 0 };
  } catch (err) {
    return {
      line: resultLine(null, (err as Error).message, tracker?.totalUsage()),
      exitCode: 1,
    };
  } finally {
    releaseTracker(tracker);
  }
}

async function main() {
  const [type, inputJson] = process.argv.slice(2);

  console.log(eventLine(`lore-station ${type ?? "<missing type>"} starting`));

  const { line, exitCode } = await runStation(type ?? "", inputJson ?? "{}", {
    workspaceDir: process.env.WORKSPACE_DIR ?? "/workspace",
  });

  console.log(line);
  process.exit(exitCode);
}

const invokedDirectly = process.argv[1]?.endsWith("main.js");

if (invokedDirectly) {
  main().catch((err) => {
    console.error(
      eventLine(`lore-station main() failed: ${(err as Error).message}`),
    );
    console.error(err);
    process.exit(1);
  });
}

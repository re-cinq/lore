#!/usr/bin/env node
/// <reference types="node" />
// lore-station <type> '<station_input json>' — one assembly-line node per pod.
// The subsystem's exec vendor spawns this argv from the station recipe's
// tool_config.command with the rendered station_input appended. Exit 0 with the
// LORE_NODE_RESULT terminal line for any node outcome (success AND failed);
// exit 1 with is_error for infrastructure failures.
//
// A SHIM. The stations themselves live one folder each under ../stations,
// shared with the pooled service in this same package — this process only turns
// argv into a call and a result into the terminal line. The local runner map it used
// to keep was a `Record<string, …>` parallel to the NodeType enum with nothing
// checking one against the other, so a type with no runner arrived here and died
// at runtime; resolution now goes through the registry, which cannot drift.

import { Llm } from "@re-cinq/lore-shared/llm/llm.js";
import { parseStationInput } from "@re-cinq/lore-shared/station-input.js";
import { UsageTrackingLlm } from "../stations/lib/llm-usage-tracker.js";
import { resultLine, eventLine } from "@re-cinq/lore-assembly-lines";
import {
  nodeStationFor,
  type NodeStationRun,
  type StationEnv,
} from "../stations/index.js";

/** Resolve by node type; the registry owns the type-to-station mapping. */
const runnerFor = (type: string): NodeStationRun | undefined =>
  nodeStationFor(type)?.run;

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

  // Every model call the runner makes — however deep — is summed for the
  // terminal line's cost report; an explicit NodeResult.usage wins, and an
  // infrastructure failure still reports the spend made before it.
  //
  // Exception: a process with a configured UsagePort (Llm.usageConfigured)
  // already writes one pipeline.llm_calls row per call — the other cost
  // transport. Reporting usage on the terminal line too (tracker sum OR the
  // runner's explicit NodeResult.usage, which derives from the same calls)
  // would count the same spend twice at the cost sink, so the line carries
  // none of it.
  const tracker = Llm.usageConfigured
    ? null
    : new UsageTrackingLlm(Llm.instance);

  if (tracker) {
    Llm.setInstance(tracker);
  }

  if (!tracker) {
    console.warn(
      "[station] UsagePort configured — per-call cost logging is active; terminal-line usage is suppressed to avoid double-counting",
    );
  }

  try {
    const result = await runner(parseStationInput(inputJson), env);

    if (!tracker) {
      return { line: resultLine({ ...result, usage: undefined }), exitCode: 0 };
    }

    return {
      line: resultLine(result, undefined, result.usage ?? tracker.totalUsage()),
      exitCode: 0,
    };
  } catch (err) {
    return {
      line: resultLine(null, (err as Error).message, tracker?.totalUsage()),
      exitCode: 1,
    };
  } finally {
    if (tracker) {
      Llm.setInstance(tracker.inner);
    }
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

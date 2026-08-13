#!/usr/bin/env node
/// <reference types="node" />
// lore-station <type> '<station_input json>' — one assembly-line node per pod.
// The subsystem's exec vendor spawns this argv from the station recipe's
// tool_config.command with the rendered station_input appended. Exit 0 with the
// LORE_NODE_RESULT terminal line for any node outcome (success AND failed);
// exit 1 with is_error for infrastructure failures.

import { join } from "node:path";
import { Llm } from "@re-cinq/lore-shared/llm/llm.js";
import { parseStationInput, type StationInput } from "./input.js";
import { UsageTrackingLlm } from "./llm-usage-tracker.js";
import { resultLine, eventLine } from "@re-cinq/lore-assembly-lines";
import { runValidateStation, type StationEnv } from "./stations/validate.js";
import { runGateStation } from "./stations/gate.js";
import { runGithubActionStation } from "./stations/github-action.js";
import { runRetrospectiveStation } from "./stations/retrospective.js";
import { runDetectStation } from "./stations/detect.js";
import { runCommentTriageStation } from "./stations/comment-triage.js";
import { runIngestStation } from "./stations/ingest.js";
import { runIssuesStation } from "./stations/issues.js";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";

export type StationRunner = (
  input: StationInput,
  env: StationEnv,
) => Promise<NodeResult>;

export const stations: Record<string, StationRunner> = {
  validate: runValidateStation,
  gate: runGateStation,
  github_action: runGithubActionStation,
  retrospective: runRetrospectiveStation,
  detect: runDetectStation,
  "comment-triage": runCommentTriageStation,
  ingest: (input, env) =>
    runIngestStation(input, { workspaceDir: join(env.workspaceDir, "target") }),
  issues: (input) => runIssuesStation(input),
};

export async function runStation(
  type: string,
  inputJson: string,
  env: StationEnv,
  runners: Record<string, StationRunner> = stations,
): Promise<{ line: string; exitCode: number }> {
  const runner = runners[type];

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
  } else {
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

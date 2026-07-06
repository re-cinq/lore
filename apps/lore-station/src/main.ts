#!/usr/bin/env node
// lore-station <type> '<station_input json>' — one assembly-line node per pod.
// The subsystem's exec vendor spawns this argv from the station recipe's
// tool_config.command with the rendered station_input appended. Exit 0 with the
// LORE_NODE_RESULT terminal line for any node outcome (success AND failed);
// exit 1 with is_error for infrastructure failures.

import { parseStationInput, type StationInput } from "./input.js";
import { resultLine, eventLine } from "./output.js";
import { runValidateStation, type StationEnv } from "./stations/validate.js";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";

type StationRunner = (input: StationInput, env: StationEnv) => Promise<NodeResult>;

export const stations: Record<string, StationRunner> = {
  validate: runValidateStation,
};

export async function runStation(
  type: string,
  inputJson: string,
  env: StationEnv,
): Promise<{ line: string; exitCode: number }> {
  try {
    const runner = stations[type];

    if (!runner) {
      return { line: resultLine(null, `unknown station type "${type}"`), exitCode: 1 };
    }

    const result = await runner(parseStationInput(inputJson), env);

    return { line: resultLine(result), exitCode: 0 };
  } catch (err) {
    return { line: resultLine(null, (err as Error).message), exitCode: 1 };
  }
}

const invokedDirectly = process.argv[1]?.endsWith("main.js");
if (invokedDirectly) {
  const [type, inputJson] = process.argv.slice(2);
  console.log(eventLine(`lore-station ${type ?? "<missing type>"} starting`));
  runStation(type ?? "", inputJson ?? "{}", {
    workspaceDir: process.env.WORKSPACE_DIR ?? "/workspace",
  }).then(({ line, exitCode }) => {
    console.log(line);
    process.exit(exitCode);
  });
}

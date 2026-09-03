import {
  detectTooling,
  runValidation,
  localValidationExec,
  type ValidationExec,
} from "@re-cinq/lore-shared/repo-validation/repo-validation.js";
import { RelayExecutor } from "./relay/relay-executor.js";
import type { NodeHandler } from "./node-types.js";

export interface ValidateHandlerDeps {
  // Control directory of the BYO toolchain relay (when set, validation runs in the repo's sidecar over the relay instead of locally). NOT SET BY ANY CALLER TODAY — the ADR-025 phase-3 seam; phase 3 is where the station reads LORE_TOOLCHAIN_RELAY and passes the directory here.
  relayDir?: string;
  // Changed files, used to scope lint/typecheck steps.
  changedFiles?: () => string[] | Promise<string[]>;
}

function relayValidationExec(relay: RelayExecutor): ValidationExec {
  return async (command) => {
    const r = await relay.run(command);
    const output = [r.stdout, r.stderr].filter(Boolean).join("\n").trim();

    return { output, passed: r.exitCode === 0 };
  };
}

// The `validate` node handler (ADR-025): detects the repo's toolchain in ctx.gitDir and runs quick checks — locally by default, or in the BYO sidecar over the relay when relayDir is set. A failing check yields `failed`, routed to the line's retry/escalation edge.
export function createValidateHandler(
  deps: ValidateHandlerDeps = {},
): NodeHandler {
  return async (_node, ctx) => {
    const tooling = detectTooling(ctx.gitDir);

    if (tooling.quickChecks.length === 0) {
      return {
        outcome: "success",
        extras: {
          "Lore-Validation": "none",
          "Lore-Validation-Lang": tooling.language,
        },
      };
    }

    const exec = deps.relayDir
      ? relayValidationExec(new RelayExecutor(deps.relayDir))
      : localValidationExec;
    const changed = deps.changedFiles ? await deps.changedFiles() : undefined;
    const result = await runValidation(
      ctx.gitDir,
      tooling.quickChecks,
      changed,
      exec,
    );

    const failedSteps = result.steps.filter((s) => !s.passed);
    const failed = failedSteps.map((s) => s.name);

    return {
      outcome: result.passed ? "success" : "failed",
      extras: {
        "Lore-Validation": result.passed ? "passed" : "failed",
        "Lore-Validation-Lang": tooling.language,
        ...(failed.length
          ? {
              "Lore-Validation-Failed": failed.join(","),
              "Lore-Validation-Output": failureOutput(failedSteps),
            }
          : {}),
      },
    };
  };
}

// How much of the failed commands' output travels with the result — bounded twice: the LORE_NODE_RESULT line in a CR's status (apiserver refuses ~2 MiB+, a run has already been lost that way) and what's useful feedback for the fixing agent. Per-step output is already truncated by runValidation; this is the tighter bound across all of them.
const MAX_FAILURE_OUTPUT_CHARS = 2000;

// The failed commands' own words (which command, what it printed) — reporting only WHICH check died left the fixing agent unable to see the errors, repeating itself until the iteration cap.
function failureOutput(
  steps: readonly { name: string; output: string }[],
): string {
  const joined = steps
    .map((s) => `$ ${s.name}\n${s.output.trim()}`)
    .join("\n\n")
    .trim();

  return joined.length <= MAX_FAILURE_OUTPUT_CHARS
    ? joined
    : `${joined.substring(0, MAX_FAILURE_OUTPUT_CHARS)}\n...(truncated)`;
}

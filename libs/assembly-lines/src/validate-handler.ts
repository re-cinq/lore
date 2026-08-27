import {
  detectTooling,
  runValidation,
  localValidationExec,
  type ValidationExec,
} from "@re-cinq/lore-shared/repo-validation/repo-validation.js";
import { RelayExecutor } from "./relay/relay-executor.js";
import type { NodeHandler } from "./node-types.js";

export interface ValidateHandlerDeps {
  /**
   * Control directory of the BYO toolchain relay. When set, validation commands
   * run in the repo's sidecar container over the relay; otherwise they run
   * locally in the kernel container.
   *
   * NOT SET BY ANY CALLER TODAY. This is the ADR-025 phase-3 seam: nothing reads
   * `LORE_TOOLCHAIN_RELAY` yet, and the doc used to name that variable as though
   * setting it would do something. Phase 3 is where the station reads it and
   * passes the directory here.
   */
  relayDir?: string;
  /** Changed files, used to scope lint/typecheck steps. */
  changedFiles?: () => string[] | Promise<string[]>;
}

function relayValidationExec(relay: RelayExecutor): ValidationExec {
  return async (command) => {
    const r = await relay.run(command);
    const output = [r.stdout, r.stderr].filter(Boolean).join("\n").trim();

    return { output, passed: r.exitCode === 0 };
  };
}

/**
 * The `validate` node handler (ADR-025). Detects the repo's toolchain in
 * `ctx.gitDir` and runs its quick checks (lint / typecheck). Locally by default;
 * in the **BYO toolchain sidecar over the relay** when `relayDir` is set — so
 * `go vet` / `mypy` / `cargo check` execute in the repo's native toolchain
 * instead of the Node-only kernel image. A failing check yields `failed`, which
 * the assembly line routes to its retry / escalation edge.
 */
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

/**
 * How much of the failed commands' output travels with the result.
 *
 * It has to be bounded twice over: this rides the `LORE_NODE_RESULT` line in an
 * Agent CR's status (the apiserver refuses an object past ~2 MiB, and a run has
 * already been lost that way), and it is fed back to the agent that has to fix
 * it, where a wall of repeated stack traces buys nothing over the first
 * screenful. Per-step output arrives already truncated by `runValidation`; this
 * is the second, tighter bound across all of them.
 */
const MAX_FAILURE_OUTPUT_CHARS = 2000;

/**
 * The failed commands' own words — which command, and what it printed.
 *
 * Reporting only WHICH check died ("lint,build") was the whole of the signal
 * before, and it is not enough to act on: the agent sent back to fix the code
 * could not see the errors, so it re-ran the same instruction and failed the
 * same way until the iteration cap. The compiler already said what was wrong;
 * this stops throwing it away.
 */
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

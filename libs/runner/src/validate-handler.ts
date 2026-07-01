import {
  detectTooling,
  runValidation,
  localValidationExec,
  type ValidationExec,
} from "@re-cinq/lore-shared/repo-validation/repo-validation.js";
import { RelayExecutor } from "./relay/relay-executor.js";
import type { NodeHandler } from "./assembly-line-executor.js";

export interface ValidateHandlerDeps {
  /**
   * Control directory of the BYO toolchain relay (from `LORE_TOOLCHAIN_RELAY`).
   * When set, validation commands run in the repo's sidecar container over the
   * relay; otherwise they run locally in the kernel container.
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
 * the workflow routes to its retry / escalation edge.
 */
export function createValidateHandler(
  deps: ValidateHandlerDeps = {},
): NodeHandler {
  return async (_node, ctx) => {
    const tooling = detectTooling(ctx.gitDir);
    if (tooling.quickChecks.length === 0) {
      return {
        outcome: "success",
        extras: { "Lore-Validation": "none", "Lore-Validation-Lang": tooling.language },
      };
    }

    const exec = deps.relayDir
      ? relayValidationExec(new RelayExecutor(deps.relayDir))
      : localValidationExec;
    const changed = deps.changedFiles ? await deps.changedFiles() : undefined;
    const result = await runValidation(ctx.gitDir, tooling.quickChecks, changed, exec);

    const failed = result.steps.filter((s) => !s.passed).map((s) => s.name);
    return {
      outcome: result.passed ? "success" : "failed",
      extras: {
        "Lore-Validation": result.passed ? "passed" : "failed",
        "Lore-Validation-Lang": tooling.language,
        ...(failed.length ? { "Lore-Validation-Failed": failed.join(",") } : {}),
      },
    };
  };
}

import { enforceTrue } from "../../lib/enforce.js";
/** Execution trust boundary: shared GKE server cannot execute repo commands. */

export function executionRefusal(env: NodeJS.ProcessEnv): string | null {
  return env.LORE_DB_HOST
    ? "Test commands run only in a trusted sandbox — run in CI or locally."
    : null;
}

export function assertCanClone(env: NodeJS.ProcessEnv): void {
  enforceTrue(
    !env.LORE_DB_HOST,
    Error,
    "Cannot clone or write to a repo on the shared server — run in CI or locally.",
  );
}

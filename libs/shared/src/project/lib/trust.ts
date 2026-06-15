/**
 * The execution trust boundary, in one place. Relocated verbatim from
 * mcp-server/src/spec-trace-tools.ts (executionRefusal) so the tests port AND
 * Workspace clone gate share one rule. mcp-server keeps a re-export for
 * back-compat during migration.
 *
 * The shared GKE server (LORE_DB_HOST set) must never execute repo commands or
 * clone repos — only a trusted sandbox (local dev / CI / claude-runner pod) may.
 */

export function executionRefusal(env: NodeJS.ProcessEnv): string | null {
  return env.LORE_DB_HOST
    ? "Test commands run only in a trusted sandbox — run in CI or locally."
    : null;
}

export function assertCanClone(env: NodeJS.ProcessEnv): void {
  if (env.LORE_DB_HOST) {
    throw new Error("Cannot clone or write to a repo on the shared server — run in CI or locally.");
  }
}

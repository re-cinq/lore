/**
 * The plugin's single gateway to `@re-cinq/lore-shared`.
 *
 * Imports of the shared workspace lib resolve to its BUILT dist, which a
 * fresh checkout/worktree does not have (#950) — and when resolution escapes
 * an uninstalled worktree it lands on the main checkout's possibly-stale
 * dist. A bare static import kills the whole eslint run with an opaque
 * ERR_MODULE_NOT_FOUND stack, so every shared import funnels through this
 * one guarded loader and fails with the actual remedy instead. Rules import
 * the re-exported names below — never `@re-cinq/lore-shared` directly.
 */

async function importShared(subpath) {
  try {
    return await import(`@re-cinq/lore-shared/${subpath}`);
  } catch (cause) {
    throw new Error(
      `[eslint-plugin-lore] cannot import @re-cinq/lore-shared/${subpath} — ` +
        "this checkout is missing its npm install or the workspace-lib build " +
        "(typical for a fresh git worktree). Run scripts/worktree-bootstrap.sh " +
        "from the repo root, then re-run eslint.",
      { cause },
    );
  }
}

export const { parseDocStatus, statusTier } =
  await importShared("spec-status.js");

export const {
  coverageTier,
  expectedStatus,
  statementCoverage,
  statusLabel,
  unlinkedTestableStatements,
} = await importShared("spec-status-coverage.js");

export const { linksForStatements, resolveLinkPath } = await importShared(
  "spec-link-parser.js",
);

export const { isTestFile } = await importShared("test-paths.js");

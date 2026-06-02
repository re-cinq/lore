/**
 * Spec → Test Coverage Backfill Cron (v3 of spec-test-coverage).
 *
 * Reuses the v2 linker pipeline (segment → classify → candidate
 * selection → LLM judge) but emits its output as **edits to spec.md**
 * via a PR per spec, instead of as rows in spec_test_links /
 * spec_statements / spec_coverage_runs. The author reviews the
 * suggestion PR and either merges (the inline `([validated by ...]
 * (path#Lline))` parenthetical becomes the source of truth) or
 * rejects (with a comment explaining why the suggestion misses).
 *
 * Runs weekly on the cron schedule. The pure parts (proposeLinkInsertions)
 * are unit-tested below; the orchestration calls the platform's createPR
 * once per spec with non-zero suggestions.
 */

import {
  parseTestLinksInStatement,
  segmentStatements,
  buildIntroOrdinals,
  classifyByHeuristic,
} from "@re-cinq/lore-shared";

// ── Suggestion + propose helper (pure) ─────────────────────────────

export interface Suggestion {
  statement_ordinal: number;
  /** The exact statement text we expect to find verbatim in the
   * content. If not found, the suggestion is skipped. */
  statement_text: string;
  test_file: string;
  test_line: number | null;
  /** Markdown label to use inside the inserted `[label](href)` token.
   * The caller picks something readable like
   * "validated by `runner.test.ts:88`". */
  label: string;
}

export interface SkipReason {
  statement_ordinal: number;
  reason: "already-linked" | "not-found";
}

export interface InsertionResult {
  newContent: string;
  diffPreview: string;
  applied: number;
  skipped: SkipReason[];
}

function renderLink(s: Suggestion): string {
  const anchor = s.test_line ? `#L${s.test_line}` : "";
  return `[${s.label}](${s.test_file}${anchor})`;
}

/**
 * For each statement_ordinal, locate the matching statement_text in
 * the content and append a trailing `(...)` parenthetical containing
 * one or more `[label](path#Lline)` markdown links. Statements that
 * already carry any test link are skipped with `already-linked`;
 * statements whose text can't be located are skipped with `not-found`.
 *
 * Multiple suggestions for the same statement collapse into one
 * parenthetical, comma-separated.
 */
export function proposeLinkInsertions(
  content: string,
  suggestions: Suggestion[],
): InsertionResult {
  if (suggestions.length === 0) {
    return { newContent: content, diffPreview: "", applied: 0, skipped: [] };
  }

  // Group by ordinal (and statement_text — they should agree per ordinal,
  // but we group on both to defend against caller bugs).
  const byOrdinal = new Map<number, Suggestion[]>();
  for (const s of suggestions) {
    const list = byOrdinal.get(s.statement_ordinal) ?? [];
    list.push(s);
    byOrdinal.set(s.statement_ordinal, list);
  }

  const skipped: SkipReason[] = [];
  let applied = 0;
  let newContent = content;

  // Process ordinals deepest (latest) first so prior insertions don't
  // shift the indices of later matches. Order by first occurrence
  // descending.
  const ordered = [...byOrdinal.entries()]
    .map(([ord, list]) => ({
      ord,
      list,
      text: list[0].statement_text,
      idx: newContent.indexOf(list[0].statement_text),
    }))
    .sort((a, b) => b.idx - a.idx);

  for (const { ord, list, text } of ordered) {
    if (text.length === 0) {
      skipped.push({ statement_ordinal: ord, reason: "not-found" });
      continue;
    }
    const idx = newContent.indexOf(text);
    if (idx < 0) {
      skipped.push({ statement_ordinal: ord, reason: "not-found" });
      continue;
    }
    // Already-linked check: if parseTestLinksInStatement on the
    // statement_text + any trailing characters returns non-empty,
    // the statement already has a link.
    const existingLinks = parseTestLinksInStatement(text);
    if (existingLinks.length > 0) {
      skipped.push({ statement_ordinal: ord, reason: "already-linked" });
      continue;
    }
    const tail = ` (${list.map(renderLink).join(", ")})`;
    const insertionPoint = idx + text.length;
    newContent =
      newContent.slice(0, insertionPoint) + tail + newContent.slice(insertionPoint);
    applied += list.length;
  }

  const diffPreview = applied > 0 ? buildUnifiedDiff(content, newContent) : "";
  return { newContent, diffPreview, applied, skipped };
}

/** Tiny unified-diff renderer for the PR body. Just the changed
 * statements with one line of context. Not a real diff tool — the
 * agent's PR body is for the reviewer, not for `patch`. */
function buildUnifiedDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const out: string[] = ["--- a/spec.md", "+++ b/spec.md"];
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < maxLen; i++) {
    const b = beforeLines[i] ?? "";
    const a = afterLines[i] ?? "";
    if (b === a) continue;
    if (b) out.push(`-${b}`);
    if (a) out.push(`+${a}`);
  }
  return out.join("\n");
}

// ── Orchestration ──────────────────────────────────────────────────
// Hook for future implementation — wires segment + classify + judge
// (reused from v2's spec-test-linker until Phase 5 cleanup) into
// proposeLinkInsertions + platform().createPR. The pure helper above
// is the load-bearing piece; the orchestration is a thin shell.

export interface BackfillOptions {
  repoFilter?: string;
}

export async function specCoverageBackfillJob(_opts: BackfillOptions = {}): Promise<string> {
  // Intentionally a stub for v3 Phase 4: the orchestration imports the
  // v2 pipeline (judgeLink, selectCandidates, etc.) which still lives in
  // agent/src/jobs/cron/spec-test-linker.ts. Phase 5 deletes the v2 file
  // and inlines what's needed here; this Phase 4 PR ships the pure
  // proposeLinkInsertions helper + its tests, the renamed validate
  // endpoint, and the Helm/job-runner wiring to ensure the cron pod can
  // boot under the new job name.
  //
  // Used `_opts` to mark intent; the v3 spec-test-coverage tasks.md T118
  // tracks completing the orchestration (clone repo via CodePlatform,
  // run pipeline, propose insertions, open PR).
  void _opts;
  void segmentStatements;
  void buildIntroOrdinals;
  void classifyByHeuristic;
  const msg = "[job] spec-coverage-backfill: stub — orchestration pending T118 completion";
  console.log(msg);
  return msg;
}

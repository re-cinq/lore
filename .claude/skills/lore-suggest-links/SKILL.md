---
name: lore-suggest-links
description: Suggest inline test-link parentheticals for un-linked testable statements in a spec.md. Subscription-billed, on-demand, single-spec sibling to the weekly spec-coverage-backfill cron. Works against the developer's local working tree; opens a PR with the suggested edits.
---

You are helping a developer add inline test-link parentheticals to a
spec.md in the v3 `spec-test-coverage` format:

    Statement text. ([validated by `runner.test.ts:88`](path/to/runner.test.ts#L88))

The Lore backfill cron does this org-wide every Monday at 11:00 UTC.
**This skill does the same for one spec, on demand, using the
developer's Claude Code subscription instead of waiting for the cron.**

Zero Lore infrastructure required. No MCP tools. No `LORE_API_URL`.
No DB writes. The output is a PR against the spec's repo, opened via
`gh`.

## Argument parsing

The developer invokes:

    /lore-suggest-links {spec_path}

If they omit `spec_path`, ask: "Which spec? (e.g. `specs/x/spec.md`)"
If they give a full URL or absolute path, normalize to repo-relative.

Before any work: confirm `pwd` is inside the spec's repo. If not,
stop and tell them to `cd` to the right checkout. The skill operates
on the developer's local working tree.

## The flow

Walk through these stages in order. Show short progress notes after
each so the developer can follow along.

### 1. Read + segment the spec

Use `Read` on the spec_path. Segment the content into **statements**:

- Each prose paragraph is split into sentences on `.?!` followed by
  whitespace and an uppercase letter / digit / open bracket. Guard
  against abbreviations: don't split after `e.g.`, `i.e.`, `etc.`,
  `vs.`, `Mr.`, `Mrs.`, `Dr.`, single-letter initials (`U.S.`,
  `F.B.I.`), or version tags (`v1.`, `v2.`).
- Each markdown list item is one statement. List-item continuation
  lines (indented under the bullet) get joined into the same
  statement with single spaces.
- Headings, fenced code blocks (``` … ```), and tables (lines
  starting and ending with `|`) are **excluded** entirely — they
  produce no statements.

Track each statement's **enclosing heading** (the most recent `#…`
line above it). You'll use this for the section heuristic.

### 2. Classify statements (heuristic)

For each statement, decide `testable` vs `untestable`:

**Untestable categories** (section-heading match — case-insensitive):

| If enclosing heading contains | Category |
|---|---|
| "Problem Statement" or "Background" or "Context" | background |
| "Vision" or "Goals & Non-Goals" or "Non-Goals" | vision |
| "Clarification" (any) | clarification |
| "Open Questions" | open-question |
| "Limitations" or "Known Gotchas" | limitation |
| "Rationale" or "Why" | rationale |
| Anything under the H1 itself (intro paragraph) | intro |

**Everything else** defaults to `testable`. Bias toward testable when
unsure — a false-testable surfaces a harmless red gap in the UI; a
false-untestable silently hides a real one.

For statements the heuristic can't decide (no enclosing heading match,
but the statement reads like prose / vision / rationale to you), use
your own judgement — but lean testable.

### 3. Filter to the backfill set

Drop any statement that:

- Was classified `untestable` (narrative — not in scope), OR
- Already has a trailing test link. To detect: parse the statement's
  trailing `(...)` parenthetical (if any) for `[label](href)` markdown
  links; if any link's `href` path passes `isTestFile()` (matches
  `.test.`, `.spec.`, `_test.`, `__tests__/`, or `_test.go$`), the
  statement is already linked — skip it.

What remains is the **backfill candidate set**: testable + un-linked.

Report progress: e.g. `12 testable, 8 already linked, 4 candidates`.

If the candidate set is empty, tell the developer: "Nothing to
backfill — every testable statement already has a link." Stop here
(do not commit, do not open a PR).

### 4. Discover candidate tests in this repo

Use `Glob` and `Grep` to find tests that might validate the
candidate statements.

**Glob patterns** for test files:

```
**/*.test.{ts,tsx,js,jsx}
**/*.spec.{ts,tsx,js,jsx}
**/*_test.go
**/*_test.py
**/__tests__/*.{ts,tsx,js,jsx,py}
```

Skip `node_modules/`, `dist/`, `build/`, `.next/`, `vendor/`.

**Pre-filter signals** to narrow the candidate set before reading:

1. **Assertion overlap (strongest signal).** For each named code
   symbol the spec references (function names, class names, type
   names, endpoints — you'll see these in `code spans` and in
   `path/to/file.ts:N` references), `Grep -l` for that symbol in
   the test glob. Test files that reference any of the spec's
   symbols are strong candidates.
2. **Directory affinity.** If the spec's path is
   `specs/local-task-runner/spec.md`, the slug is
   `local-task-runner`. Tests in directories whose names share
   significant tokens with that slug (e.g.
   `mcp-server/src/local-runner.test.ts` shares `local` + `runner`)
   are candidates.

Cap the candidate set at ~25 (or whatever produces a workable list).
Report: `Found N test files, narrowed to M candidates.`

### 5. Judge

For each candidate statement, decide which **single** test most
strongly validates it.

For each candidate test you're considering, `Read` the relevant
portion of the file (you don't need to read 2000-line files in
full — focus on the `describe`/`it` block names and the lines that
make assertions).

Decision rules:

- **One test ↔ at most one statement.** A test that exercises
  multiple statements gets assigned to its strongest match (highest
  confidence).
- **One statement ↔ many tests is fine.** Multiple tests can validate
  the same statement; they all get linked.
- **Threshold.** If your confidence is below ~50%, skip the
  suggestion. A false-positive link is worse than a missing link —
  the cron's `argmaxByTest` enforces τ=0.5; do the same.
- **Score in your head.** Not asked to emit a number; just reason.
  Confidence > 80% → clear behavioural match. 50-80% → plausible.
  < 50% → drop.

For each match, record a **one-sentence rationale** referencing the
behaviour validated, not the vocabulary (e.g. "exercises the
SKIP LOCKED claim query", not "test name mentions `claimNextTask`").

If a statement has zero clear matches across all candidates, leave it
un-linked. Don't force a suggestion.

### 6. Resolve line numbers

For each test → statement match, find the line number of the test's
`it(...)` / `func TestX` / `def test_x` definition.

Use `Bash grep -n` to find the line. Examples:

```
# TS/JS
grep -n "it('claims pending task" mcp-server/src/local-runner.test.ts
# returns: 88:  it('claims pending task before GKE', async () => {

# Go
grep -n "^func TestClaim" agent/src/supervisor/lease_test.go

# Python
grep -n "def test_claim" agent/src/supervisor/test_lease.py
```

If the test file uses a different convention (Java `@Test` annotations,
test-name-from-class), use whatever line points at the test's start.
If `grep -n` returns multiple matches (e.g. duplicate test names),
take the first; the developer can correct the link in review.

If no line can be resolved, fall back to a file-level link (no
`#Lline` anchor): `[validated by \`local-runner.test.ts\`](path/to/local-runner.test.ts)`.

### 7. Compose the suggestions

For each match, the inserted parenthetical is:

```
 ([validated by `{filename}:{line}`](path/to/file.ext#L{line}))
```

- `filename` = the file's basename (`local-runner.test.ts`, not the
  full path).
- `line` = the resolved line number.
- The full `path/to/file.ext` (repo-relative, no leading slash) goes
  in the `()` href.
- When `line` is null (file-level fallback), omit the `#Lline` anchor
  in the href and omit the `:{line}` suffix in the label:
  `([validated by \`local-runner.test.ts\`](mcp-server/src/local-runner.test.ts))`.

**Multiple tests for the same statement** collapse into one
parenthetical, comma-separated:

```
Statement text. ([primary](path/a.test.ts#L10), [edge case](path/b.test.ts#L42))
```

### 8. Apply via Edit

For each statement → suggestion, use `Edit` to append the
parenthetical at the end of the statement, before any trailing
period or newline.

- The `old_string` is the exact statement text as it appears in the
  spec source (with the original markdown formatting).
- The `new_string` is the same text plus the trailing ` (…)`.

Process statements in **reverse order of appearance** in the file so
earlier edits don't shift later line numbers. (Edit does exact-text
matching, so line numbers don't matter to it — but reverse order is a
safe habit anyway.)

If `Edit` fails (the exact text isn't found — e.g. the spec used
inline formatting like `**bold**` that segments differently),
report it as a per-statement skip and move on. Don't bail the whole
run.

After all edits, report: `Applied N suggestions, skipped M.`

### 9. Show the diff and confirm

Run `git diff -- {spec_path}` and show the developer the result.

Ask: **"Open a PR with these suggestions? [y/n]"**

This step is mandatory — opening a PR is a visible action that
affects shared state (per the global guidance on confirming actions
before taking them).

If `n`: leave the working-tree edits in place and stop. The developer
can commit themselves or undo with `git restore`.

If `y`: continue to step 10.

### 10. Branch + commit + PR

Generate the branch name:

```
slug = spec_path
  .replace(/^specs\//, "")
  .replace(/\.md$/, "")
  .replace(/[^a-zA-Z0-9._/-]/g, "-")
  .replace(/\/+/g, "-")
  .slice(0, 60)

timestamp = ISO date minus separators, e.g. "202606031125"

branch = `lore/spec-coverage-backfill/{slug}-{timestamp}`
```

Then:

```bash
git checkout -b "$branch"
git add "$spec_path"
git commit -m "lore: backfill suggested test links for $spec_path"
git push -u origin "$branch"

gh pr create \
  --title "Suggested test links for $spec_path" \
  --label lore-managed \
  --label spec-coverage-backfill \
  --body "$(cat <<EOF
# Suggested test links for \`$spec_path\`

Suggestions emitted by \`/lore-suggest-links\` (subscription-billed,
on-demand sibling to the weekly \`spec-coverage-backfill\` cron).

## Rationales

{one bullet per match, with rationale}

## Diff

\`\`\`diff
{output of \`git diff main -- $spec_path\`, capped at 8KB}
\`\`\`

_This PR is idempotent against the weekly cron — already-linked
statements are skipped._
EOF
)"
```

Report the PR URL back to the developer.

## Rules

- **Confirm before pushing or opening the PR.** Step 9 is the gate.
  Edits in the working tree are fine without confirmation; visible
  actions need explicit `y`.
- **Don't push to `main` directly.** Always a feature branch.
- **Don't open a PR with zero suggestions.** Step 3 stops early if
  the backfill set is empty; this avoids no-op PRs.
- **Match the cron's branch/commit/label conventions exactly.** This
  is so reviewers, dashboards, and automation see uniform PR shapes
  regardless of which path opened the PR.
- **Be honest about uncertainty.** When you can't find a clear single-
  test match, leave the statement un-linked. Don't force suggestions
  just to hit a count.
- **No DB writes.** This skill never touches Lore's DB. If the
  developer asks "did this update Lore's coverage tracking?", the
  answer is "Lore reads the spec.md directly — your PR merging is
  the only state change."

## Output format

After each major step (segment, classify, discover, judge, edit,
PR), output a short status line so the developer can follow along.
Don't dump huge intermediate results; just counts + the next action.

The frozen example transcript at
[`example.md`](./example.md) shows the canonical happy-path shape.
Read it once to calibrate; do not paste it back verbatim.

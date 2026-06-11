# Tasks: Local Link Suggester

Implements [`specs/local-link-suggester/spec.md`](./spec.md) — the
subscription-billed, on-demand sibling to `spec-coverage-backfill`'s
weekly cron. Zero new infrastructure for v1: a skill file + an
example transcript + a small CLAUDE.md / tasks.md note.

## Phase 1 — Skill (v1, prose-driven)

- [x] T201 Build `.claude/skills/lore-suggest-links/SKILL.md` walking Claude through: parse args (`spec_path`, optional `repo` for cwd verification) → `Read` the spec → segment statements per the v3 segmenter rules (sentences + list items, abbreviation guard, headings/code/tables excluded) → apply the section heuristic to flag narrative vs testable (Problem Statement / Vision / Background / Clarifications / Open Questions / Limitations / Rationale + H1 intro → narrative) → check each statement for an existing test link in the trailing parenthetical → for the testable un-linked set, `Glob` test files (`*.test.*`, `*.spec.*`, `*_test.*`, `__tests__/`) → `Grep` for assertion symbols the spec names + for tests in feature-directory-affined paths → `Read` candidate test bodies and reason about which test validates which statement → `Bash grep -n` for the `it(...)` / `func Test...` line to resolve the line number → `Edit` the spec to insert `([validated by \`{file}:{line}\`](path#L{line}))` at end of each matched statement → `Bash` to `git checkout -b lore/spec-coverage-backfill/{slug}-{ts}`, `git add`, `git commit -m 'lore: backfill suggested test links for {spec_path}'`, `git push -u origin`, `gh pr create --label lore-managed --label spec-coverage-backfill --title '...' --body '...'`. Same commit message + branch + labels as the cron so PR shapes are uniform across both paths.
- [x] T202 Build `.claude/skills/lore-suggest-links/example.md` — frozen happy-path transcript on a hand-crafted demo spec (mirror the `lore-link-coverage` example's style from before that skill was deleted). Show: the segment + classify report, the candidate count after pre-filter, three statement → test matches with rationales, the PR creation step, and the final PR URL placeholder.
- [x] T203 Verify the skill appears in the available-skills list when Claude is started in this repo (check that the YAML frontmatter `name:` and `description:` fields lint).

## Phase 2 — Docs

- [x] T204 Update `CLAUDE.md` under the `spec-test-coverage` paragraph: add one sentence pointing at `/lore-suggest-links` for on-demand subscription-billed single-spec suggestions, contrasted with the cron's weekly org-wide sweep. Three-path summary: authors hand-write (free) / `/lore-suggest-links` (subscription) / cron (API key).
- [x] T205 In `specs/spec-test-coverage/tasks.md` Phase 7 follow-ups, mark `F-local-on-demand` as `[x]` (this spec landed); add a one-line pointer at `specs/local-link-suggester/`.

## Phase 3 — Verify

- [ ] T206 Manual end-to-end on one real spec in this repo: pick a spec with at least 3 un-linked testable statements (e.g. `specs/spec-test-coverage/spec.md`), run `/lore-suggest-links` in a fresh Claude session, verify each step happens and the resulting PR opens cleanly. Document the wall-clock + the number of subscription tokens used in the example.md. **Deferred** — requires a real `/lore-suggest-links` invocation by the developer in a target repo.

## Phase 4 — Follow-ups (deferred, not in v1)

- [ ] F-cli-prep Add `agent/src/cli/lore-suggest-prep.ts` (or a `scripts/lore-suggest-prep`) shim that runs the deterministic helpers from `@re-cinq/lore-shared` locally (segment → classify → selectCandidates) and emits structured JSON for the skill to reason over. Tighter precision than the prose-driven Glob + Grep approach. Worth building only if v1 proves too lossy on noisy repos. (Spec §Limitations 1.)
- [ ] F-ingested-spec Allow the skill to operate against the *ingested* spec via `lore_assemble_context` / `lore_search_context` when the developer isn't in the right local checkout. (Spec §Decisions deferred.)
- [ ] F-batch-sweep An "all-stale-specs in this repo" mode that loops `/lore-suggest-links` over every spec with zero or partial coverage. (Spec §Decisions deferred.)
- [ ] F-suggestion-telemetry Record suggestion-PR outcomes (merged / closed / partially-merged) back to a memory so future skill invocations can calibrate. (Spec §Limitations 4.)
- [ ] F-coverage-aware When `specs/coverage-ingestion/` ships, surface coverage hits to the developer's session as extra evidence for the judge. (Spec §Limitations 5.)

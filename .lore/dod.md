# Definition of Done

> A run's `.lore/dod.md` leaked onto main with #1914

**Strategy: `parallel-change`** — no deterministic seam exists. Today the only
removal of `.lore/dod.md` is the `pr-ready` agent prompt's `git rm .lore/dod.md`
(scripts/task-types.yaml), which #1914's pod skipped, so the squash carried the
scaffolding onto `main`. The Floor's deterministic pr-ready step
(`markPrReady` in `apps/floor/src/work/assembly-run/node-event-deps.ts`) is where
the strip belongs — it already updates the PR body and un-drafts it, and it is
not independently unit-testable. So the strip decision is built beside the
existing pr-ready pure helpers in `apps/floor/src/work/assembly-run/spec-pr.ts`
(the module `markPrReady` already imports `readyPrBody`/`decideMarkReady` from);
the next pod wires `markPrReady` to delete those paths from the branch via a new
branch-delete port op and takes the removal off the agent's discretion.

## Done when these pass

- [ ] **strips .lore/dod.md from the branch so scaffolding never reaches a
  reviewer** — `scaffoldingToStrip` returns `.lore/dod.md` from a pr-ready
  branch's file list and leaves the real change alone, so the deterministic
  pr-ready strip removes the scaffolding whatever the pod did.
  `apps/floor/src/work/assembly-run/spec-pr.test.ts`

## Facets

- [ ] RED: add `scaffoldingToStrip` acceptance test (done here).
- [ ] GREEN: add pure `scaffoldingToStrip(branchFiles)` to `spec-pr.ts`.
- [ ] Wire `markPrReady` to delete the returned paths from the branch before it
  un-drafts the PR (new branch-delete op on the GitHub/pulls port; `commitFile`
  today only creates/updates).
- [ ] Amend spec.md FR6 line 137 prose so it names the deterministic strip
  rather than the agent's final commit.

## Out of scope

- Removing `.lore/dod.md` from `origin/main` itself — #1914's copy was already
  cleaned up by #1694; this ticket prevents the *next* leak.
- `.lore/pr-body.md` leakage — a separate closed issue (#1746, spec FR6 line 132).
- Auto-merge (`apps/floor/src/work/merge/auto-merge.ts`): implementation-loop PRs
  are human-merged, so stripping only at squash would not cover them; the strip
  belongs at pr-ready, before the file is ever in the PR.

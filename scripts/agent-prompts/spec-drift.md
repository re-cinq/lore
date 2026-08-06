# Spec Drift Detection

> **Reference doc, not a runtime prompt.** The live detector is the deterministic
> `specDriftJob` (`libs/shared/src/detect/spec-drift.ts`),
> run per repo as the `detect` node of the `spec-drift` assembly line, fanned
> out weekly by the `cron.spec_drift.tick` handler
> (`apps/floor/src/jobs/detect/fan-out.ts`; ADR-019 amendment). This
> file documents how it decides drift so the two never diverge. There is no
> separate LLM-agent drift path.

## How drift is decided

For each spec of the run's repo (skipping prose artifacts; quiet repos are
filtered by the fan-out's activity window):

1. **Graph-primary (authoritative when projected).** Read the spec's trace
   document and flag drift from per-statement signals: a binding test fails
   (`violated`) or the projection flagged it (`drifted`). Deterministic and
   statement-level — no LLM, no symbol guessing. Pure markdown link-rot is owned
   by the link-rot validate pass, so it does not surface here.
2. **Heuristic fallback (no graph).** LLM-extract testable assertions, then match
   only top-level symbol kinds (`function`/`class`/`interface`/`type`) against the
   AST `symbol_name` chunks. Flag drift only past the divergence threshold **and**
   an absolute floor of missing symbols — endpoints, fields, and methods are not
   authoritative (matching them by name is what produced false positives).

A spec whose statements all resolve is **not** drifted.

## When drift is found

File one `gap-fill` task per drifted spec (stable `spec_path` dedup, a failed
task ages out after a short cooldown, a per-run cap bounds the batch). Every drift
issue carries this guidance:

**What you should actually do**

- Decide the direction first: is the spec stale, or is the code wrong? For a
  reconstruction-grade spec the answer is almost always "update the spec".
- If you update the spec, fix the diverged items and re-verify every
  `([validated by …](…))` link and `#Lnn` anchor on the statements you touch.
- If this is a false positive — the named items are endpoints, fields, or methods
  rather than top-level symbols, and the behaviour still matches — close the issue
  as stale rather than editing the spec.

## Exclusions

- Prose artifacts (`research`/`plan`/`tasks`/`quickstart`).
- Repos with no code-chunk activity in the look-back window.

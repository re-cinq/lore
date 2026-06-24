## Why

<!-- What problem does this solve? Link the issue, spec, or feature request. Explain the motivation, not just the mechanics. -->

## What Changed

<!-- The concrete changes, as bullets. What a reviewer should look at first. -->

-
-

## Alternatives Considered

<!-- Approaches you rejected and why. If there were none worth weighing, say so explicitly. -->

## ADRs & Architecture

<!-- Link any ADRs this PR introduces, implements, or supersedes (adrs/ADR-NNN-*.md).
     Link the spec if one exists (specs/<feature>/spec.md). Note any new cross-component
     contracts, schema migrations (ui-helm/migrations/NNNN_*.sql), or new env vars. -->

- ADR(s):
- Spec:

## Testing

<!-- How you verified this. Commands run, cases covered, manual steps, and anything a
     reviewer needs to reproduce. Note what is intentionally not covered. -->

## Checklist

- [ ] Lint passes (`npm run lint` / `yarn eslint`, max-warnings 0)
- [ ] Types pass (`npm run typecheck` / `yarn tsc`, strict mode, no `any`)
- [ ] Tests added or updated, and the suite passes
- [ ] No secrets, keys, tokens, or credentials committed (env vars / K8s Secrets only)
- [ ] Docs updated where behavior changed (CLAUDE.md, README, runbooks, specs)
- [ ] PR body includes the `Lore-Task: <uuid>` trailer when this branch is Lore-managed
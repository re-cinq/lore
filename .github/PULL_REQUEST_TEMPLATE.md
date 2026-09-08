## Why

<!-- What problem does this solve? Link the spec, ADR, issue, or incident. -->

Closes #

## What Changed

<!-- The shape of the change, not a file-by-file diff. Call out anything a
     reviewer would not expect from the title. -->

-

## Alternatives Considered

<!-- What else could have solved this, and why this approach won. Write "None"
     only when the change is genuinely mechanical. -->

-

## ADRs & Architecture

<!-- Which architectural decisions this change follows, amends, or contradicts.
     Link ADRs as adrs/ADR-0NN-title.md. A change that contradicts an ADR needs
     a new ADR, not a note here. -->

- Follows:
- Amends / supersedes:
- New ADR needed: no

## Testing

<!-- How you know this works. Commands run, cases covered, what a reviewer
     should exercise manually. -->

```
```

## Checklist

- [ ] `npm run lint` passes (`eslint .`)
- [ ] Types pass (`tsc --noEmit` in each touched package)
- [ ] Tests added or updated for the behaviour changed, and the suite passes
- [ ] No secrets, tokens, or credentials in code, config, fixtures, or logs
- [ ] `npm run format:check` passes
- [ ] Docs updated where behaviour changed (`CLAUDE.md`, README, runbooks)
- [ ] Spec `| Status |` row updated if this implements or completes a spec
- [ ] Schema changes ship as an ordered `NNNN_*.sql` migration and are idempotent

<!-- Lore-managed branches: keep commits append-only — no amend, fixup, rebase,
     or force-push once trailers are on the branch. -->
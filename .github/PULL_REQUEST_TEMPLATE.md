## Why

<!-- What problem does this change solve? Link to the spec, issue, or task that motivated it. -->

## What Changed

<!-- A concise description of the implementation. What was added, removed, or modified? -->

## Alternatives Considered

<!-- What other approaches did you evaluate? Why did you choose this one? -->

## ADRs & Architecture

<!-- Reference any ADRs this touches or creates. If this change warrants a new ADR, link the draft. -->

- ADR(s) affected:
- New ADR needed: yes / no

## Testing

<!-- How was this tested? Include commands, edge cases covered, and anything explicitly not tested. -->

```bash

```

---

- [ ] Lint passes (`npm run lint` or equivalent in the changed workspace)
- [ ] Types check (`npm run typecheck` or `tsc --noEmit`)
- [ ] Tests pass and new behaviour is covered
- [ ] No secrets, credentials, or tokens committed
- [ ] Dark-factory commits carry `Lore-Stage` / `Lore-Iteration` / `Lore-Task` trailers (if on a Lore-managed branch)
- [ ] PR body includes `Lore-Task: <uuid>` footer (if task-backed)
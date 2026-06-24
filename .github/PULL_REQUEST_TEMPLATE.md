## Why

<!-- What problem does this solve? What outcome does it enable? Be specific about the motivation — link to the spec, issue, or incident if one exists. -->

## What Changed

<!-- Bullet-point summary of the actual changes. Include file-level callouts for non-obvious moves (e.g. extracted to shared/, renamed from X to Y). -->

## Alternatives Considered

<!-- What else did you evaluate? Why did you reject it? If nothing was considered, say so explicitly. -->

## ADRs & Architecture

<!-- Does this touch a decision already captured in adrs/? Reference it. Does this introduce a new architectural trade-off that warrants a new ADR? Note it here. If neither applies, write "N/A". -->

## Testing

<!-- How was this verified? Unit tests, integration tests, local stack run, eval run? List what was exercised and what was not. If you could not test something, say why. -->

---

**Checklist**

- [ ] Lint passes (`npm run lint` or equivalent in the changed workspace)
- [ ] Types check (`npm run typecheck` or `tsc --noEmit`)
- [ ] Tests pass for changed packages
- [ ] No secrets, tokens, API keys, or credentials in the diff
- [ ] Migrations are idempotent (if `ui-helm/migrations/` was touched)
- [ ] Commit trailers present if this is a Lore-managed branch (`Lore-Stage:` / `Lore-Task:`)
- [ ] ADR created or updated if an architectural decision was made
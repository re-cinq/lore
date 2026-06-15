# Pull Request Template

## Why

<!-- Explain the motivation and context for this PR. What problem does it solve? What does it enable? -->

## What Changed

<!-- Summarize the changes in this PR. Include key files modified. -->

## Alternatives Considered

<!-- What other approaches did you evaluate? Why was this approach chosen? -->

## ADRs & Architecture

<!-- Reference relevant ADRs (e.g., ADR-024). Explain how this change aligns with or modifies the architecture. Include diagrams if helpful. -->

## Testing

<!-- How was this tested? Include reproduction steps, test coverage, or links to test results. -->

---

## Code Quality Checklist

- [ ] **Lint & Format** — Code passes `npm run lint` (or language equivalent)
- [ ] **Type Safety** — No TypeScript errors (`npm run typecheck`)
- [ ] **Tests** — New logic has test coverage; existing tests pass
- [ ] **No Secrets** — No API keys, tokens, credentials, or private data in code or commit history
- [ ] **Commit Hygiene** — Commits are atomic and messages are clear
- [ ] **Dark Factory Trailers** (if applicable) — Commits include `Lore-Stage`, `Lore-Iteration`, `Lore-Task` trailers; PR body includes `Lore-Task` footer

---

## Self-Review

Before requesting review:

- [ ] Code follows the repo's conventions (see `CLAUDE.md` + `AGENTS.md`)
- [ ] Changes are isolated and focused on the stated problem
- [ ] Documentation (README, ADR, CLAUDE.md) is updated if needed
- [ ] No unintended files are included (e.g., `.env`, node_modules, build artifacts)
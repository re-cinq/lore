# Definition of Done

> Remove `.github/workflows/auto-merge.yml` from this repo once T006 arms auto-merge itself, so arming no longer depends on who may label a PR; the runbook step covers other repos.

**Strategy: `mechanical`** — The ticket is a small, fully-specified file deletion that requires no new permanent test.

## Done when these pass

- [x] **No tests pin this workflow** — Deleting `.github/workflows/auto-merge.yml` is an infrastructure change; no application tests pin its existence.

## Facets

- [x] Remove `.github/workflows/auto-merge.yml`

## Out of scope

- Touching other workflows or agent logic.

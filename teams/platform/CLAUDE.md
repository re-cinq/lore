# Platform Team

## Current Work

Building and operating the Lore platform end-to-end: the MCP server, the
remote Lore API, the Floor coordinator, the agent subsystem, and the
supporting infrastructure (PostgreSQL + pgvector, Helm charts, CronJobs) on
GKE.

## What We Own

- MCP server code and deployment
- Install script and developer onboarding
- Lore Agent prompts and scheduling
- Infrastructure (CNPG, Helm charts, CronJobs)
- PromptFoo eval suites
- Platform skills (/lore-feature, /lore-pr, /lore-init)

## Conventions

- Work on feature branches and open a PR — `main` is protected and gated on
  PR checks (see `.github/workflows/guard-main-pushes.yml`); do not push
  directly to `main`.
- Run `lore-doctor` (`scripts/lore-doctor.sh`) after any `install.sh` changes.
- Image builds and deploys are CI-driven: merging to `main` builds and pushes
  the service image to `ghcr.io` (SHA-tagged) and Helm-deploys it via
  `scripts/ci/deploy-lore-platform.sh` (see `.github/workflows/build-*.yml`).
  Do not hand-build or push `:latest` images.

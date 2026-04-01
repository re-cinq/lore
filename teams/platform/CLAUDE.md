# Platform Team

## Current Work

Building and validating the Lore platform. Phase 0 is validated
(install, MCP server, skills, hooks all working). Phase 1 infra
is deployed (PostgreSQL, Klaus, MCP server on GKE). Currently
working on embedding pipeline and testing the full stack end-to-end.

## What We Own

- MCP server code and deployment
- Install script and developer onboarding
- Klaus agent prompts and scheduling
- Infrastructure (CNPG, Helm charts, CronJobs)
- PromptFoo eval suites
- Platform skills (/lore-feature, /lore-pr, /lore-init)

## Conventions

- Test changes on the remote machine (spark-866a) before merging
- Push to `1-lore-platform` branch, force-push to main for now
  (single developer, will switch to PRs when team grows)
- Run `lore-doctor` after any install.sh changes
- Rebuild and push container images via podman after MCP server changes:
  `podman build --platform linux/amd64 -t ghcr.io/re-cinq/lore-mcp:latest .`
  `podman push ghcr.io/re-cinq/lore-mcp:latest`
  `kubectl rollout restart deployment/lore-mcp -n mcp-servers`

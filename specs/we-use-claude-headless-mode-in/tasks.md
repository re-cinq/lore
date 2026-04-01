# Task Breakdown: Claude Headless Mode Container Rebuild Automation

## Phase 1: Setup & Analysis

- [ ] T001 [P] Audit current Claude headless container setup in `.github/workflows/` and `Dockerfile` to understand build triggers and dependencies
- [ ] T002 [P] Document Claude SDK version pinning strategy and dependency update frequency in `adrs/ADR-*.md`
- [ ] T003 [P] Create spike comparing Renovate vs other dependency update tools (Dependabot, Snyk) with recommendation in `research/container-rebuild-strategy.md`
- [ ] T004 Finalize decision on update mechanism (Renovate, Dependabot, custom) and document in `adrs/ADR-container-rebuild.md`

## Phase 2: Core Implementation

- [ ] T005 [P] Set up Renovate configuration file `renovate.json` with Claude SDK, Node.js, and container base image rules
- [ ] T006 [P] Create scheduled container rebuild workflow in `.github/workflows/container-rebuild.yml` triggered by dependency updates
- [ ] T007 [P] Add container registry push credentials to GitHub Secrets for authenticated image pushes (GCP Artifact Registry)
- [ ] T008 Update `Dockerfile` to reference Claude SDK version from a pinned variable or lock file instead of hardcoded version
- [ ] T009 [P] Create test matrix in CI to validate rebuilt container against Claude Code API compatibility in `.github/workflows/container-test.yml`
- [ ] T010 Add health check endpoint to container entrypoint for startup validation (e.g., `/__health`)

## Phase 3: Integration & Polish

- [ ] T011 [P] Update `scripts/infra/setup-container.sh` to document container rebuild process and manual override procedures
- [ ] T012 [P] Add container rebuild status to Web UI analytics dashboard in `web-ui/src/pages/analytics.tsx` (rebuild frequency, success rate)
- [ ] T013 Create deployment rollback playbook in `docs/container-rebuild-rollback.md` for failed rebuilds
- [ ] T014 [P] Update `CLAUDE.md` with container rebuild context and MCP tool for checking rebuild status (`get_container_rebuild_status`)
- [ ] T015 Add MCP tool `trigger_container_rebuild` in `mcp-server/src/tools/` to allow on-demand rebuilds from Claude Code
- [ ] T016 [P] Configure GitHub Dependabot or Renovate notifications to alert `#platform-eng` Slack channel on rebuild triggers
- [ ] T017 [P] Create monitoring/alerting for rebuild failures in `k8s/monitoring/container-rebuild-alerts.yml` (Cloud Monitoring + Prometheus)
- [ ] T018 Document container rebuild SLA and success metrics in `README.md` and team runbook
- [ ] T019 [P] Set up integration test pipeline that pulls rebuilt image and validates against sample agent task in `evals/container-rebuild.yml`
- [ ] T020 Add Beads task automation: create Beads task on successful rebuild linked to release notes in `scripts/beads-container-rebuild.sh`
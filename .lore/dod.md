# Definition of Done

> As a developer on Apple Silicon or another ARM64 machine, I want to pull `ghcr.io/re-cinq/lore-api`, `lore-mcp`, `lore-stations` and `lore-ui` and have them run natively, so I don't hit QEMU emulation or a failed pull.

**Strategy: `mechanical`** — The ticket is a fully-specified CI configuration change, making the behaviour unobservable from a local test runner; no new test is owed, and existing YAML-validation tests must stay green.

## Done when these pass

- [ ] **every umbrella deploy job runs deploy-lore-platform.sh with issues: write and GH_TOKEN, so a failed deploy can file its deploy-failed issue** — existing test pinning the deploy jobs we alter
  `scripts/ci/deploy-workflows.test.mjs`

## Facets

- [x] `.github/workflows/_build-image.yml`: Create reusable workflow with amd64/arm64 matrix legs, `setup-buildx-action`, digest upload, and manifest-merge job.
- [x] `.github/workflows/build-lore-api.yml`: Replace `build` job with call to `_build-image.yml`; update `deploy` job to depend on it.
- [x] `.github/workflows/build-mcp-server.yml`: Replace `build` job with call to `_build-image.yml`; update `deploy` job to depend on it.
- [x] `.github/workflows/build-stations.yml`: Replace `build` job with call to `_build-image.yml`; update `deploy` job to depend on it.
- [x] `.github/workflows/build-ui.yml`: Replace `build` job with call to `_build-image.yml`; update `deploy` and `verify` jobs to depend on it.
- [x] `apps/lore-api/Dockerfile`: Change line 48 to `FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS gobuilder`.

## Out of scope

- GKE node pools, Helm charts, Kubernetes manifests, RBAC, secrets and `infra/compose.yaml` stay as they are. Production keeps pulling the amd64 entry.
- ARM64 support for `dgraph/standalone:v24.0.0` in `infra/compose.yaml` is out of scope.

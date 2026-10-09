# Feature Specification: ARM Image Builds

| Feature | ARM Image Builds |
| ------- | ---------------- |
| Branch  | arm-image-builds |
| Status  | Draft |
| Created | 2026-10-09 |
| Owner   | CI Owners |

This feature adds multi-architecture manifest indices to the four container images (`lore-api`, `lore-mcp`, `lore-stations`, and `lore-ui`) by producing native `linux/arm64` manifests alongside the existing `linux/amd64` manifests.

## Problem Statement

Right now, the images are built for AMD64, but for Mac and personal ARM64 boxes, developers need ARM64 images. The four images published under the `re-cinq` organisation's namespace on GitHub Container Registry (which this feature adds multi-arch support for at `ghcr.io/re-cinq`) are currently built by their own GitHub Actions workflows (`.github/workflows/build-lore-api.yml`, `build-mcp-server.yml`, `build-stations.yml`, `build-ui.yml`) using `docker/build-push-action` with no `platforms` argument, so every push to `main` produces a `linux/amd64`-only manifest. A developer on Apple Silicon or an ARM64 personal machine who pulls the image gets QEMU emulation or an outright pull failure depending on their Docker configuration.

## User Scenarios

### User Story 1 - Native Pull on ARM64 Developer Machine (Priority: P1)

Developers using Apple Silicon or ARM64 machines can pull and run the container images natively without emulation overhead or pull failures.

**Why this priority**: Native execution prevents pull failures and avoids QEMU overhead for local development on modern ARM-based hardware.

**Independent Test**: Running `docker pull ghcr.io/re-cinq/<image>:<short-sha>` on an Apple Silicon machine successfully resolves an ARM64 layer without requiring any platform flags.

**Acceptance Scenarios**:

1. **Given** a published image with a multi-architecture manifest index, **When** a developer pulls the image on an Apple Silicon machine, **Then** Docker automatically selects and pulls the native `linux/arm64` layer.

## Requirements

### Functional Requirements

- **FR-001**: The four build workflows (`.github/workflows/build-lore-api.yml`, `build-mcp-server.yml`, `build-stations.yml`, `build-ui.yml`) are each split into two matrix legs — `amd64` on `ubuntu-latest` and `arm64` on `ubuntu-24.04-arm` — each building and pushing a single-arch image by digest; a manifest-merge job runs after both legs complete, using `docker buildx imagetools create`, to produce a multi-architecture manifest index containing both `linux/amd64` and `linux/arm64`. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#scope-p-3))
- **FR-002**: Adding the `linux/arm64` manifest has no effect on the GKE cluster (`europe-west1`), which continues to automatically resolve the `linux/amd64` entry from the index ([from plan](plan.md#what-we-want-and-why)).

- **FR-003**: `docker/setup-buildx-action` MUST be added to each matrix leg in all four build workflows (`.github/workflows/build-lore-api.yml`, `build-mcp-server.yml`, `build-stations.yml`, `build-ui.yml`); `docker/setup-qemu-action` is not required because each leg runs on its native architecture. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#scope-p-2))
- **FR-004**: The three Node.js Dockerfiles (`apps/mcp-server/Dockerfile`, `apps/stations/Dockerfile`, `apps/web-ui/Dockerfile`) MUST NOT be changed for `arm64`; all use `node:22-slim` which ships a native `linux/arm64` variant, every `npm ci` runs with `--ignore-scripts`, and `tree-sitter` is `web-tree-sitter` + `tree-sitter-wasms` (WASM) so no native addon compilation is required per architecture. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#scope-p-4))
- **FR-005**: `apps/lore-api/Dockerfile` line 48 MUST be changed from `FROM golang:1.26-alpine AS gobuilder` to `FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS gobuilder`; the Go stage already cross-compiles `lore-code-trace` for `linux/darwin × amd64/arm64` with `CGO_ENABLED=0`, so pinning to the build platform keeps the compiler native on both legs instead of running under target emulation. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#scope-p-5))
- **FR-006**: A reusable workflow MUST be introduced at `.github/workflows/_build-image.yml`, added by this feature (trigger: `workflow_call`; inputs: image name, Dockerfile, context, build-args); it contains the matrix legs, the digest-artifact upload/download, and the `docker buildx imagetools create` manifest-merge job; the four build workflows call it instead of each carrying a copy; it outputs `image_tag` from the non-matrix merge job. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#p_0d999754-3da1-4ac0-9d48-44ac9791a692))
- **FR-007**: Each workflow's `deploy` job — and `build-ui.yml`'s `verify` job — MUST depend on the reusable workflow's merge job and read `image_tag` from it; the matrix legs push by digest only (no named tag), so the `:<sha>` tag that the deploy pins exists only once the merge job has run. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#p_c928bc4b-5c4c-44df-bafc-a868ba09e326))
- **FR-008**: GKE node pool machine types and Helm charts MUST NOT be changed; production continues to run on AMD64 and the new `linux/arm64` manifest entry is invisible to AMD64 GKE nodes because GHCR manifest selection is per-puller architecture. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#scope-p-7))
- **FR-009**: `infra/compose.yaml` local-dev backing services MUST NOT be changed; `pgvector/pgvector:pg16` already publishes a native `linux/arm64` image. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#scope-p-9))
- **FR-010**: Kubernetes manifests, RBAC, secrets, and Workload Identity MUST NOT be changed; none is architecture-sensitive. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#scope-p-10))

## Success Criteria

<!-- Pod for KPIs will fill this section -->

- Every `ghcr.io/re-cinq` image ships a multi-arch manifest index so ARM64 pullers get a native layer automatically. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#k-arm-manifest))
- The manifest index is correctly wired, validated on the `:<short-sha>` tag that every deploy pins and that every image is guaranteed to publish. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#k-native-pull))

## Assumptions

<!-- Pod for Constraints will fill this section -->

- The feature uses native ARM64 GitHub-hosted runners (`ubuntu-24.04-arm`); each of the four images builds as two parallel matrix legs — amd64 on `ubuntu-latest` and arm64 on `ubuntu-24.04-arm` — merged into one manifest index via `docker buildx imagetools create` in `.github/workflows/_build-image.yml` (added by this feature); no QEMU is used. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#constraints-p-1))
- Multi-arch pushes with `docker buildx` require `packages: write` permission, which is already present on the `build` job in all four workflows (`.github/workflows/build-lore-api.yml#L69-L71`, `.github/workflows/build-mcp-server.yml#L43-L45`, `.github/workflows/build-stations.yml#L43-L45`, `.github/workflows/build-ui.yml#L64-L66`); no new secret or repository permission is needed. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#constraints-p-2))
- ARM64 support for `dgraph/standalone:v24.0.0` in `infra/compose.yaml` is out of scope; a follow-up issue is filed before this change merges and linked from the spec; until resolved, Apple Silicon developers add `platform: linux/amd64` to the Dgraph service in a local compose override; CI images are unaffected. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#constraints-p-3))
- The `.github/workflows/build-ui.yml` `changes` job (lines L30–L56) compares `${{ github.event.before }}` to `${{ github.sha }}` via `git diff --name-only`, emitting `relevant=true/false`; the `build` job gates on `needs.changes.outputs.relevant == 'true'`; this pattern is unchanged by multi-arch, and ARM64 is present whenever the UI image is rebuilt. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#constraints-p-4))

## Open Questions

<!-- Pod for Questions will fill this section -->

- Should the feature use QEMU emulation (single job, simpler) or native ARM64 GitHub-hosted runners (parallel jobs + manifest merge, faster)? ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#q-build-approach))
- Does `dgraph/standalone:v24.0.0` ship a `linux/arm64` image? If not, should fixing the local-dev compose stack for ARM be in scope here or a follow-up? ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#q-dgraph-arm))

- Should ARM64 be built on every PR, or only on pushes to main? Options: (a) build on every PR — arm64 regressions caught at PR time, at the cost of longer PR CI; (b) build only on main — PR feedback time unchanged, arm64 break first visible on main push. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#q-arm-on-prs))

## Ownership

- The four build workflows (`.github/workflows/build-lore-api.yml`, `build-mcp-server.yml`, `build-stations.yml`, `build-ui.yml`) are the CI artefacts that change; whoever currently owns the GitHub Actions configuration for this repo owns this change. The GKE cluster and GHCR registry are unchanged, and no new operational surface is introduced. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#ownership-p-1))
- The GHCR packages `ghcr.io/re-cinq/lore-api`, `lore-mcp`, `lore-stations`, and `lore-ui` are already published and owned by the re-cinq org; multi-arch manifests are additive and extend the existing package rather than creating a new one. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#ownership-p-2))

## Delivery

- **D-001**: On push to main, each of the four build jobs fans out into two parallel matrix legs (amd64 + arm64) and a manifest-merge job in `.github/workflows/_build-image.yml` (added by this feature), making main CI longer; PR builds run the amd64 leg only, unchanged from today, so PR feedback time is not affected. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#delivery-p-1))
- **D-002**: GHCR resolves manifest entries by the puller's architecture; the GKE AMD64 nodes continue to pull the `linux/amd64` entry from the multi-arch manifest index and are unaffected by the new `linux/arm64` entry. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#delivery-p-2))
- **D-003**: The post-deploy smoke jobs — `.github/workflows/build-lore-api.yml#L146-L158` running `scripts/smoke-test.sh` against `${{ vars.LORE_API_URL }}` and `.github/workflows/build-ui.yml#L169-L197` polling `${{ vars.LORE_UI_URL }}/api/version` — run on GKE AMD64 nodes and are not architecture-aware; no changes are needed. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#delivery-p-3))
- **D-004**: `docker/setup-buildx-action` MUST be added to each matrix leg and to the manifest-merge job in `.github/workflows/_build-image.yml`; `docker/setup-qemu-action` is not needed because each leg runs on its native architecture. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#delivery-p-4))
- **D-005**: `build-lore-api.yml`, `build-mcp-server.yml`, and `build-ui.yml` run on pull requests (`build-stations.yml` does not); on a PR only the amd64 leg runs unchanged; on push to main both legs build with `outputs: type=image,push-by-digest=true,name-canonical=true,push=true` and upload their digest as an artifact; the manifest-merge job downloads both digests, runs `docker buildx imagetools create`, and MUST fail unless `docker buildx imagetools inspect` lists both `linux/amd64` and `linux/arm64` in the manifest, so an arm64 break is first detected on main and fails loudly there rather than shipping an amd64-only tag. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/45934dba-f20d-4f44-9d21-96838670a121#delivery-p-5))

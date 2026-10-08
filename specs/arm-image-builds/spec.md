# Feature Specification: ARM Image Builds

| Feature | ARM Image Builds |
| ------- | ---------------- |
| Branch  | arm-image-builds |
| Status  | Draft |
| Created | 2026-10-08 |
| Owner   | platform |

This feature adds multi-architecture manifest indices to the four GHCR images (`lore-api`, `lore-mcp`, `lore-stations`, and `lore-ui`) by producing native `linux/arm64` manifests alongside the existing `linux/amd64` manifests.

## Problem Statement

Right now, the images are built for AMD64, but for Mac and personal ARM64 boxes, developers need ARM64 images. The four images published under the `re-cinq` organisation's namespace on GitHub Container Registry (GHCR) (`lore-api`, `lore-mcp`, `lore-stations`, and `lore-ui`) are currently built by their own GitHub Actions workflows (`.github/workflows/build-lore-api.yml`, `build-mcp-server.yml`, `build-stations.yml`, `build-ui.yml`) using `docker/build-push-action` with no `platforms` argument, so every push to `main` produces a `linux/amd64`-only manifest. A developer on Apple Silicon or an ARM64 personal machine who pulls the image gets QEMU emulation or an outright pull failure depending on their Docker configuration.

## User Scenarios

### User Story 1 - Native Pull on ARM64 Developer Machine (Priority: P1)

Developers using Apple Silicon or ARM64 machines can pull and run the container images natively without emulation overhead or pull failures.

**Why this priority**: Native execution prevents pull failures and avoids QEMU overhead for local development on modern ARM-based hardware.

**Independent Test**: Running `docker pull ghcr.io/re-cinq/<image>:<short-sha>` on an Apple Silicon machine successfully resolves an ARM64 layer without requiring any platform flags.

**Acceptance Scenarios**:

1. **Given** a published image with a multi-architecture manifest index, **When** a developer pulls the image on an Apple Silicon machine, **Then** Docker automatically selects and pulls the native `linux/arm64` layer.

## Requirements

### Functional Requirements

- **FR-001**: The build pipelines for `lore-api`, `lore-mcp`, `lore-stations`, and `lore-ui` produce a multi-architecture manifest index in GHCR containing both `linux/amd64` and `linux/arm64` ([from plan](plan.md#what-we-want-and-why)).
- **FR-002**: Adding the `linux/arm64` manifest has no effect on the GKE cluster (`europe-west1`), which continues to automatically resolve the `linux/amd64` entry from the index ([from plan](plan.md#what-we-want-and-why)).

## Success Criteria

<!-- Pod for KPIs will fill this section -->

## Assumptions

<!-- Pod for Constraints will fill this section -->

## Open Questions

<!-- Pod for Questions will fill this section -->

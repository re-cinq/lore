# Definition of Done

> Add a short **Running on ARM64** section to `docs/INSTALL.md` for installing Lore together with the floor and ai-agent-subsystem on ARM64 machines (Apple Silicon, Graviton, Ampere).

**Strategy: `mechanical`** — The ticket is a documentation addition whose edit is the DoD. Existing tests continue to pass.

## Done when these pass

- [x] **install-contract.test** — pins install.sh behavior which is documented in INSTALL.md
  `scripts/install-contract.test.mjs`

## Facets

- [x] Add the "Running on ARM64" section to `docs/INSTALL.md` verifying all claims against current workflows.

## Out of scope

- GKE cluster ARM64 support (stays on amd64 per FR-008)

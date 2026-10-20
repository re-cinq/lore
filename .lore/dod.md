# Definition of Done

> Check whether `dgraph/standalone:v24.0.0` in `infra/compose.yaml` publishes a `linux/arm64` image.
> 
> - If it does, close this issue as not needed.
> - If it doesn't, either move to a tag that ships arm64, or document the `platform: linux/amd64` override for Apple Silicon in a local compose override.
> 
> Either way, link this issue from the spec's Assumptions section.

**Strategy: `mechanical`** — The ticket asks for a doc correction to the spec's Assumptions section to link this issue, and verifies an external image tag without changing codebase behaviour.

## Done when these pass

- [ ] **Check spec parsing** — EXISTING tests that parse specs must stay green to ensure the Markdown change is valid.
  `scripts/check-spec-parser-parity.test.mjs`

## Facets

- [x] Update the Dgraph assumption in `specs/arm-image-builds/spec.md` to link issue #2840 and state that ARM64 is natively supported.

## Out of scope

- Changes to `infra/compose.yaml` since `dgraph/standalone:v24.0.0` already natively publishes a `linux/arm64` image.

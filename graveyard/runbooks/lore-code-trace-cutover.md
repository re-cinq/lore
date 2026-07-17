# Runbook: lore-code-trace test-ingest cutover (go-live)

The portable `lore-code-trace` binary + the Floor `ci-tests` hook replace the deleted
mcp `/test-report` + `/coverage` routes (commits `f295c28`, `21f28f3`, `943746f` on `main`).
The code is merged but **not live** until these operator steps run. Until then the binary
path warn-and-skips, so test projection silently pauses (no CI red); the nightly reindex
does not backstop tests, so don't leave it half-done.

## Pre-flight
- `main` is `ahead 3, behind 2` of origin — **rebase onto origin/main, then push**.
- Pushing `main` triggers `build-mcp` (its Docker build now has a `golang:1.26-alpine`
  stage that cross-compiles the binary + bakes it into the image) and `build-floor`
  (the `ci-tests` listener). **Watch the mcp image build** — the Go stage is new; confirm
  it compiles in CI before relying on `/dist`.

## Steps
1. **Deploy** — push `main`; confirm `build-mcp` + `build-floor` go green and roll out.
   Smoke the serve route: `curl -fsSL "$LORE_API_URL/dist/lore-code-trace/linux-amd64" -o /tmp/lct && file /tmp/lct` → a Linux ELF.
2. **Expose the Floor webhook ingress** — set `lore_webhook_hostname` in
   `infra/terraform/secrets.tfvars` (the Floor ingress is `count`-guarded on it) and
   `terraform apply`. This is the SAME ingress the GitHub-webhook (`ci-ingest`) cutover needs —
   do them together.
3. **Provision `LORE_WEBHOOK_URL`** — the binary POSTs the report there:
   ```
   gh variable set LORE_WEBHOOK_URL --body "https://<lore_webhook_hostname>" --repo re-cinq/lore
   ```
   Set it on every onboarded repo too (the onboarding template reads `vars.LORE_WEBHOOK_URL`).
   The binary downloads from `LORE_API_URL`/`LORE_INGEST_URL` (already provisioned) and
   POSTs to `LORE_WEBHOOK_URL/api/webhook/ci-tests`.
4. **Re-onboard existing repos** — their old `lore-tests.yml` posts to the deleted
   `/test-report` (→ 404 soft-fail). Re-run onboarding so they pick up the binary workflow
   (`LORE_TESTS_INSTRUCTION`).

## Verify
- Push to `main` runs `.github/workflows/lore-tests.yml` → downloads the binary →
  `./lore-code-trace --post` → `POST /api/webhook/ci-tests`.
- Floor: the `pipeline.events` row `internal.ingest.spec_trace` (kind `test-report`)
  goes `pending → done`; with `LORE_DGRAPH_HTTP` set, `TestChunk`/`Coverage`/`COVERS` land.

## Rollback
- Quickest: unset `LORE_WEBHOOK_URL` → the binary step warn-and-skips (no red CI), but
  no test projection.
- Full: `git revert` the three cutover commits — note this restores the mcp
  `/test-report` + `/coverage` routes + the TS CLI, since the cutover deleted them.

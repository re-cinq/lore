# Runbook: station cutover (every non-agent node → pod)

Big-bang rollout of the station cutover (lore#790 + ai-agent-subsystem#133). After
this, every non-agent node on the Floor-assembly-line path (validate / gate /
retrospective / github_action / detect) dispatches a `def-<type>` station pod via
the `exec` vendor. **There is no per-type soak flag** (`LORE_STATION_NODES` was
deleted) — the only rollback is a code revert. Sequence matters.

## Blast radius

- **Affected** (Floor-assembly-line path → now dispatch stations): `implementation`,
  `general`, `feature-planning`, `feature-finalize`, and the detection lines
  (`spec-drift` / `gap-detect` / `spec-coverage-*` via `run-detect`). Their
  executed `validate` / `retrospective` / `detect` nodes become pods.
- **Unaffected** (in-process supervisor): `gap-fill`, `runbook`.
- **`code-review`** executes only agent nodes (`review` → `refine`) + a terminal
  `done` — it dispatches **no** stations, so it neither tests nor is broken by this.

## Hard prerequisite (do this FIRST — nothing runs without it)

The deployed controller is pinned to **v0.3.0, which has no `exec` vendor**
(`ai-agents-helm/values.yaml` → `controller.image.digest`). Until it is bumped,
every station CR fails.

1. Merge **ai-agent-subsystem#133**; cut a controller release that includes the
   exec vendor (its CI builds/signs the image).
2. Resolve the new digest and bump `ai-agents-helm/values.yaml`:
   ```
   skopeo inspect docker://ghcr.io/re-cinq/ai-agent-controller:<new-tag>
   # update controller.image.digest (+ the paired agentImage if the matrix bumped it)
   ```
3. Deploy the ai-agents subchart; confirm the controller is `Ready` and its logs
   show the `exec` vendor registered.

## Rollout order

1. **Controller with exec vendor is live** (prerequisite above). Verify:
   `kubectl -n ai-agents get deploy` → controller Ready on the new digest.
2. **Merge lore#790 to main.** This triggers, in parallel:
   - `build-lore-station.yml` → pushes `ghcr.io/re-cinq/lore-station:latest` (+ short-SHA).
   - the umbrella deploy → ui-helm migration hook applies **0027 + 0028** (seeds the
     `def-*` org rows), ai-agents-helm re-seeds the `def-*` AgentDefinition/Station
     catalog (`seedCatalog`), and floor rolls.
   - **Race to know:** floor may dispatch a station before `:latest` is pushed → the
     first station pods `ImagePullBackOff` until the image lands, then self-heal
     (`:latest` ⇒ `imagePullPolicy: Always`). To avoid it, pre-build + push the
     lore-station image before merging, or hold the floor rollout until the image
     job is green.
3. **Verify a station runs.** `code-review` won't do it — trigger a real station:
   ```
   # detect station (repo-less):
   psql … -c "INSERT INTO pipeline.events (event_name, source, params)
              VALUES ('cron.spec_drift.tick','cron','{\"repo\":\"re-cinq/lore\"}');"
   kubectl -n ai-agents get agents   # expect <id8>-detect → Succeeded
   ```
   or run one `implementation` task and watch its `validate` / `retrospective` CRs.
   Confirm `Agent.status.output` carries a `LORE_NODE_RESULT` line and the assembly
   line reaches `done`.

## Rollback

No runtime toggle — the flag is gone. To revert:

1. `git revert` the cutover commit `3f89488c` (and, if fully backing out, the rest
   of the branch) → restores the in-process node handlers on the Floor path.
2. Redeploy floor. The `def-*` catalog rows + migrations are inert once floor stops
   dispatching stations (harmless to leave).
3. The controller-digest bump can stay — the exec vendor is dormant with no station
   CRs.

## Notes / follow-ups

- `stationImage` is `:latest`, not CI-SHA-pinned like the other services — fine for
  the cutover (Always-pull), but pin it to a digest for reproducibility later.
- Detect station CRs carry no task-id label, so the `kubernetes.agent.*` watch
  skips them (poll-loop only). Label them with the assembly-line id + extend
  `k8s-map.ts` to close the dropped-event gap.

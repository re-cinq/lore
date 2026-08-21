# Feature Specification: Running Stations in Any K8s Cluster

| Field   | Value                                  |
|---------|----------------------------------------|
| Feature | Running Stations in Any K8s Cluster    |
| Branch  | lore/feature-planning/title-running-stations-in-any-e291dca9 |
| Status  | Draft                                  |
| Created | 2026-08-21                             |
| Owner   | Platform Engineering                   |

Any Kubernetes cluster — remote GKE project, on-prem, local minikube — can run
Lore Stations by installing a single Helm chart that bundles the Floor and the
AI subsystem, registering with the central Lore API, and claiming pending station
runs from the shared queue. The architecture is pull-based, in the spirit of a
GitLab Runner: each Floor is an autonomous worker that registers itself, advertises
its capabilities, and polls for work that matches those capabilities. No central
Floor dispatches to remote clusters.

## Problem Statement

Every Floor and every Station today runs on the single GKE cluster where
the platform is deployed. This creates three hard blockers:

1. **Regulated or on-prem repos** require agent execution to stay inside a
   private network that the org's GKE cluster cannot reach.
2. **Dev / staging Floors** cannot be tested in isolation; every change to the
   Floor or AI subsystem runs through the production cluster.
3. **Capacity expansion** requires growing the primary cluster even when the
   work is ephemeral or zone-specific.

The current dispatch path (`handle-claude-code-task.ts` → Agent CR → pod in
`ai-agents` namespace) is hard-wired to the cluster the Floor pod lives in.
There is no registry of external clusters, no protocol for a remote Floor to
announce itself, and no mechanism for station runs to be claimed by a Floor
other than the one that scheduled them.

## Solution

Introduce a **Floor registry** (`pipeline.floors`) and turn station-run dispatch
into a pull-based claim protocol. The central Lore API manages pipeline state;
each Floor — regardless of which cluster it lives in — polls for pending
station runs that match its capability labels, atomically claims one, and
executes it by creating an Agent CR in its own cluster via its own in-cluster
service account.

### Floor lifecycle

```
Helm install → registration Job → POST /api/floors → {floor_id, token}
                                                          ↓
                                              stored in cluster Secret
                                                          ↓
Floor process starts → heartbeat loop (60 s) → PUT /api/floors/:id/heartbeat
                    → claim loop (5 s)       → POST /api/floors/:id/claim
                                                          ↓
                                              create Agent CR in local cluster
                                                          ↓
                                              write outcome → PATCH /api/station-runs/:id
```

### Design decisions (locked)

| # | Decision | Rationale |
|---|----------|-----------|
| **D1** | Pull-based claim (Floor polls Lore) not push (Lore dispatches to Floor) | No Lore-to-cluster network path needed; works behind NAT and private VPCs |
| **D2** | Registration token is the only secret that crosses cluster boundaries | Kubeconfig never leaves the registered cluster; Lore stores only the token hash |
| **D3** | Floors carry capability labels; station runs carry requirement labels; a Floor claims only when its labels are a superset of the run's requirements | Enables zone routing, GPU routing, trust-tier routing without a separate scheduler |
| **D4** | Registration is idempotent on `name`; re-registering with the same name refreshes the token | Safe to re-run `helm upgrade`; secret rotation is `helm upgrade --set floor.rotate=true` |
| **D5** | The existing primary Floor is seeded as the first `pipeline.floors` row (migration 0045) with a token that matches the current `LORE_FLOOR_TOKEN` env var | Zero downtime for the primary cluster |
| **D6** | A Floor whose heartbeat is >5 min stale is marked `offline` (not deleted, not disabled); pending station runs it holds are released after 10 min | Mirrors the lease-reaper pattern; no work is dropped, stale runs re-enter the queue |
| **D7** | The Floor process never holds a DB connection to the central Postgres; all state transitions go through the Lore REST API | Keeps the security perimeter: remote Floors have no DB credentials |
| **D8** | The Helm chart that installs a Floor bundles the ai-agent-subsystem subchart from the same `lore-platform` chart family | One `helm install lore-floor` gives you both; no separate subsystem install step |
| **D9** | `pipeline.station_runs` gains a `floor_id` FK and a `claimed_at` timestamp; the claim operation is `UPDATE … WHERE floor_id IS NULL … RETURNING *` under `FOR UPDATE SKIP LOCKED` | Re-uses the established SKIP LOCKED claim pattern from `pipeline.events` and `pipeline.tasks` |

## Floor registry

A new table `pipeline.floors` is the authoritative list of registered Floor
instances. Any Floor — primary or remote — appears here.

**Schema:**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key, generated |
| `name` | `text` | Human label, unique (e.g. `primary`, `eu-dev`, `on-prem-1`) |
| `labels` | `jsonb` | Capability map: `{ zone, trust, gpu, … }` |
| `namespace` | `text` | K8s namespace for Agent CRs (default `ai-agents`) |
| `token_hash` | `text` | SHA-256 of the bearer token; token itself is never stored |
| `last_heartbeat_at` | `timestamptz` | Updated every 60 s by the Floor process |
| `status` | `text` | `online` / `offline` (set by the heartbeat reaper) |
| `enabled` | `bool` | Hard on/off (operator toggle; disabled Floors do not receive claims) |
| `created_at` | `timestamptz` | Set at insert |

**API** (org-wide):

| Method | Path | Auth scope | Notes |
|---|---|---|---|
| `POST` | `/api/floors` | admin | Register a new Floor; returns `{ id, token }` once; token is not retrievable again |
| `GET` | `/api/floors` | read | List all rows (status, labels, heartbeat) — for the settings UI |
| `GET` | `/api/floors/:id` | read | Single row |
| `PUT` | `/api/floors/:id` | admin | Update labels, namespace, enabled |
| `DELETE` | `/api/floors/:id` | admin | Soft-disable (`enabled = false`); never hard-delete while station runs reference the row |
| `PUT` | `/api/floors/:id/heartbeat` | floor | Update `last_heartbeat_at` and current labels; authenticated with the Floor's own token |
| `POST` | `/api/floors/:id/claim` | floor | Claim one pending station run matching the Floor's labels; returns the run or `null` |

The `floor` auth scope is a new scope type in `pipeline.api_tokens`, scoped to a single
`floor_id`. It may call only `PUT /api/floors/:id/heartbeat`, `POST /api/floors/:id/claim`,
and `PATCH /api/station-runs/:id` (outcome write). The Floor cannot read other Floors'
data or create new resources.

## Registration and credential propagation

The registration process converts a bootstrap credential into a per-Floor token,
keeping the only cross-cluster secret minimal.

### How a new Floor registers

1. The operator installs the Floor Helm chart into the target cluster with two
   required values: `loreApi.url` (the central Lore API base URL) and
   `loreApi.bootstrapToken` (an existing admin-scope API token from Lore).

2. On `helm install`, a Kubernetes `Job` (`lore-floor-register`) runs once:
   ```
   POST /api/floors
   Authorization: Bearer <bootstrapToken>
   { "name": "<values.floor.name>", "labels": <values.floor.labels>,
     "namespace": "<values.floor.namespace>" }
   ```
   Lore creates the `pipeline.floors` row, mints a new floor-scoped token,
   returns `{ id, token }`.

3. The registration Job writes the returned token into a cluster-local K8s
   Secret (`lore-floor-token`) in the Floor's namespace using a `kubectl`
   side-car. The bootstrap token is never stored anywhere in the target cluster
   after this point.

4. The Floor Deployment mounts `lore-floor-token` as an env var
   (`LORE_FLOOR_TOKEN`). On re-registration (`helm upgrade --set floor.rotate=true`),
   the Job runs again, Lore invalidates the old token and issues a new one, and
   the Job overwrites the Secret.

5. The bootstrap token is consumed once and can be rotated or revoked by the operator
   without affecting any already-registered Floors, because each Floor uses its own
   scoped token.

### Credential surface

| Secret | Where it lives | Who holds it |
|---|---|---|
| Admin bootstrap token | Operator's `.env` or CI secret at deploy time | Never stored in the target cluster after registration |
| Floor-scoped token | K8s Secret in the Floor's cluster (`lore-floor-token`) | Only the Floor's own cluster and Lore (as a SHA-256 hash) |
| in-cluster SA | K8s service account in the Floor's cluster | The Floor process; used to create Agent CRs in its own cluster only |

Lore stores `token_hash = sha256(token)` — the plaintext token is never persisted
in the Lore database.

## Capability labels and routing

Floors carry a free-form label map (e.g. `{ zone: "eu-west1", trust: "full", gpu: "T4" }`).
Assembly line node definitions (in the YAML) may declare a `requirements` map. The
claim endpoint matches: a Floor may claim a run only when its labels are a superset
of the run's requirements. Station runs with no `requirements` can be claimed by any
Floor.

```yaml
# Example: a node that must run on a GPU-equipped Floor
nodes:
  - id: train
    station_ref: gpu-fine-tune
    requirements:
      gpu: "T4"
```

```sql
-- Claim: atomic, SKIP LOCKED, label superset check
UPDATE pipeline.station_runs
SET floor_id = $floorId, claimed_at = now(), status = 'claimed'
WHERE id = (
  SELECT id FROM pipeline.station_runs
  WHERE floor_id IS NULL
    AND status = 'pending'
    AND ($floorLabels @> requirements OR requirements = '{}'::jsonb)
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *
```

The Floor process polls this endpoint every 5 seconds while idle; it backs off to
30 seconds when there is no work available, and returns to 5 seconds immediately
after claiming a run.

## Station-run execution on a remote Floor

Once a Floor claims a station run, it creates an Agent CR in its own cluster
using the in-cluster service account (no kubeconfig secret needed — the Floor pod
has `agents.re-cinq.com` `create`/`get`/`list`/`delete` RBAC in its namespace by
default via the Helm chart).

The execution path in `apps/floor/src/jobs/assembly-run/advance.ts` is extended to
accept an optional `floorClient` (a `CustomObjectsApi` built from the in-cluster
config) rather than always constructing one from the default kubeconfig. Remote
Floors build this client themselves; the primary Floor's existing path is unchanged.

Outcome writes (station run terminal state) go back to Lore through `PATCH
/api/station-runs/:id` with the Floor's scoped token. The Lore API updates the
`pipeline.station_runs` row and fires the `kubernetes.agent.succeeded/failed` event
into `pipeline.events` so the drain loop advances the assembly run — exactly as
the current Kubernetes watcher does for the primary cluster.

## Heartbeat and stale-Floor reaper

Each Floor process calls `PUT /api/floors/:id/heartbeat` every 60 seconds with
its current labels. A cron in the Lore API (not the Floor — the Floor cannot
coordinate across instances) scans for Floors whose `last_heartbeat_at` is more
than 5 minutes old and sets `status = 'offline'`. Runs claimed by an offline Floor
that have not produced an outcome within 10 minutes are released: `floor_id` and
`claimed_at` are cleared, `status` is reset to `pending`, and the run re-enters
the queue for any available Floor to claim.

This mirrors the `lease_expired` audit entry written by the lease-reaper — the
cron also writes a `floor_stale` entry to `pipeline.audit_log`.

## Migrations

Two sequential migrations under `infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/`:

**`0045_floors.sql`**
```sql
CREATE TABLE pipeline.floors (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL UNIQUE,
  labels            jsonb       NOT NULL DEFAULT '{}',
  namespace         text        NOT NULL DEFAULT 'ai-agents',
  token_hash        text        NOT NULL,
  last_heartbeat_at timestamptz,
  status            text        NOT NULL DEFAULT 'offline'
                                CHECK (status IN ('online','offline')),
  enabled           bool        NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Seed the primary (in-cluster) Floor; token_hash is updated on first heartbeat
-- if LORE_FLOOR_TOKEN is set, or left as a placeholder until the floor registers.
INSERT INTO pipeline.floors (name, labels, status, token_hash)
VALUES ('primary', '{"trust":"full"}', 'online', 'pending-seed');
```

**`0046_station_runs_floor.sql`**
```sql
ALTER TABLE pipeline.station_runs
  ADD COLUMN floor_id    uuid        REFERENCES pipeline.floors(id),
  ADD COLUMN claimed_at  timestamptz,
  ADD COLUMN requirements jsonb NOT NULL DEFAULT '{}';

-- Existing station runs (all on the primary Floor) are backfilled
UPDATE pipeline.station_runs
SET floor_id = (SELECT id FROM pipeline.floors WHERE name = 'primary');

-- Index for the claim query
CREATE INDEX ON pipeline.station_runs (status, claimed_at)
  WHERE floor_id IS NULL AND status = 'pending';
```

The `floor_id` column is nullable initially so the migration applies cleanly before
the backfill. A follow-up migration may add `NOT NULL` once all existing rows are
covered and the Floor is confirmed stable.

## Helm chart

A new Helm sub-chart `charts/lore-floor-helm` (sibling to the existing
`charts/ai-agents-helm`) packages the Floor Deployment alongside the AI subsystem.
It is also added as a subchart of `lore-platform` (the umbrella chart) so the
primary cluster continues to be deployed with a single `helm upgrade`.

The subchart ships:
- `Deployment/lore-floor` — the Floor process image
- `Job/lore-floor-register` — runs on `post-install,pre-upgrade`; idempotent on `name`
- `Secret/lore-floor-token` — written by the registration Job, mounted into the Floor Deployment
- `RBAC` — `ClusterRole` + `ClusterRoleBinding` for `agents.re-cinq.com` CRUD in the target namespace
- **Subchart dependency**: `ai-agents-helm` (the ai-agent-subsystem controller + CRDs)

Values (required for a standalone install):
```yaml
floor:
  name: my-remote-floor        # unique across the org
  labels: {}                   # capability labels
  namespace: ai-agents

loreApi:
  url: https://lore-api.example.com
  bootstrapToken: ""           # admin-scope token; consumed once at registration
```

For the primary cluster deploy, `bootstrapToken` is already in `secrets.tfvars` as
the existing `lore_ingest_token`; terraform passes it as a Helm value. No new secret
is minted.

## Integration — real files this feature touches

- **`libs/shared/src/models/floor.ts`** — new file: `FloorSchema`, `FloorModel` type, `FLOOR_COLUMNS` ColumnMap, following `libs/shared/src/models/repo.ts`.
- **`libs/shared/src/models/station-run.ts`** — add `floor_id`, `claimed_at`, `requirements` to the schema and `STATION_RUN_COLUMNS`.
- **`libs/shared/src/project/floors/floors-port.ts`** — new file: `FloorsPort` interface (`register`, `heartbeat`, `claim`, `release`, `listStale`).
- **`libs/shared/src/project/floors/floors-pg.ts`** — `PgFloorsAdapter` implementing the port; used by Lore API only.
- **`libs/shared/src/project/floors/floors-http.ts`** — `HttpFloorsAdapter` implementing the port; used by remote Floor processes calling the Lore API.
- **`apps/lore-api/src/api/routes/floors/floors.ts`** — new file: all `/api/floors` and `/api/floors/:id/*` routes. Auth via `bearerScope('admin')` for writes, `bearerScope('read')` for reads, `bearerScope('floor')` for heartbeat/claim/outcome.
- **`apps/lore-api/src/api/routes/station-runs/station-runs.ts`** — new file: `PATCH /api/station-runs/:id` (outcome write from Floor).
- **`apps/lore-api/src/server/build-server.ts`** — register the new routes.
- **`apps/lore-api/src/platform/api-tokens.ts`** — add `floor` scope; scope check gates on `token.floor_id === params.id` to prevent one Floor from touching another's runs.
- **`apps/floor/src/jobs/assembly-run/advance.ts`** — accept an optional `FloorClient` for CR creation; existing primary-Floor path is unchanged.
- **`apps/floor/src/main-loop/heartbeat.ts`** — new file: 60 s interval that calls `PUT /api/floors/:id/heartbeat`.
- **`apps/floor/src/main-loop/claim-loop.ts`** — new file: 5 s → 30 s adaptive poll that calls `POST /api/floors/:id/claim` and dispatches the claimed run.
- **`apps/floor/src/kernel/queues.ts`** — add `floors()` lazy singleton backed by `PgFloorsAdapter` (primary Floor only; remote Floors use `HttpFloorsAdapter`).
- **`apps/lore-api/src/jobs/floor-reaper.ts`** — new file: cron (60 s) that marks stale Floors `offline` and releases their stuck runs.
- **`charts/lore-floor-helm/`** — new Helm sub-chart (Deployment, Job, Secret, RBAC, subchart dep on `ai-agents-helm`).
- **`charts/lore-platform/Chart.yaml`** — add `lore-floor-helm` as a subchart dependency.
- **`infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/`** — migrations 0045 and 0046 (see Migrations section).
- **`apps/web-ui/src/app/settings/floors/`** — new Floors sub-page: table of registered Floors (name, labels, status, heartbeat), enable/disable toggle, registration instructions. Wired into the org Settings nav.
- **`scripts/infra/setup-minikube-agents.sh`** — add `lore-floor-register` Job call so `npm start` with `LORE_STATION_BACKEND=k8s` registers the local minikube Floor automatically.

## Open questions

| # | Question |
|---|----------|
| Q1 | Should `station_runs.floor_id` become `NOT NULL` in a follow-up migration, or stay nullable long-term? |
| Q2 | What is the right claim-loop back-off ceiling: 30 s or 60 s? |
| Q3 | Should the stale-Floor reaper live in the Lore API as a cron or as a Floor-side job? (D7 says Lore API, but a Floor-side safety net for its own stale peers may be warranted.) |

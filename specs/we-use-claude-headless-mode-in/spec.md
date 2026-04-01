# Feature Specification: Automated Claude Headless Container Rebuild Pipeline

| Field             | Value                                      |
|-------------------|--------------------------------------------|
| Feature           | Automated Container Rebuild Pipeline       |
| Branch            | feat/container-rebuild-automation          |
| Status            | Draft                                      |
| Created           | 2026-03-25                                 |
| Owner             | Platform Engineering                       |
| Phase 0 Target    | 2-3 working days                           |
| Full Stack Target | 4-6 weeks                                  |

## Problem Statement

The Lore Agent runs Claude Code in headless mode within Kubernetes containers. 
Currently, container images are rebuilt manually when Claude dependencies are updated, 
new Claude versions are released, or other base image dependencies require patching. 
This manual process creates operational friction: out-of-date containers running 
older Claude code versions, security patches delayed, and unpredictable task failures 
due to version mismatches. The platform team has no visibility into which containers 
are stale, and developers don't know when their delegated tasks are using outdated 
Claude Code capabilities.

## Vision

Container images rebuild automatically whenever upstream dependencies change — Claude 
SDK version updates, base OS patches, Node.js LTS releases, or any pinned dependency 
in `agent/Dockerfile`. Automation is transparent (pull requests, notifications), 
auditable (rebuild history with reasons), and safe (test before rolling out). Developers 
always run the latest Claude Code without manual intervention.

## User Personas

### Platform Engineer

Operates the Lore infrastructure on GKE. They need to know when images are stale, 
see rebuild history, and control rollout policies (immediate vs. staged). They want 
automated rebuilds for routine updates but can manually approve for critical changes.

### Lore Agent

The headless service running tasks. It needs to pull fresh images automatically when 
new versions are available. It needs predictable, tested containers that don't fail 
mid-task due to version incompatibilities.

### Developer (End User)

Delegates work to the agent via `create_pipeline_task`. They should never know or care 
about container versions. When their task runs, it should use the latest Claude Code 
and dependencies available.

## User Scenarios & Acceptance Criteria

### Scenario 1: Claude SDK Update Detection

**Actor:** Renovate (dependency bot) / Automation

**Flow:**

1. Anthropic releases Claude SDK v0.14.0 (minor version bump).
2. Renovate detects the new version in `agent/package.json`.
3. Renovate opens a PR (`chore(deps): update @anthropic-ai/sdk to v0.14.0`) on the 
   Lore repo.
4. Automated tests run (lint, type check, unit tests against the new SDK).
5. If tests pass, the PR is auto-merged (no human approval needed for non-major).
6. Post-merge, the `build-containers.yml` workflow triggers.
7. New image is built: `gcr.io/re-cinq-gke/lore-agent:claude-v0.14.0`.
8. Image is tested in a temporary pod (quick smoke test: agent starts, responds 
   to health check).
9. If test passes, the image is tagged `latest` and pushed to registry.
10. Rolling deployment updates the `lore-agent` StatefulSet. Old pods are drained 
    gracefully (in-flight tasks complete before shutdown).
11. New agent pods start with the new image.

**Acceptance Criteria:**

- Renovate PR opens within 1 hour of release (GitHub App token configured).
- Tests pass or fail within 2 minutes of PR creation.
- Image builds and pushes within 3 minutes of PR merge.
- Rolling deployment completes within 5 minutes with zero downtime.
- A GitHub Issue is created (labeled `container-rebuild`) summarizing: version, 
  test results, image digest, deployment time.

### Scenario 2: Base Image Security Patch

**Actor:** Renovate (renovate.json configured for base images)

**Flow:**

1. Alpine Linux publishes security patch v3.19.2 (the base for `lore-agent` 
   Dockerfile: `FROM node:20-alpine`).
2. Node.js maintainers update their node:20-alpine tag within 48 hours.
3. Renovate detects the Dockerfile change (base image digest changed).
4. Renovate opens a PR with the new base image hash.
5. Tests run (same as SDK update).
6. Auto-merge, build, smoke test, tag, deploy (same as Scenario 1).

**Acceptance Criteria:**

- Detection latency ≤ 2 days from Node.js release.
- PR includes changelog/advisory link (Renovate adds this automatically).
- Image is pushed with metadata tag: `gcr.io/re-cinq-gke/lore-agent:base-node-20-alpine-3.19.2`.

### Scenario 3: Manual Rebuild Trigger (Critical Hotfix)

**Actor:** Platform Engineer

**Flow:**

1. A critical bug is found in Lore Agent code (e.g., task timeout handling).
2. Engineer fixes the bug and merges to `main`.
3. Engineer runs: `make rebuild-containers` or clicks "Rebuild Now" in the 
   Web UI settings page.
4. Build pipeline re-triggers manually.
5. New image is built with next semver tag: `gcr.io/re-cinq-gke/lore-agent:v1.2.3`.
6. Engineer can opt to skip smoke tests for critical hotfixes (flag: 
   `--skip-smoke-tests`).
7. Deployment happens immediately (or staged if configured).

**Acceptance Criteria:**

- Manual trigger completes within 5 minutes.
- Image is tagged with the next SemVer version (auto-bumped).
- Deployment happens within the configured wait window (default: immediate, 
  configurable per deployment).
- A GitHub Issue is created with manual rebuild reason.

### Scenario 4: Staged Rollout (Major Claude Version)

**Actor:** Platform Engineer (approval) + Automation (execution)

**Flow:**

1. Claude 4.0 major version is released.
2. Renovate opens PR with major version bump (requires human approval per renovate.json).
3. Engineer reviews: breaking changes documented? SDK migration guide read?
4. Engineer approves by adding `approved` label to the PR (or commenting `/approve`).
5. PR is merged.
6. Build triggers, image is created but tagged as `v2-canary` (not `latest` yet).
7. Canary deployment: update 1 replica of the StatefulSet to use `v2-canary`.
8. Monitor for 10 minutes: error rate, task success rate, latency.
9. If metrics look good, promote to `latest` and roll out to all replicas.
10. If issues detected, rollback the canary pod and keep the old image on other replicas.

**Acceptance Criteria:**

- Manual approval required for major version bumps (configured in `renovate.json`).
- Canary deployment to 1 replica completes within 10 seconds.
- Metrics are collected for 10 minutes (success rate, error rate, task latency).
- Promotion decision is logged (GitHub Issue).
- Rollback is manual or automatic (threshold-based) — configurable.

### Scenario 5: Rebuild Failure Alerting

**Actor:** Automation + Platform Engineer

**Flow:**

1. Build pipeline fails (e.g., test failure against new SDK).
2. GitHub Actions workflow stops, PR is left open with status `❌`.
3. Platform engineer is notified via Slack (webhook configured).
4. Engineer reviews the test logs, identifies the incompatibility.
5. Engineer either fixes the code or downgrades the dependency (creates a commit 
   on the PR).
6. Tests re-run automatically.
7. If fixed, the PR is merged and build resumes.
8. If the issue is blocking, engineer can `+1` the Renovate PR to pause automatic 
   updates and manually manage the version for this cycle.

**Acceptance Criteria:**

- Build failure stops the pipeline (does not auto-merge or deploy broken image).
- Slack notification includes: failure reason (test output excerpt), PR link, 
  suggested action.
- Platform engineer can re-trigger tests from the PR comment: `/retest`.
- A GitHub Issue is created with the failure details for post-mortem (if critical).

## Functional Requirements

1. **Renovate Configuration**
   - `renovate.json` in repo root configures automatic dependency updates
   - Separate rules for: NPM packages (`agent/package.json`), base image 
     (`agent/Dockerfile`), and GitHub Actions (`.github/workflows/`)
   - Non-breaking updates (minor, patch) auto-merge; major versions require approval
   - Renovate commit message format: `chore(deps): <package> to <version>`
   - Update frequency: daily for security, weekly for minor/patch

2. **Build Pipeline (GitHub Actions)**
   - `build-containers.yml` triggers on: PR merge to `main`, or manual workflow dispatch
   - Steps: lint TypeScript, run unit tests, build multi-arch image (amd64, arm64), 
     push to GCR with image hash digest tag
   - Image naming: `gcr.io/re-cinq-gke/lore-agent:<tag>`
   - Tag strategy:
     - Renovate: `claude-<version>` or `base-<image>-<digest-short>` 
     - Manual: `v<semver>`
     - Rollback: `v<semver>-rollback-<timestamp>`
   - Always tag as `latest` if building from `main` (after smoke test passes)
   - Fail fast on test failure; do not push image if tests fail

3. **Smoke Test (Post-Build)**
   - Create temporary pod in `lore-test` namespace
   - Run health check: agent responds to `GET /healthz` with 200 OK
   - Check logs for errors in first 10 seconds of startup
   - Timeout: 30 seconds total
   - Success = proceed to tag as `latest` and deploy; Failure = tag as `<tag>-failed` 
     and alert

4. **Rolling Deployment Strategy**
   - Use StatefulSet in `lore-agent` namespace with `maxUnavailable: 0` 
     (zero-downtime)
   - Update image in StatefulSet spec → Kubernetes rolls out
   - Monitor: task queue depth, error rate, latency during rollout
   - Drain timeout: 2 minutes per pod (in-flight tasks complete before termination)
   - Rollback available via: `kubectl rollout undo` or manual image downgrade

5. **Image History & Metadata**
   - Store in GCR with labels: `git-sha`, `git-tag`, `renovate-pr-url`, `build-date`, 
     `test-status`
   - Query via: `gcloud container images list-tags gcr.io/re-cinq-gke/lore-agent`
   - Retention: keep last 20 images, delete others (GCR lifecycle policy)

6. **GitHub Issue Creation (Post-Rebuild)**
   - Automation creates issue on Lore repo: `[container-rebuild] <version update description>`
   - Labels: `container-rebuild`, `automation`
   - Body includes: old version, new version, changelog link, test results, 
     deployment status, image digest, timestamp
   - Issue is read-only (no manual edits needed)

7. **Rollback Mechanism**
   - Platform engineer can rollback via: `kubectl rollout undo statefulset/lore-agent -n lore-agent`
   - Or via Web UI: Settings → Deployments → select version → "Rollback to <version>"
   - Rollback creates a new GitHub Issue: `[container-rollback] rolled back from v1.2.3 to v1.2.2`

8. **Canary Deployments (Optional, for Major Versions)**
   - Create a separate Deployment or DaemonSet: `lore-agent-canary`
   - Run 1 replica of new image
   - Monitor metrics (task success, error rate, latency) for 10 minutes
   - Threshold-based promotion: if error rate < 0.5% and latency p95 < 2s, promote
   - Manual promotion option: engineer approves via GitHub Issue comment `/promote-canary`

9. **Dependency Management**
   - Lock files are committed: `agent/package-lock.json`
   - No pinning required (Renovate respects the lock file)
   - Dockerfile: base image pinned by digest hash (Renovate updates this)
   - Example: `FROM node:20-alpine@sha256:abc123...` 

10. **Secret/Credential Management**
    - No hardcoded credentials in images
    - Use GKE Workload Identity for authentication (GCR pull, GCS read)
    - Build secrets (if needed for build-time auth) injected via GitHub Actions secrets
    - Lore Agent runtime secrets mounted as K8s Secrets (API keys, database URL)

## Non-Functional Requirements

1. **Performance**
   - Build + test + push: ≤ 5 minutes
   - Smoke test: ≤ 30 seconds
   - Rolling deployment: ≤ 5 minutes (for full StatefulSet update)
   - Renovate detection latency: ≤ 2 hours (cron: 3 AM UTC daily)

2. **Reliability**
   - Build pipeline SLO: 99% success rate over 30 days
   - Zero data loss or task failures due to stale images
   - Automatic retry on transient failures (network, GCR throttling)
   - Manual override always available for platform engineers

3. **Security**
   - All images scanned for CVEs before promotion to `latest` (Trivy scan)
   - Failed security scans block deployment (create blocking GitHub check)
   - No secrets in image layers (validated by Trivy)
   - SBOM generated and stored with each image (CycloneDX format)
   - GCR access restricted to Workload Identity (no service account keys)

4. **Observability**
   - Build logs: stored in Cloud Logging (24-hour retention minimum)
   - Deployment logs: stored in Cloud Logging
   - Metrics: task success rate, error rate, latency per image version 
     (visible in metrics dashboard)
   - Alerts: Slack notification on build failure, smoke test failure, or rollback

5. **Auditability**
   - All rebuilds logged in a GitHub Issue (auto-created)
   - Build logs linked in the issue
   - Deployment history queryable: `gcloud container images list-tags`
   - Rollback reason documented in a GitHub Issue

## Out of Scope

- **Multi-cloud deployments** — this feature is GKE-specific (uses GCR, Workload Identity)
- **Custom Claude Code forks** — assumes official Anthropic SDK only
- **Database schema migrations** — container rebuilds do not trigger schema changes 
  (handled separately in agent startup)
- **Kubernetes cluster upgrades** — assumes cluster is already running and stable
- **Image signing / provenance** — Cosign integration deferred to Phase 2
- **Helm chart updates** — assumes Helm chart pins image tags manually (not auto-updated)
- **Non-agent containers** — this spec applies only to `lore-agent` (not MCP server, 
  Web UI, or db containers)

## Key Entities

### Container Image

- **Entity**: `ContainerImage`
- **Fields**: 
  - `name` (string): `lore-agent`
  - `registry` (string): `gcr.io/re-cinq-gke`
  - `digest` (string): image hash, immutable reference
  - `tags` (array of string): `latest`, `v1.2.3`, `claude-v0.14.0`, etc.
  - `build_timestamp` (datetime): when image was built
  - `git_sha` (string): source commit that triggered build
  - `test_status` (enum): `passed`, `failed`, `skipped`
  - `deployment_status` (enum): `staged`, `canary`, `production`, `rolled_back`
  - `cve_scan_status` (enum): `passed`, `failed`, `pending`

### Rebuild Task

- **Entity**: `RebuildTask`
- **Fields**:
  - `id` (UUID): unique identifier
  - `trigger_type` (enum): `renovate_pr`, `manual`, `scheduled`
  - `dependency_type` (enum): `sdk`, `base_image`, `node_modules`, `other`
  - `old_version` (string): previous dependency version
  - `new_version` (string): new dependency version
  - `renovate_pr_url` (string, nullable): link to Renovate PR
  - `github_issue_url` (string): link to created GitHub Issue
  - `build_log_url` (string): Cloud Logging link
  - `status` (enum): `pending`, `building`, `testing`, `deploying`, `success`, `failed`, `rolled_back`
  - `created_at` (datetime)
  - `completed_at` (datetime, nullable)

### Deployment

- **Entity**: `Deployment`
- **Fields**:
  - `id` (UUID)
  - `image_digest` (string): image being deployed
  - `deployment_type` (enum): `rolling`, `canary`, `rollback`
  - `start_time` (datetime)
  - `end_time` (datetime, nullable)
  - `replicas_updated` (integer)
  - `replicas_ready` (integer)
  - `status` (enum): `in_progress`, `completed`, `failed`
  - `rollback_reason` (string, nullable)

**Data Model (PostgreSQL)**

```sql
CREATE TABLE container_images (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  registry VARCHAR(255) NOT NULL,
  digest VARCHAR(255) UNIQUE NOT NULL,
  tags TEXT[] NOT NULL,
  build_timestamp TIMESTAMP NOT NULL,
  git_sha VARCHAR(40) NOT NULL,
  test_status VARCHAR(50) NOT NULL,
  deployment_status VARCHAR(50) NOT NULL,
  cve_scan_status VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE rebuild_tasks (
  id UUID PRIMARY KEY,
  trigger_type VARCHAR(50) NOT NULL,
  dependency_type VARCHAR(50) NOT NULL,
  old_version VARCHAR(255),
  new_version VARCHAR(255) NOT NULL,
  renovate_pr_url TEXT,
  github_issue_url TEXT NOT NULL,
  build_log_url TEXT,
  status VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE deployments (
  id UUID PRIMARY KEY,
  image_digest VARCHAR(255) NOT NULL REFERENCES container_images(digest),
  deployment_type VARCHAR(50) NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  replicas_updated INTEGER,
  replicas_ready INTEGER,
  status VARCHAR(50) NOT NULL,
  rollback_reason TEXT
);
```

## Success Criteria

1. **Adoption**: Within 2 weeks of deploy, 100% of Claude SDK and base image 
   updates are automated (no manual PR opens).

2. **Latency**: Time from Renovate PR merge to image deployed to production 
   ≤ 10 minutes (p95).

3. **Reliability**: 0 production incidents caused by stale container images 
   (in the 30 days post-launch).

4. **Coverage**: Renovate tracks ≥ 95% of dependencies in `agent/package.json` 
   and Dockerfile (test by checking that `renovate.json` has rules for all pinned versions).

5. **Visibility**: Platform engineers can answer these questions in ≤ 10 seconds:
   - What version of Claude SDK is running in production?
   - When was the last rebuild? What triggered it?
   - What security issues (CVEs) are present in the current image?
   - Can I see the full build log for a specific deployment?

6. **Recovery**: A rollback from broken image to previous version completes 
   in ≤ 2 minutes with zero data loss.

7. **Cost**: No change to GKE compute costs (container images are pushed to GCR, 
   which is negligible cost; build time is CI infrastructure already budgeted).

## Assumptions

1. **Renovate is configured and running** — GitHub App is installed, `renovate.json` 
   exists in the Lore repo, and Renovate has write access to open PRs.

2. **GitHub Actions runners are available** — GKE cluster already runs a self-hosted 
   runner pool for builds, or GitHub-hosted runners are sufficient for build times ≤ 5 min.

3. **GCR and GKE are already set up** — Workload Identity is configured, service 
   accounts exist, and image pull secrets are in place.

4. **Monitoring infrastructure exists** — Cloud Logging, Cloud Monitoring, and 
   Slack webhooks are available for alerts.

5. **Claude SDK is stable** — no breaking changes weekly; when they occur, they're 
   flagged as major version bumps and require human review (handled by Renovate 
   major version approval).

6. **Tests are fast** — unit and lint tests on agent code complete in ≤ 2 minutes 
   (sufficient for <5 min total build time).

7. **No private dependencies** — all dependencies come from public registries 
   (npm, GCR, etc.). If private deps exist, they're injected at runtime, not at build time.

8. **Lore Agent stateless** — no local state in the container; all state is in PostgreSQL. 
   Pods can be terminated and restarted without data loss.

9. **Task queue is durable** — in-flight tasks are preserved in PostgreSQL; if a pod 
   is killed mid-task, the task is requeued on a new pod.

10. **Platform engineers have sufficient access** — can approve Renovate PRs, 
    run manual `make` targets, and access GCP project resources (GCR, GKE, logging).
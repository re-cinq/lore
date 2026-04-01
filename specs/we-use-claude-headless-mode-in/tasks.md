# Phase 1: Setup

- [ ] T001 [P] Create Dockerfile for Claude headless container with dependencies pinned to `Dockerfile`
  - Base image: Python 3.11 slim
  - Install: anthropic SDK, git, curl, jq
  - Set working directory and entrypoint for headless execution
  - Pin all versions explicitly in Dockerfile

- [ ] T002 [P] Set up container registry and push infrastructure to `terraform/modules/gke-container-registry/`
  - Create Terraform module for GCP Artifact Registry
  - Configure image retention and scan policies
  - Set up Workload Identity for push permissions
  - Document registry URL pattern in terraform outputs

- [ ] T003 [P] Configure Renovate bot configuration file to `.renovaterc.json`
  - Add datasources for: Python packages (Dockerfile), anthropic SDK versions, base image updates
  - Set automerge rules for patch/minor updates to dependencies
  - Configure schedule for dependency checks (e.g., Mon-Fri 6 AM)
  - Set up branch naming convention (e.g., `renovate/claude-*`)

- [ ] T004 Create GitHub Actions workflow for manual image rebuild trigger to `.github/workflows/rebuild-claude-image.yml`
  - Accept optional input for specific Claude version
  - Accept optional input for dependency override
  - Trigger Dockerfile build and push to registry on dispatch
  - Log build metrics (duration, digest, size)

# Phase 2: Core

- [ ] T005 Set up Renovate PR detection workflow to `.github/workflows/renovate-trigger.yml`
  - Listen for merged Renovate PRs on the main branch
  - Extract updated dependency versions from commit message or Dockerfile
  - Trigger container rebuild job if Claude version or critical dependency changed
  - Comment on merged PR with image digest and push status

- [ ] T006 Create container image version tracking table to `agent/src/schema/image-versions.sql`
  - Schema: `image_versions` table with fields: id, claude_version, dependency_hash, base_image_tag, image_digest, pushed_at, renovate_pr_id
  - Add indexes on claude_version and pushed_at for fast lookups
  - Store hash of all dependencies for change detection

- [ ] T007 [P] Implement dependency change detection logic to `agent/src/container/dependency-checker.ts`
  - Parse Dockerfile and extract all pinned versions
  - Compare against last successful build in image_versions table
  - Detect changes in: anthropic SDK, system packages, base image
  - Return boolean: needs_rebuild and change_summary

- [ ] T008 Implement container build and push service to `agent/src/container/image-builder.ts`
  - Use Docker client to build image with tag: `claude-headless:claude-{version}-{timestamp}`
  - Push to configured registry with error retry logic (exponential backoff, max 3 attempts)
  - Record build metadata (digest, size, build_time_seconds) in image_versions table
  - Handle registry auth via Workload Identity

- [ ] T009 Create scheduled job for daily dependency check to `agent/src/scheduler/daily-image-check.ts`
  - Run at 2 AM UTC (same slot as context reindex, adjustable in config)
  - Invoke dependency-checker against current Dockerfile
  - If changes detected: trigger image-builder and log to pipeline
  - Emit OpenTelemetry span for observability

- [ ] T010 [P] Add Renovate PR webhook handler to `agent/src/webhooks/renovate-webhook.ts`
  - Listen on POST `/webhooks/renovate` 
  - Verify GitHub signature (X-Hub-Signature-256)
  - On PR merge event: extract changed file paths
  - If Dockerfile changed: parse versions, trigger image-builder
  - Return 200 OK or 400 Bad Request with error details

- [ ] T011 Implement image rollback mechanism to `agent/src/container/image-rollback.ts`
  - Store image digests and push timestamps in image_versions
  - Provide function: rollback_to_image(image_digest) that updates active version
  - Emit event to Kubernetes to restart Claude headless pods with previous digest
  - Log rollback reason and actor in audit table

# Phase 3: Integration

- [ ] T012 [P] Wire dependency checker into Lore Agent startup to `agent/src/platform.ts`
  - At service boot: fetch latest image_versions entry
  - Compare against configured CLAUDE_VERSION env var
  - If mismatch detected: log warning, optionally fail fast or schedule rebuild
  - Store checked timestamp to avoid repeated checks

- [ ] T013 Create MCP tool for manual image rebuild to `mcp-server/src/tools/rebuild-claude-image.ts`
  - Tool: `trigger_image_rebuild` accepts optional params: claude_version, force_rebuild
  - Calls agent API endpoint to queue rebuild task
  - Returns build job ID and estimated completion time
  - Available in Claude Code for emergency rebuilds

- [ ] T014 Add image version endpoint to Lore Agent API to `agent/src/api/routes/image-status.ts`
  - GET `/api/image-status` returns: current_claude_version, last_rebuild_timestamp, last_rebuild_status, pending_renovate_prs
  - GET `/api/image-versions` returns paginated list of all built versions with metadata
  - POST `/api/image-rebuild` queues a rebuild task (gated by optional approval_required flag from settings)

- [ ] T015 Create web UI dashboard page for container management to `web-ui/app/container-management/page.tsx`
  - Display current Claude version and base image in use
  - Show recent build history (last 5 builds with timestamps, digests, sizes)
  - Display pending Renovate PRs affecting Dockerfile
  - One-click button to manually trigger rebuild
  - Show last successful rebuild timestamp

- [ ] T016 [P] Add container health check job to `agent/src/scheduler/container-health-check.ts`
  - Run every 6 hours
  - Pull current image from registry
  - Verify image digest matches deployed version
  - Check Dockerfile against image contents (spot check key tools installed)
  - Alert if mismatch detected (log to pipeline, optionally create issue)

- [ ] T017 Update Helm chart for Claude headless service to `terraform/modules/gke-claude-headless/values.yaml`
  - Add image.repository and image.tag parameters
  - Configure image pull policy (IfNotPresent for cost savings)
  - Add init container that polls image-versions API for latest digest
  - Set up liveness probe that validates Claude SDK is responsive

- [ ] T018 Create documentation for image rebuild workflow to `docs/container-rebuild-workflow.md`
  - Explain how Renovate triggers rebuilds automatically
  - Document manual rebuild via UI, CLI, and MCP tool
  - Explain image versioning scheme and rollback procedure
  - Link to Dockerfile, .renovaterc.json, and scheduler configs
  - Include troubleshooting section (push failures, incomplete pulls, version mismatches)

- [ ] T019 Add container rebuild cost tracking to `agent/src/metrics/container-metrics.ts`
  - Track per-rebuild: build_duration_seconds, image_size_mb, push_duration_seconds
  - Estimate cost (GCP Artifact Registry per-GB storage + build compute)
  - Aggregate daily/monthly costs in analytics dashboard
  - Alert if rebuild frequency exceeds threshold (e.g., >5 per day)

- [ ] T020 Set up end-to-end test for rebuild pipeline to `evals/container-rebuild-e2e.test.ts`
  - Create test Dockerfile with pinned version
  - Trigger Renovate-style dependency update (e.g., bump SDK version in test fixture)
  - Verify webhook fires and rebuild is queued
  - Poll image-versions table and verify new entry created
  - Validate image digest matches expected format
  - Clean up test image from registry after verification
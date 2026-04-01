# Lore: Claude Headless Mode Container Image Rebuilds

## Overview

The feature request indicates that Lore runs Claude Code in **headless mode within containers** on the Lore Agent service (GKE). Currently, there is no data model for tracking:

1. **Container image versions** and their dependencies
2. **Dependency update events** (e.g., new Claude SDK version, dependency vulnerabilities)
3. **Container rebuild triggers** (manual, scheduled, dependency-based)
4. **Rebuild history and status** (success/failure, timing, cost)

This spec defines the minimal data model needed to support automated container image rebuilds via Renovate or similar tools.

---

## Data Model Changes

### 1. New Table: `container_images`

Tracks container images used by Lore Agent for headless Claude Code execution.

```sql
CREATE TABLE container_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Image identification
  name TEXT NOT NULL UNIQUE,
  registry TEXT NOT NULL,  -- e.g., "gcr.io", "docker.io"
  repository TEXT NOT NULL,  -- e.g., "re-cinq/lore-agent"
  
  -- Version tracking
  latest_tag TEXT,  -- e.g., "v1.2.3"
  latest_digest TEXT,  -- OCI digest for immutable reference
  current_status container_image_status NOT NULL DEFAULT 'active',
  
  -- Dependency metadata
  base_image TEXT,  -- e.g., "node:22-alpine"
  claude_sdk_version TEXT,  -- pinned Claude SDK version
  claude_sdk_constraint TEXT,  -- version spec, e.g., "^0.1.0"
  node_version TEXT,
  dependencies_lockfile TEXT,  -- content hash of package-lock.json or similar
  
  -- Tracking
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_built_at TIMESTAMP,
  last_pushed_at TIMESTAMP,
  
  CONSTRAINT valid_registry CHECK (registry IN ('gcr.io', 'docker.io', 'ghcr.io')),
  CONSTRAINT valid_status CHECK (current_status IN ('active', 'deprecated', 'archived'))
);

-- Status enum
CREATE TYPE container_image_status AS ENUM ('active', 'deprecated', 'archived');
```

### 2. New Table: `container_dependencies`

Tracks individual dependencies and their versions within each image.

```sql
CREATE TABLE container_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID NOT NULL REFERENCES container_images(id) ON DELETE CASCADE,
  
  -- Dependency info
  package_name TEXT NOT NULL,
  package_type dependency_type NOT NULL,  -- npm, pip, apt, etc.
  current_version TEXT NOT NULL,
  latest_available_version TEXT,
  
  -- Update tracking
  update_available BOOLEAN DEFAULT FALSE,
  update_checked_at TIMESTAMP,
  vulnerability_severity vulnerability_level,  -- none, low, medium, high, critical
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMP,
  
  UNIQUE(image_id, package_name, package_type),
  CONSTRAINT valid_package_type CHECK (package_type IN ('npm', 'pip', 'apt', 'gem', 'cargo'))
);

CREATE TYPE dependency_type AS ENUM ('npm', 'pip', 'apt', 'gem', 'cargo');
CREATE TYPE vulnerability_level AS ENUM ('none', 'low', 'medium', 'high', 'critical');
```

### 3. New Table: `container_rebuild_triggers`

Defines when and why container images should be rebuilt.

```sql
CREATE TABLE container_rebuild_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID NOT NULL REFERENCES container_images(id) ON DELETE CASCADE,
  
  -- Trigger configuration
  trigger_type rebuild_trigger_type NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  
  -- Metadata
  trigger_config JSONB NOT NULL,  -- flexible config per trigger type
  description TEXT,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_fired_at TIMESTAMP,
  
  CONSTRAINT valid_trigger_type CHECK (trigger_type IN ('dependency_update', 'schedule', 'manual', 'vulnerability'))
);

CREATE TYPE rebuild_trigger_type AS ENUM ('dependency_update', 'schedule', 'manual', 'vulnerability');
```

Example `trigger_config` values:
```json
-- For dependency_update trigger
{ "package": "claude-sdk", "action": "rebuild_on_minor" }

-- For schedule trigger
{ "cron": "0 2 * * 0", "description": "Weekly Sunday 2 AM UTC" }

-- For vulnerability trigger
{ "severity": "high", "action": "rebuild_immediately" }
```

### 4. New Table: `container_rebuild_jobs`

Tracks individual rebuild attempts and their outcomes.

```sql
CREATE TABLE container_rebuild_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID NOT NULL REFERENCES container_images(id) ON DELETE CASCADE,
  trigger_id UUID REFERENCES container_rebuild_triggers(id) ON DELETE SET NULL,
  
  -- Job metadata
  job_status rebuild_job_status NOT NULL DEFAULT 'pending',
  rebuild_reason TEXT NOT NULL,  -- "Claude SDK 0.1.5 released", "Weekly scheduled rebuild", etc.
  
  -- Build details
  build_log_url TEXT,  -- link to Cloud Build logs
  base_commit TEXT,  -- git commit that triggered the rebuild
  changes_summary TEXT,  -- e.g., "Updated @anthropic-ai/sdk 0.1.4 → 0.1.5"
  
  -- Timing
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_seconds INTEGER,
  
  -- Output
  new_tag TEXT,  -- e.g., "v1.2.4"
  new_digest TEXT,
  
  -- Cost tracking
  build_cost_usd DECIMAL(10, 4),
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  CONSTRAINT valid_status CHECK (job_status IN ('pending', 'building', 'success', 'failed', 'skipped')),
  CONSTRAINT valid_timing CHECK (started_at IS NULL OR started_at >= created_at),
  CONSTRAINT valid_duration CHECK (duration_seconds IS NULL OR duration_seconds >= 0)
);

CREATE TYPE rebuild_job_status AS ENUM ('pending', 'building', 'success', 'failed', 'skipped');
```

### 5. New Table: `container_rollout_tracking`

Tracks which agents/deployments are using which image versions.

```sql
CREATE TABLE container_rollout_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID NOT NULL REFERENCES container_images(id) ON DELETE CASCADE,
  
  -- Deployment target
  deployment_name TEXT NOT NULL,  -- e.g., "lore-agent-prod", "lore-agent-staging"
  namespace TEXT DEFAULT 'lore-agent',
  
  -- Version in use
  current_tag TEXT NOT NULL,
  current_digest TEXT,
  
  -- Rollout state
  desired_tag TEXT,  -- what we want to deploy
  rollout_status deployment_rollout_status DEFAULT 'stable',
  rollout_progress_percent INTEGER,
  
  -- Timing
  last_updated_at TIMESTAMP DEFAULT NOW(),
  deployed_at TIMESTAMP,
  
  CONSTRAINT valid_rollout_status CHECK (rollout_status IN ('stable', 'rolling', 'failed', 'paused')),
  CONSTRAINT valid_progress CHECK (rollout_progress_percent >= 0 AND rollout_progress_percent <= 100)
);

CREATE TYPE deployment_rollout_status AS ENUM ('stable', 'rolling', 'failed', 'paused');
```

---

## Relationships

```
container_images (1) ──────┬────── (N) container_dependencies
                           ├────── (N) container_rebuild_triggers
                           ├────── (N) container_rebuild_jobs
                           └────── (N) container_rollout_tracking
```

---

## Indexes

```sql
-- Fast lookups by image and status
CREATE INDEX idx_container_images_status ON container_images(current_status);
CREATE INDEX idx_container_images_registry ON container_images(registry, repository);

-- Find pending rebuilds
CREATE INDEX idx_rebuild_jobs_status_created ON container_rebuild_jobs(job_status, created_at DESC);

-- Dependency update checks
CREATE INDEX idx_dependencies_image_update ON container_dependencies(image_id, update_available);
CREATE INDEX idx_dependencies_severity ON container_dependencies(vulnerability_severity);

-- Rollout state queries
CREATE INDEX idx_rollout_deployment ON container_rollout_tracking(deployment_name, namespace);
CREATE INDEX idx_rollout_status ON container_rollout_tracking(rollout_status);

-- Trigger scheduling
CREATE INDEX idx_triggers_image_enabled ON container_rebuild_triggers(image_id, enabled);
```

---

## Migration Steps

1. **Create enums** (order matters for ENUM types in PostgreSQL):
   ```sql
   CREATE TYPE container_image_status AS ENUM ('active', 'deprecated', 'archived');
   CREATE TYPE dependency_type AS ENUM ('npm', 'pip', 'apt', 'gem', 'cargo');
   CREATE TYPE vulnerability_level AS ENUM ('none', 'low', 'medium', 'high', 'critical');
   CREATE TYPE rebuild_trigger_type AS ENUM ('dependency_update', 'schedule', 'manual', 'vulnerability');
   CREATE TYPE rebuild_job_status AS ENUM ('pending', 'building', 'success', 'failed', 'skipped');
   CREATE TYPE deployment_rollout_status AS ENUM ('stable', 'rolling', 'failed', 'paused');
   ```

2. **Create tables** in dependency order:
   - `container_images` (no FK dependencies)
   - `container_dependencies` (FK to container_images)
   - `container_rebuild_triggers` (FK to container_images)
   - `container_rebuild_jobs` (FK to both)
   - `container_rollout_tracking` (FK to container_images)

3. **Create indexes** for query optimization

4. **Seed initial data**:
   - Insert one row into `container_images` for the current headless Claude Code container
   - Insert rows into `container_rebuild_triggers` for dependency updates (Claude SDK) and weekly schedules

5. **Update agent code** to:
   - Query `container_images` at startup to determine which tag to use
   - Write job records to `container_rebuild_jobs` when a rebuild completes
   - Update `container_rollout_tracking` when a new image is deployed

---

## Schema Isolation

Since Lore uses **schema-per-team isolation**, these tables should be created in the **`org_shared` schema** (not team-specific), as container image management is org-wide infrastructure.

```sql
CREATE SCHEMA IF NOT EXISTS org_shared;
-- All tables created as `org_shared.container_images`, etc.
```

---

## Integration Points

### 1. Renovate (or similar tool)
- Renovate detects dependency updates in `lore/mcp-server/package.json`, `lore/agent/package.json`
- Creates a PR with dependency bumps
- On merge, a GitHub Actions workflow:
  - Inserts a new row into `container_rebuild_triggers` (if not exists)
  - Triggers a Cloud Build job (Google Cloud Build)
  - Inserts a `pending` row into `container_rebuild_jobs`

### 2. Cloud Build
- Builds the new container image
- Pushes to registry with a new tag
- Updates the `container_rebuild_jobs` row with status `success`, new tag, and digest
- Triggers a Kubernetes rollout (canary or rolling, based on settings)

### 3. Lore Agent (startup)
- Queries `container_images.latest_tag` and `container_rollout_tracking.current_tag`
- Spawns Claude Code using the current image tag
- After execution, logs image usage to observability

### 4. Scheduled Job
- Daily or weekly: queries `container_rebuild_triggers` with type `schedule`
- Checks `container_dependencies` for `update_available = true`
- Creates a new `container_rebuild_jobs` row if updates exist and trigger is enabled

---

## Notes

1. **Cost Tracking**: `container_rebuild_jobs.build_cost_usd` allows tracking build infrastructure costs. Can be populated from Cloud Build logs or billing API.

2. **Rollout Safety**: `container_rollout_tracking.rollout_status` allows gradual rollouts (canary → rolling). If a rebuild fails health checks in staging, set to `paused` and alert on-call.

3. **Audit Trail**: `container_rebuild_jobs` provides full history of why an image was rebuilt, what changed, and when. Useful for debugging container behavior changes.

4. **Flexibility**: `trigger_config` (JSONB) allows new trigger types (e.g., "security-advisory") without schema changes.
# Data Model Changes

## New Tables

### `container_image_dependencies`
Tracks dependencies for Claude headless mode container images that require rebuilding.

| Field | Type | Constraints | Notes |
|-------|------|-----------|-------|
| `id` | UUID | PRIMARY KEY | |
| `repo_id` | UUID | FOREIGN KEY → `repos.id` | The repo using this container image |
| `image_name` | VARCHAR | NOT NULL, UNIQUE per repo | e.g., `claude-headless-worker` |
| `image_tag` | VARCHAR | NOT NULL | Current tag/version |
| `container_registry` | VARCHAR | NOT NULL | Registry URL (e.g., `gcr.io/re-cinq/...`) |
| `dockerfile_path` | VARCHAR | NOT NULL | Path to Dockerfile in repo |
| `base_image` | VARCHAR | | Base image used (e.g., `node:20-alpine`), NULL if not tracked |
| `last_built_at` | TIMESTAMP | | When image was last successfully built |
| `last_checked_at` | TIMESTAMP | | When dependencies were last checked for updates |
| `rebuild_trigger_mode` | VARCHAR | NOT NULL | `renovate`, `manual`, `webhook` |
| `created_at` | TIMESTAMP | DEFAULT NOW() | |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | |

### `container_dependencies`
Individual dependencies of a container image (Claude version, npm packages, system packages, etc).

| Field | Type | Constraints | Notes |
|-------|------|-----------|-------|
| `id` | UUID | PRIMARY KEY | |
| `image_id` | UUID | FOREIGN KEY → `container_image_dependencies.id` | |
| `dependency_type` | VARCHAR | NOT NULL | `claude-sdk`, `npm`, `python`, `system`, `apt`, `docker-base` |
| `dependency_name` | VARCHAR | NOT NULL | e.g., `@anthropic-ai/sdk`, `node` |
| `current_version` | VARCHAR | | Current pinned version |
| `latest_version` | VARCHAR | | Latest available version (from registry) |
| `version_constraint` | VARCHAR | | e.g., `^3.0.0`, `~1.2`, `latest` |
| `needs_update` | BOOLEAN | DEFAULT FALSE | Whether an update is available |
| `security_vulnerability` | BOOLEAN | DEFAULT FALSE | Known CVE or security issue |
| `last_checked_at` | TIMESTAMP | | When this dependency was last checked |
| `created_at` | TIMESTAMP | DEFAULT NOW() | |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | |

**Unique constraint:** `(image_id, dependency_type, dependency_name)`

### `container_rebuild_jobs`
Tracks rebuild jobs triggered by dependency updates.

| Field | Type | Constraints | Notes |
|-------|------|-----------|-------|
| `id` | UUID | PRIMARY KEY | |
| `image_id` | UUID | FOREIGN KEY → `container_image_dependencies.id` | |
| `job_type` | VARCHAR | NOT NULL | `check-updates`, `rebuild`, `deploy` |
| `trigger_reason` | VARCHAR | NOT NULL | `claude-version-update`, `npm-update`, `security-fix`, `manual` |
| `triggered_by_dependency_id` | UUID | FOREIGN KEY → `container_dependencies.id` | Which dependency triggered the rebuild |
| `status` | VARCHAR | NOT NULL | `pending`, `in-progress`, `succeeded`, `failed`, `cancelled` |
| `github_pr_url` | VARCHAR | | PR created for the rebuild (if applicable) |
| `github_branch` | VARCHAR | | Branch name for the rebuild PR |
| `build_log_url` | VARCHAR | | Link to build logs (Cloud Build, GitHub Actions, etc) |
| `new_image_tag` | VARCHAR | | New image tag produced by successful rebuild |
| `completed_at` | TIMESTAMP | | When job finished |
| `error_message` | TEXT | | If status=failed, the error details |
| `created_at` | TIMESTAMP | DEFAULT NOW() | |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | |

## Relationship Changes

### Existing `repos` table
Add optional columns to support container image tracking:

| Field | Type | Constraints | Notes |
|-------|------|-----------|-------|
| `has_container_images` | BOOLEAN | DEFAULT FALSE | Whether this repo uses Claude headless containers |
| `container_registry_config` | JSONB | | Registry credentials config (K8s secret name, etc) |

### Existing `pipeline` table
Add column for container-related tasks:

| Field | Type | Constraints | Notes |
|-------|------|-----------|-------|
| `image_id` | UUID | FOREIGN KEY → `container_image_dependencies.id` (nullable) | If task is related to a container image rebuild |

## Migration Notes

1. Create tables in `agent` schema (alongside `pipeline`, `repos`, etc)
2. Add indexes on:
   - `container_image_dependencies(repo_id)`
   - `container_dependencies(image_id, needs_update)`
   - `container_rebuild_jobs(image_id, status)`
   - `container_rebuild_jobs(triggered_by_dependency_id)`
3. Add trigger to update `updated_at` on all three new tables
4. Scheduled job (runs hourly): scan `container_dependencies` where `needs_update=true` or `security_vulnerability=true` and create matching `pipeline` tasks for rebuild
5. New MCP tools:
   - `register_container_image(repo_id, image_name, dockerfile_path, rebuild_trigger_mode)`
   - `get_container_status(image_id)` — current versions, what needs updating
   - `trigger_container_rebuild(image_id, reason)` — manually trigger rebuild
   - `list_container_updates()` — across all repos, what images need rebuilding
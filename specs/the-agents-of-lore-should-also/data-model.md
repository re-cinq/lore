# Data Model Changes for Autonomous Agent Hooks

## Tables

### `agent_hooks`
Stores hook configurations for agents to integrate with Claude Code execution environment.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PRIMARY KEY | |
| `agent_id` | UUID | NOT NULL, FK→agents.id | Agent this hook belongs to |
| `hook_type` | VARCHAR(50) | NOT NULL | session_start, session_end, pre_action, post_action, error_handler |
| `name` | VARCHAR(255) | NOT NULL | Human-readable hook name |
| `description` | TEXT | | What this hook does |
| `enabled` | BOOLEAN | DEFAULT true | Whether hook is active |
| `execution_mode` | VARCHAR(50) | NOT NULL | direct (Haiku API), deferred (LoreTask Job), async (fire-and-forget) |
| `priority` | INTEGER | DEFAULT 0 | Hook execution order (0=first). Higher priority runs later |
| `config` | JSONB | | Hook-specific configuration (e.g., memory keys to check, graph queries) |
| `max_retries` | INTEGER | DEFAULT 2 | Retry count on failure |
| `timeout_seconds` | INTEGER | DEFAULT 30 | Max execution time before timeout |
| `created_at` | TIMESTAMP | DEFAULT NOW() | |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | |

### `hook_executions`
Audit log of hook executions for debugging and learning.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PRIMARY KEY | |
| `hook_id` | UUID | NOT NULL, FK→agent_hooks.id | |
| `session_id` | VARCHAR(255) | NOT NULL | Claude Code session ID |
| `started_at` | TIMESTAMP | DEFAULT NOW() | |
| `completed_at` | TIMESTAMP | | NULL until execution finishes |
| `status` | VARCHAR(50) | NOT NULL | pending, running, success, failed, timeout |
| `input_context` | JSONB | | State passed to hook |
| `output_result` | JSONB | | Returned by hook |
| `error_message` | TEXT | | Failure reason |
| `duration_ms` | INTEGER | | Execution duration |
| `retry_count` | INTEGER | DEFAULT 0 | Number of retries attempted |
| `log_url` | VARCHAR(512) | | Link to Job logs if deferred execution |

### `agent_entry_points`
Defines multiple entry points for agent activation (not just MCP server).

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PRIMARY KEY | |
| `agent_id` | UUID | NOT NULL, FK→agents.id | |
| `entry_point_type` | VARCHAR(50) | NOT NULL | mcp_tool, github_webhook, github_issue_label, scheduled_job, api_endpoint, cli_command |
| `name` | VARCHAR(255) | NOT NULL | Human-readable name |
| `enabled` | BOOLEAN | DEFAULT true | |
| `trigger_condition` | JSONB | | Conditions that activate this entry point (e.g., label filter, schedule) |
| `target_task_type` | VARCHAR(50) | NOT NULL | Refs task_types.name (e.g., implementation, review, runbook) |
| `context_template` | VARCHAR(100) | | Template from context-assembly YAML (default, implementation, review, research) |
| `config` | JSONB | | Entry-point-specific config |
| `created_at` | TIMESTAMP | DEFAULT NOW() | |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | |

### `agent_self_learning`
Tracks agent improvements via self-learning loops.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PRIMARY KEY | |
| `agent_id` | UUID | NOT NULL, FK→agents.id | |
| `learning_type` | VARCHAR(50) | NOT NULL | prompt_refinement, memory_fact, convention_update, graph_entity, error_pattern |
| `source_task_id` | UUID | | Task that triggered learning |
| `source_episode_id` | UUID | | Episode from write_episode or hook execution |
| `previous_value` | JSONB | | Old state (for refinements) |
| `new_value` | JSONB | NOT NULL | Updated state |
| `confidence_score` | DECIMAL(3,2) | DEFAULT 0.5 | How confident agent is in this learning (0.0-1.0) |
| `validated_by` | VARCHAR(50) | | human_review, consistency_check, multi_agent_agreement |
| `created_at` | TIMESTAMP | DEFAULT NOW() | |
| `applied_at` | TIMESTAMP | | When learning was applied to active agent |

### `agent_instrumentation`
Tracks which hooks/entry points are instrumented in each repo's Claude Code environment.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PRIMARY KEY | |
| `repo_id` | UUID | NOT NULL, FK→repos.id | |
| `agent_id` | UUID | NOT NULL, FK→agents.id | |
| `installed_hooks` | TEXT[] | | JSON paths of installed hooks |
| `installed_entry_points` | TEXT[] | | Installed entry point types |
| `installation_status` | VARCHAR(50) | DEFAULT pending | pending, installed, failed, outdated |
| `last_sync_at` | TIMESTAMP | | Last hook/entry-point sync from GKE |
| `next_sync_at` | TIMESTAMP | | When to re-sync |
| `config_hash` | VARCHAR(64) | | SHA256 of installed hook config (detect drift) |
| `created_at` | TIMESTAMP | DEFAULT NOW() | |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | |

### `agent_routing_rules` (new)
Routes incoming requests (from GitHub, API, CLI) to the right agent based on rules.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PRIMARY KEY | |
| `name` | VARCHAR(255) | NOT NULL, UNIQUE | Rule name |
| `enabled` | BOOLEAN | DEFAULT true | |
| `match_condition` | JSONB | NOT NULL | Condition on issue/task (e.g., labels, assignee, repo pattern) |
| `target_agent_id` | UUID | NOT NULL, FK→agents.id | Which agent handles this |
| `priority` | INTEGER | DEFAULT 0 | Higher priority matches first |
| `created_at` | TIMESTAMP | DEFAULT NOW() | |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | |

## Relationships

- `agent_hooks.agent_id` → `agents.id` (one-to-many)
- `agent_entry_points.agent_id` → `agents.id` (one-to-many)
- `agent_self_learning.agent_id` → `agents.id` (one-to-many)
- `agent_self_learning.source_task_id` → `pipeline.tasks.id` (optional)
- `agent_self_learning.source_episode_id` → `memory.episodes.id` (optional)
- `agent_instrumentation.repo_id` → `repos.id` (many-to-one)
- `agent_instrumentation.agent_id` → `agents.id` (many-to-one)
- `hook_executions.hook_id` → `agent_hooks.id` (one-to-many)
- `agent_routing_rules.target_agent_id` → `agents.id` (many-to-one)

## Migration Notes

1. **Create agents table first** (if it doesn't exist):
   ```sql
   CREATE TABLE IF NOT EXISTS agents (
     id UUID PRIMARY KEY,
     name VARCHAR(255) NOT NULL,
     team_id UUID NOT NULL,
     created_at TIMESTAMP DEFAULT NOW()
   );
   ```

2. **Add these tables in order**:
   - `agent_hooks` — hook definitions
   - `agent_entry_points` — entry point definitions
   - `agent_routing_rules` — routing rules
   - `hook_executions` — execution audit log
   - `agent_self_learning` — self-learning outcomes
   - `agent_instrumentation` — repo-level hook state

3. **Indexes**:
   ```sql
   CREATE INDEX idx_agent_hooks_agent_id ON agent_hooks(agent_id);
   CREATE INDEX idx_agent_entry_points_agent_id ON agent_entry_points(agent_id);
   CREATE INDEX idx_hook_executions_hook_id ON hook_executions(hook_id);
   CREATE INDEX idx_hook_executions_session_id ON hook_executions(session_id);
   CREATE INDEX idx_agent_self_learning_agent_id ON agent_self_learning(agent_id);
   CREATE INDEX idx_agent_instrumentation_repo_id ON agent_instrumentation(repo_id);
   CREATE INDEX idx_agent_routing_rules_priority ON agent_routing_rules(priority DESC);
   ```

4. **No breaking changes** — these are additive tables. Existing pipeline tasks, memory, and context remain unchanged.

5. **Feature gates**:
   - Hooks disabled by default (`enabled=false`)
   - Entry points off until explicitly enabled
   - Self-learning writes only after human validation
   - Instrumentation tracks install status separately from activation
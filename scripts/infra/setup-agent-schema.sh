#!/usr/bin/env bash
set -euo pipefail

NS="${LORE_DB_NS:-lore-db}"
POD="${LORE_DB_POD:-lore-db-1}"

echo "[lore] Creating agent schema tables..."

kubectl exec -n "$NS" "$POD" -- psql -U postgres -d lore -c "
  -- LLM call log for cost tracking
  CREATE TABLE IF NOT EXISTS pipeline.llm_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES pipeline.tasks(id),
    job_name TEXT,
    model TEXT NOT NULL,
    input_tokens INT NOT NULL,
    output_tokens INT NOT NULL,
    cost_usd NUMERIC(10,6) NOT NULL,
    duration_ms INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_llm_calls_task ON pipeline.llm_calls(task_id);
  CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON pipeline.llm_calls(created_at);
  CREATE INDEX IF NOT EXISTS idx_llm_calls_job ON pipeline.llm_calls(job_name);

  -- Scheduled job run history
  CREATE TABLE IF NOT EXISTS pipeline.job_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running',
    result_summary TEXT,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_job_runs_name ON pipeline.job_runs(job_name, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_job_runs_status ON pipeline.job_runs(status);

  -- Issue sync columns
  ALTER TABLE pipeline.tasks ADD COLUMN IF NOT EXISTS issue_number INT;
  ALTER TABLE pipeline.tasks ADD COLUMN IF NOT EXISTS issue_url TEXT;
  ALTER TABLE pipeline.tasks ADD COLUMN IF NOT EXISTS actor TEXT;
"

echo "[lore] Agent schema tables ready."

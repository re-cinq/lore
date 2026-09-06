export const TOTALS_SQL = `SELECT count(*)::int AS calls, coalesce(sum(cost_usd), 0)::float AS usd,
            coalesce(sum(input_tokens), 0)::float AS input_tokens,
            coalesce(sum(output_tokens), 0)::float AS output_tokens
       FROM pipeline.llm_calls
      WHERE created_at >= $1 AND created_at < $2`;

export const BY_BLUEPRINT_SQL = `SELECT ar.blueprint_name AS blueprint,
            count(DISTINCT ar.id)::int AS runs,
            coalesce(sum(l.cost_usd), 0)::float AS usd
       FROM pipeline.llm_calls l
       JOIN pipeline.assembly_runs ar ON ar.id = l.assembly_line_id
      WHERE l.created_at >= $1 AND l.created_at < $2
      GROUP BY 1 ORDER BY 3 DESC`;

export const BY_REPO_SQL = `SELECT ar.repo, coalesce(sum(l.cost_usd), 0)::float AS usd
       FROM pipeline.llm_calls l
       JOIN pipeline.assembly_runs ar ON ar.id = l.assembly_line_id
      WHERE l.created_at >= $1 AND l.created_at < $2
      GROUP BY 1 ORDER BY 2 DESC`;

export const BY_MODEL_SQL = `SELECT model, COUNT(*)::int AS calls, SUM(cost_usd)::float8 AS cost_usd,
            SUM(input_tokens)::float8 AS input_tokens,
            SUM(output_tokens)::float8 AS output_tokens
       FROM pipeline.llm_calls
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY model ORDER BY cost_usd DESC`;

export const BY_KIND_SQL = `SELECT
       CASE
         WHEN task_id IS NULL AND assembly_line_id IS NOT NULL
           THEN 'Code review / detection line'
         WHEN task_id IS NOT NULL
           THEN 'Task (implementation / spec / general)'
         WHEN job_name IN ('fact-extraction','graph-extraction','consolidation','auto-curation')
           THEN 'Memory & curation'
         ELSE COALESCE(NULLIF(job_name, ''), 'other')
       END AS kind,
       COUNT(*)::int AS calls, SUM(cost_usd)::float8 AS cost_usd
       FROM pipeline.llm_calls
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY 1 ORDER BY cost_usd DESC`;

export const DAILY_SQL = `SELECT created_at::date::text AS bucket_date, COUNT(*)::int AS calls,
            SUM(cost_usd)::float8 AS cost_usd
       FROM pipeline.llm_calls
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY 1 ORDER BY 1 DESC`;

export const BY_TASK_TYPE_SQL = `SELECT t.task_type, COUNT(DISTINCT t.id)::int AS tasks,
            SUM(lc.cost_usd)::float8 AS cost_usd
       FROM pipeline.llm_calls lc JOIN pipeline.tasks t ON t.id = lc.task_id
      WHERE lc.created_at >= $1 AND lc.created_at < $2
      GROUP BY t.task_type ORDER BY cost_usd DESC`;

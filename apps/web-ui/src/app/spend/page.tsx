export const dynamic = "force-dynamic";
import { query, queryOne, queryAllowMissing } from "@/lib/db";
import SpendView, {
  type OrgMtdRow,
  type OrgByModelRow,
  type OrgDailyRow,
  type LoreMtdRow,
  type LoreByModelRow,
  type LoreByKindRow,
  type LoreDailyRow,
  type LoreByRepoRow,
  type LoreByTaskTypeRow,
} from "./SpendView";

const MTD = "created_at >= date_trunc('month', current_date)";

export default async function SpendPage() {
  // Authoritative org-wide spend from Anthropic's Admin Cost/Usage API, cached
  // by the anthropic_cost_sync cron. Optional: queryAllowMissing degrades to []
  // when the table or the admin key is absent, and the view hides these
  // sections. Everything below runs off pipeline.llm_calls with no admin key.
  const orgMtdRow = (
    await queryAllowMissing<OrgMtdRow>(
      `SELECT
         COALESCE(SUM(cost_usd), 0)::float8 AS billed_usd,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         MAX(fetched_at) AS as_of
       FROM pipeline.anthropic_cost_daily
       WHERE bucket_date >= date_trunc('month', current_date)`,
    )
  )[0];
  const orgAvailable = !!orgMtdRow?.as_of;
  const orgMtd: OrgMtdRow = orgMtdRow ?? {
    billed_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    as_of: null,
  };

  const orgByModel = await queryAllowMissing<OrgByModelRow>(
    `SELECT model, SUM(cost_usd)::float8 AS cost_usd,
       SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
     FROM pipeline.anthropic_cost_daily
     WHERE bucket_date >= date_trunc('month', current_date)
     GROUP BY model ORDER BY cost_usd DESC`,
  );

  const orgDaily = await queryAllowMissing<OrgDailyRow>(
    `SELECT bucket_date, SUM(cost_usd)::float8 AS cost_usd
     FROM pipeline.anthropic_cost_daily
     WHERE bucket_date >= date_trunc('month', current_date)
     GROUP BY bucket_date ORDER BY bucket_date DESC`,
  );

  // Lore-computed cost (pipeline.llm_calls) — always available, no admin key.
  const loreMtd = (await queryOne<LoreMtdRow>(
    `SELECT
       COALESCE(SUM(cost_usd), 0)::float8 AS computed_usd,
       COUNT(*)::int AS calls,
       COALESCE(SUM(input_tokens), 0) AS input_tokens,
       COALESCE(SUM(output_tokens), 0) AS output_tokens
     FROM pipeline.llm_calls WHERE ${MTD}`,
  )) ?? { computed_usd: 0, calls: 0, input_tokens: 0, output_tokens: 0 };

  const loreByModel = await query<LoreByModelRow>(
    `SELECT model, COUNT(*)::int AS calls, SUM(cost_usd)::float8 AS cost_usd,
       SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
     FROM pipeline.llm_calls WHERE ${MTD}
     GROUP BY model ORDER BY cost_usd DESC`,
  );

  // Where the money went, categorized — the only view that separates
  // code-review lines (task-less) from tasks from memory/curation jobs.
  const loreByKind = await query<LoreByKindRow>(
    `SELECT
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
     FROM pipeline.llm_calls WHERE ${MTD}
     GROUP BY 1 ORDER BY cost_usd DESC`,
  );

  const loreDaily = await query<LoreDailyRow>(
    `SELECT created_at::date AS bucket_date, COUNT(*)::int AS calls,
       SUM(cost_usd)::float8 AS cost_usd
     FROM pipeline.llm_calls WHERE ${MTD}
     GROUP BY 1 ORDER BY 1 DESC`,
  );

  const loreByRepo = await query<LoreByRepoRow>(
    `SELECT t.target_repo, COUNT(DISTINCT t.id) AS tasks,
       SUM(lc.cost_usd)::float8 AS cost_usd
     FROM pipeline.llm_calls lc JOIN pipeline.tasks t ON t.id = lc.task_id
     WHERE lc.${MTD} AND t.target_repo IS NOT NULL
     GROUP BY t.target_repo ORDER BY cost_usd DESC`,
  );

  const loreByTaskType = await query<LoreByTaskTypeRow>(
    `SELECT t.task_type, COUNT(DISTINCT t.id) AS tasks,
       SUM(lc.cost_usd)::float8 AS cost_usd
     FROM pipeline.llm_calls lc JOIN pipeline.tasks t ON t.id = lc.task_id
     WHERE lc.${MTD}
     GROUP BY t.task_type ORDER BY cost_usd DESC`,
  );

  return (
    <SpendView
      orgMtd={orgMtd}
      orgAvailable={orgAvailable}
      orgByModel={orgByModel}
      orgDaily={orgDaily}
      loreMtd={loreMtd}
      loreByModel={loreByModel}
      loreByKind={loreByKind}
      loreDaily={loreDaily}
      loreByRepo={loreByRepo}
      loreByTaskType={loreByTaskType}
    />
  );
}

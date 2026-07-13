export const dynamic = "force-dynamic";
import { query, queryOne, queryAllowMissing } from "@/lib/db";
import SpendView, {
  type OrgMtdRow,
  type OrgByModelRow,
  type OrgDailyRow,
  type LoreByRepoRow,
  type LoreByTaskTypeRow,
} from "./SpendView";

export default async function SpendPage() {
  // Authoritative org-wide spend from Anthropic's Admin Cost/Usage API,
  // cached by the anthropic_cost_sync cron. queryAllowMissing degrades to []
  // when the migration/table or the admin key is absent.
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
    `SELECT
       model,
       SUM(cost_usd)::float8 AS cost_usd,
       SUM(input_tokens) AS input_tokens,
       SUM(output_tokens) AS output_tokens
     FROM pipeline.anthropic_cost_daily
     WHERE bucket_date >= date_trunc('month', current_date)
     GROUP BY model
     ORDER BY cost_usd DESC`,
  );

  const orgDaily = await queryAllowMissing<OrgDailyRow>(
    `SELECT bucket_date, SUM(cost_usd)::float8 AS cost_usd
     FROM pipeline.anthropic_cost_daily
     WHERE bucket_date >= date_trunc('month', current_date)
     GROUP BY bucket_date
     ORDER BY bucket_date DESC`,
  );

  // Lore's own computed cost (pipeline.llm_calls). The only source that can
  // attribute spend to a repo or task type — Anthropic cannot.
  const loreMtd = await queryOne<{ computed_usd: number }>(
    `SELECT COALESCE(SUM(cost_usd), 0)::float8 AS computed_usd
     FROM pipeline.llm_calls
     WHERE created_at >= date_trunc('month', current_date)`,
  );

  const loreByRepo = await query<LoreByRepoRow>(
    `SELECT
       t.target_repo,
       COUNT(DISTINCT t.id) AS tasks,
       SUM(lc.cost_usd)::float8 AS cost_usd
     FROM pipeline.llm_calls lc
     JOIN pipeline.tasks t ON t.id = lc.task_id
     WHERE lc.created_at >= date_trunc('month', current_date)
       AND t.target_repo IS NOT NULL
     GROUP BY t.target_repo
     ORDER BY cost_usd DESC`,
  );

  const loreByTaskType = await query<LoreByTaskTypeRow>(
    `SELECT
       t.task_type,
       COUNT(DISTINCT t.id) AS tasks,
       SUM(lc.cost_usd)::float8 AS cost_usd
     FROM pipeline.llm_calls lc
     JOIN pipeline.tasks t ON t.id = lc.task_id
     WHERE lc.created_at >= date_trunc('month', current_date)
     GROUP BY t.task_type
     ORDER BY cost_usd DESC`,
  );

  return (
    <SpendView
      orgMtd={orgMtd}
      orgAvailable={orgAvailable}
      orgByModel={orgByModel}
      orgDaily={orgDaily}
      loreComputedUsd={loreMtd?.computed_usd ?? 0}
      loreByRepo={loreByRepo}
      loreByTaskType={loreByTaskType}
    />
  );
}

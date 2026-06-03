export const dynamic = "force-dynamic";
import { query, queryOne, queryAllowMissing } from '@/lib/db';

interface OrgMtd {
  billed_usd: number;
  input_tokens: number;
  output_tokens: number;
  as_of: string | null;
}

interface OrgByModel {
  model: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

interface OrgDaily {
  bucket_date: string;
  cost_usd: number;
}

interface LoreByRepo {
  target_repo: string;
  tasks: number;
  cost_usd: number;
}

interface LoreByTaskType {
  task_type: string;
  tasks: number;
  cost_usd: number;
}

const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD' });

export default async function SpendPage() {
  // Authoritative org-wide spend from Anthropic's Admin Cost/Usage API,
  // cached by the anthropic_cost_sync cron. queryAllowMissing degrades to []
  // when the migration/table or the admin key is absent.
  const orgMtd = (
    await queryAllowMissing<OrgMtd>(
      `SELECT
         COALESCE(SUM(cost_usd), 0)::float8 AS billed_usd,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         MAX(fetched_at) AS as_of
       FROM pipeline.anthropic_cost_daily
       WHERE bucket_date >= date_trunc('month', current_date)`
    )
  )[0];
  const orgAvailable = !!orgMtd?.as_of;

  const orgByModel = await queryAllowMissing<OrgByModel>(
    `SELECT
       model,
       SUM(cost_usd)::float8 AS cost_usd,
       SUM(input_tokens) AS input_tokens,
       SUM(output_tokens) AS output_tokens
     FROM pipeline.anthropic_cost_daily
     WHERE bucket_date >= date_trunc('month', current_date)
     GROUP BY model
     ORDER BY cost_usd DESC`
  );

  const orgDaily = await queryAllowMissing<OrgDaily>(
    `SELECT bucket_date, SUM(cost_usd)::float8 AS cost_usd
     FROM pipeline.anthropic_cost_daily
     WHERE bucket_date >= date_trunc('month', current_date)
     GROUP BY bucket_date
     ORDER BY bucket_date DESC`
  );

  // Lore's own computed cost (pipeline.llm_calls). The only source that can
  // attribute spend to a repo or task type — Anthropic cannot.
  const loreMtd = await queryOne<{ computed_usd: number }>(
    `SELECT COALESCE(SUM(cost_usd), 0)::float8 AS computed_usd
     FROM pipeline.llm_calls
     WHERE created_at >= date_trunc('month', current_date)`
  );

  const loreByRepo = await query<LoreByRepo>(
    `SELECT
       t.target_repo,
       COUNT(DISTINCT t.id) AS tasks,
       SUM(lc.cost_usd)::float8 AS cost_usd
     FROM pipeline.llm_calls lc
     JOIN pipeline.tasks t ON t.id = lc.task_id
     WHERE lc.created_at >= date_trunc('month', current_date)
       AND t.target_repo IS NOT NULL
     GROUP BY t.target_repo
     ORDER BY cost_usd DESC`
  );

  const loreByTaskType = await query<LoreByTaskType>(
    `SELECT
       t.task_type,
       COUNT(DISTINCT t.id) AS tasks,
       SUM(lc.cost_usd)::float8 AS cost_usd
     FROM pipeline.llm_calls lc
     JOIN pipeline.tasks t ON t.id = lc.task_id
     WHERE lc.created_at >= date_trunc('month', current_date)
     GROUP BY t.task_type
     ORDER BY cost_usd DESC`
  );

  return (
    <div>
      <h1>Claude API Spend</h1>

      {/* Month-to-date totals */}
      <h2>Month to Date</h2>
      <div style={{display:'flex', gap:'16px', marginBottom:'24px', flexWrap:'wrap'}}>
        <div className="spec-card" style={{flex:1, minWidth:'180px'}}>
          <div className="meta">Billed cost (Anthropic)</div>
          <div style={{fontSize:'var(--fs-xl)', fontWeight:'bold'}}>
            {orgAvailable ? usd(orgMtd.billed_usd) : '—'}
          </div>
          <div className="meta" style={{fontSize:'var(--fs-xs)'}}>
            {orgAvailable
              ? `as of ${new Date(orgMtd.as_of as string).toLocaleString()}`
              : 'admin key not configured'}
          </div>
        </div>
        <div className="spec-card" style={{flex:1, minWidth:'180px'}}>
          <div className="meta">Lore-computed cost</div>
          <div style={{fontSize:'var(--fs-xl)', fontWeight:'bold', color:'var(--info)'}}>
            {usd(loreMtd?.computed_usd ?? 0)}
          </div>
          <div className="meta" style={{fontSize:'var(--fs-xs)'}}>estimate from token counts</div>
        </div>
        <div className="spec-card" style={{flex:1, minWidth:'180px'}}>
          <div className="meta">Input Tokens</div>
          <div style={{fontSize:'var(--fs-xl)', fontWeight:'bold'}}>
            {orgAvailable ? Number(orgMtd.input_tokens).toLocaleString() : '—'}
          </div>
        </div>
        <div className="spec-card" style={{flex:1, minWidth:'180px'}}>
          <div className="meta">Output Tokens</div>
          <div style={{fontSize:'var(--fs-xl)', fontWeight:'bold'}}>
            {orgAvailable ? Number(orgMtd.output_tokens).toLocaleString() : '—'}
          </div>
        </div>
      </div>

      {!orgAvailable && (
        <div className="spec-card" style={{marginBottom:'24px', borderColor:'var(--warning)'}}>
          <strong>Org-wide billed cost unavailable.</strong>
          <div className="meta" style={{marginTop:'4px'}}>
            Set <code>ANTHROPIC_ADMIN_KEY</code> (an <code>sk-ant-admin…</code> key) on the
            agent so the daily <code>anthropic-cost-sync</code> cron can pull Anthropic&apos;s
            authoritative Cost report. Showing Lore-computed estimates only.
          </div>
        </div>
      )}

      {/* Authoritative breakdowns */}
      <h2>Billed Cost by Model (MTD)</h2>
      <table>
        <thead>
          <tr><th>Model</th><th>Billed Cost</th><th>Input Tokens</th><th>Output Tokens</th></tr>
        </thead>
        <tbody>
          {orgByModel.map(r => (
            <tr key={r.model || '(non-token)'}>
              <td><span className="badge">{r.model || '(non-token)'}</span></td>
              <td>{usd(r.cost_usd)}</td>
              <td style={{fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)'}}>{Number(r.input_tokens).toLocaleString()}</td>
              <td style={{fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)'}}>{Number(r.output_tokens).toLocaleString()}</td>
            </tr>
          ))}
          {orgByModel.length === 0 && <tr><td colSpan={4} className="meta" style={{textAlign:'center'}}>No billed data yet</td></tr>}
        </tbody>
      </table>

      <h2>Daily Billed Cost (This Month)</h2>
      <table>
        <thead><tr><th>Date</th><th>Billed Cost</th></tr></thead>
        <tbody>
          {orgDaily.map(r => (
            <tr key={r.bucket_date}>
              <td>{new Date(r.bucket_date).toLocaleDateString()}</td>
              <td>{usd(r.cost_usd)}</td>
            </tr>
          ))}
          {orgDaily.length === 0 && <tr><td colSpan={2} className="meta" style={{textAlign:'center'}}>No billed data yet</td></tr>}
        </tbody>
      </table>

      {/* Lore-attributed breakdowns */}
      <h2>Lore-Computed Cost by Repo (MTD)</h2>
      <table>
        <thead><tr><th>Repo</th><th>Tasks</th><th>Cost</th></tr></thead>
        <tbody>
          {loreByRepo.map(r => (
            <tr key={r.target_repo}>
              <td style={{fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)'}}>{r.target_repo}</td>
              <td>{Number(r.tasks).toLocaleString()}</td>
              <td>{usd(r.cost_usd)}</td>
            </tr>
          ))}
          {loreByRepo.length === 0 && <tr><td colSpan={3} className="meta" style={{textAlign:'center'}}>No data</td></tr>}
        </tbody>
      </table>

      <h2>Lore-Computed Cost by Task Type (MTD)</h2>
      <table>
        <thead><tr><th>Task Type</th><th>Tasks</th><th>Cost</th></tr></thead>
        <tbody>
          {loreByTaskType.map(r => (
            <tr key={r.task_type}>
              <td><span className="badge">{r.task_type}</span></td>
              <td>{Number(r.tasks).toLocaleString()}</td>
              <td>{usd(r.cost_usd)}</td>
            </tr>
          ))}
          {loreByTaskType.length === 0 && <tr><td colSpan={3} className="meta" style={{textAlign:'center'}}>No data</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export interface OrgMtdRow {
  billed_usd: number;
  input_tokens: number;
  output_tokens: number;
  as_of: string | null;
}

export interface OrgByModelRow {
  model: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

export interface OrgDailyRow {
  bucket_date: string;
  cost_usd: number;
}

export interface LoreByRepoRow {
  target_repo: string;
  tasks: number;
  cost_usd: number;
}

export interface LoreByTaskTypeRow {
  task_type: string;
  tasks: number;
  cost_usd: number;
}

export interface SpendViewProps {
  orgMtd: OrgMtdRow;
  orgAvailable: boolean;
  orgByModel: OrgByModelRow[];
  orgDaily: OrgDailyRow[];
  loreComputedUsd: number;
  loreByRepo: LoreByRepoRow[];
  loreByTaskType: LoreByTaskTypeRow[];
}

const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD' });

export default function SpendView({
  orgMtd,
  orgAvailable,
  orgByModel,
  orgDaily,
  loreComputedUsd,
  loreByRepo,
  loreByTaskType,
}: SpendViewProps) {
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
            {usd(loreComputedUsd)}
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

export const dynamic = "force-dynamic";
import { query, queryOne } from '@/lib/db';
import { revalidatePath } from 'next/cache';

async function saveSettings(formData: FormData) {
  'use server';
  const entries = [
    { key: 'api_url', value: formData.get('api_url') as string },
    { key: 'ingest_token', value: formData.get('ingest_token') as string },
  ];
  for (const { key, value } of entries) {
    if (value?.trim()) {
      await query(
        `INSERT INTO lore.settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [key, value.trim()]
      );
    }
  }
  revalidatePath('/settings');
}

async function regenerateToken() {
  'use server';
  const crypto = await import('crypto');
  const newToken = crypto.randomBytes(32).toString('hex');
  await query(
    `INSERT INTO lore.settings (key, value) VALUES ('ingest_token', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [newToken]
  );
  revalidatePath('/settings');
}

export default async function SettingsPage() {
  const settings = await query<{ key: string; value: string; updated_at: string }>(
    `SELECT key, value, updated_at FROM lore.settings ORDER BY key`
  );
  const settingsMap: Record<string, string> = {};
  for (const s of settings) settingsMap[s.key] = s.value;

  const repoCount = await queryOne<{ count: number }>(
    `SELECT count(*)::int as count FROM lore.repos`
  );

  const taskStats = await queryOne<{ total: number; today: number }>(
    `SELECT count(*)::int as total,
            count(*) FILTER (WHERE created_at > current_date)::int as today
     FROM pipeline.tasks`
  );

  return (
    <div>
      <h1>Settings</h1>

      <div style={{display:'flex', gap:'16px', marginBottom:'24px'}}>
        <div className="spec-card" style={{flex:1}}>
          <div className="meta">Onboarded Repos</div>
          <div style={{fontSize:'24px', fontWeight:600}}>{repoCount?.count ?? 0}</div>
        </div>
        <div className="spec-card" style={{flex:1}}>
          <div className="meta">Total Tasks</div>
          <div style={{fontSize:'24px', fontWeight:600}}>{taskStats?.total ?? 0}</div>
        </div>
        <div className="spec-card" style={{flex:1}}>
          <div className="meta">Tasks Today</div>
          <div style={{fontSize:'24px', fontWeight:600}}>{taskStats?.today ?? 0}</div>
        </div>
      </div>

      <h2>Platform Configuration</h2>
      <form action={saveSettings} className="task-form" style={{maxWidth:'600px'}}>
        <label>Lore API URL</label>
        <input name="api_url" defaultValue={settingsMap.api_url || ''} placeholder="https://lore-api.gcp.re-cinq.com" />
        <p className="meta" style={{fontSize:'12px', marginTop:'2px'}}>
          The external URL for the MCP server API. Used by GitHub Actions workflows and local Claude Code for task delegation.
        </p>

        <label style={{marginTop:'16px'}}>Ingest Token</label>
        <input name="ingest_token" defaultValue={settingsMap.ingest_token || ''} style={{fontFamily:'monospace', fontSize:'12px'}} />
        <p className="meta" style={{fontSize:'12px', marginTop:'2px'}}>
          Shared token for authenticating ingest and task API calls. Set this in developer installs via <code>git config --global lore.ingest-token</code> and on repos as the <code>LORE_INGEST_TOKEN</code> GitHub Actions secret.
        </p>

        <div style={{display:'flex', gap:'8px', marginTop:'16px'}}>
          <button type="submit">Save</button>
        </div>
      </form>

      <form action={regenerateToken} style={{marginTop:'8px'}}>
        <button type="submit" style={{background:'#dc2626', fontSize:'12px', padding:'6px 12px'}}>Regenerate Token</button>
        <span className="meta" style={{marginLeft:'8px', fontSize:'12px'}}>Warning: invalidates all existing tokens. You&apos;ll need to update all repos and developer installs.</span>
      </form>

      <h2 style={{marginTop:'32px'}}>Developer Install Command</h2>
      <div className="spec-card">
        <pre style={{margin:0, fontSize:'13px', overflowX:'auto'}}>{`git clone git@github.com:re-cinq/lore.git
cd lore && scripts/install.sh

# After install, set the token:
git config --global lore.ingest-token ${settingsMap.ingest_token || '<token>'}
git config --global lore.api-url ${settingsMap.api_url || 'https://lore-api.gcp.re-cinq.com'}`}</pre>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
import { query, queryOne } from '@/lib/db';
import { revalidatePath } from 'next/cache';

interface Repo { full_name: string }

async function saveSettings(formData: FormData) {
  'use server';
  const fullName = formData.get('full_name') as string;
  const team = formData.get('team') as string;

  // Parse selected cross-repo repos
  const selectedRepos = formData.getAll('cross_repo_repos') as string[];

  // Merge new values into existing settings (never overwrite unrelated keys)
  const updates: Record<string, any> = {
    task_types: (formData.get('task_types') as string || '').split(',').map(s => s.trim()).filter(Boolean),
    auto_review: formData.get('auto_review') === 'on',
    cross_repo: selectedRepos.length > 0,
    cross_repo_repos: selectedRepos,
    slack_channel_id: (formData.get('slack_channel_id') as string || '').trim() || undefined,
    dispatch_label: (formData.get('dispatch_label') as string || '').trim() || undefined,
  };

  // Parse trust level
  const trustLevel = formData.get('trust_level') as string;
  if (trustLevel) {
    updates.trust = { level: trustLevel, auto_promote_threshold: 3 };
  }

  // Remove undefined keys
  for (const k of Object.keys(updates)) {
    if (updates[k] === undefined) delete updates[k];
  }

  await query(
    `UPDATE lore.repos SET team = $1, settings = COALESCE(settings, '{}') || $2::jsonb WHERE full_name = $3`,
    [team || null, JSON.stringify(updates), fullName]
  );

  // Update linked repos: add this repo to their cross_repo_repos if not already there
  for (const linkedRepo of selectedRepos) {
    await query(
      `UPDATE lore.repos
       SET settings = jsonb_set(
         jsonb_set(COALESCE(settings, '{}'), '{cross_repo}', 'true'),
         '{cross_repo_repos}',
         (SELECT COALESCE(jsonb_agg(DISTINCT val), '[]') FROM (
           SELECT val FROM jsonb_array_elements_text(COALESCE(settings->'cross_repo_repos', '[]')) val
           UNION SELECT $1
         ) sub)
       )
       WHERE full_name = $2`,
      [fullName, linkedRepo],
    );
  }

  revalidatePath(`/repos/${fullName}/settings`);
}

export default async function RepoSettings({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const repoData = await queryOne(`SELECT * FROM lore.repos WHERE full_name = $1`, [fullName]);
  if (!repoData) return <div>Repo not found</div>;
  const settings = (repoData as any).settings || {};

  // Fetch all onboarded repos for the multi-select
  const allRepos = await query<Repo>(
    `SELECT full_name FROM lore.repos WHERE full_name != $1 ORDER BY full_name`, [fullName]
  );
  const selectedRepos: string[] = settings.cross_repo_repos || [];

  return (
    <div>
      <h2>Settings</h2>
      <p className="meta" style={{marginTop:'-6px', marginBottom:'16px'}}>
        Per-repo configuration: team, trust level, task types, auto-review, cross-repo links, and integrations.
      </p>
      <form action={saveSettings} className="task-form" style={{maxWidth:'500px'}}>
        <input type="hidden" name="full_name" value={fullName} />

        <label>Team</label>
        <input name="team" defaultValue={(repoData as any).team || ''} placeholder="e.g. platform, payments" />

        <label>Allowed Task Types (comma-separated)</label>
        <input name="task_types" defaultValue={(settings.task_types || []).join(', ')} placeholder="general, runbook, implementation" />

        <label>Slack Channel ID</label>
        <input name="slack_channel_id" defaultValue={settings.slack_channel_id || ''} placeholder="C0123456789" />

        <label>Dispatch Label</label>
        <input name="dispatch_label" defaultValue={settings.dispatch_label || ''} placeholder="lore (default)" />

        <label>Trust Level</label>
        <select name="trust_level" defaultValue={settings.trust?.level || 'implementation'}>
          <option value="docs">Docs only (gap-fill, runbook)</option>
          <option value="tests">Tests (+ review)</option>
          <option value="implementation">Implementation (default)</option>
          <option value="full">Full (all task types)</option>
        </select>

        <label style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
          <input type="checkbox" name="auto_review" defaultChecked={settings.auto_review === true} />
          Auto-review PRs
        </label>

        <label>Cross-repo context (select repos to include)</label>
        <select name="cross_repo_repos" multiple size={Math.min(allRepos.length, 6)} defaultValue={selectedRepos}
          style={{width:'100%',padding:'0.25rem'}}>
          {allRepos.map((r) => (
            <option key={r.full_name} value={r.full_name}>{r.full_name}</option>
          ))}
        </select>
        <span style={{fontSize:'0.8rem',opacity:0.6}}>Hold Cmd/Ctrl to select multiple. Linked repos will automatically get this repo added to their cross-repo list.</span>

        <button type="submit">Save Settings</button>
      </form>
    </div>
  );
}

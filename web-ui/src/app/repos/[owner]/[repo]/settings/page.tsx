export const dynamic = "force-dynamic";
import { query, queryOne } from '@/lib/db';
import { revalidatePath } from 'next/cache';

async function saveSettings(formData: FormData) {
  'use server';
  const fullName = formData.get('full_name') as string;
  const team = formData.get('team') as string;
  const settings = {
    task_types: (formData.get('task_types') as string || '').split(',').map(s => s.trim()).filter(Boolean),
  };
  await query(
    `UPDATE lore.repos SET team = $1, settings = $2 WHERE full_name = $3`,
    [team || null, JSON.stringify(settings), fullName]
  );
  revalidatePath(`/repos/${fullName}/settings`);
}

export default async function RepoSettings({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const repoData = await queryOne(`SELECT * FROM lore.repos WHERE full_name = $1`, [fullName]);
  if (!repoData) return <div>Repo not found</div>;
  const settings = (repoData as any).settings || {};

  return (
    <div>
      <h2>Settings</h2>
      <form action={saveSettings} className="task-form" style={{maxWidth:'500px'}}>
        <input type="hidden" name="full_name" value={fullName} />
        <label>Team</label>
        <input name="team" defaultValue={(repoData as any).team || ''} placeholder="e.g. platform, payments" />
        <label>Allowed Task Types (comma-separated)</label>
        <input name="task_types" defaultValue={(settings.task_types || []).join(', ')} placeholder="general, runbook, implementation" />
        <button type="submit">Save Settings</button>
      </form>
    </div>
  );
}

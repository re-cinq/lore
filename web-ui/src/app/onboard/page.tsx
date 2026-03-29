export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

async function onboardRepo(formData: FormData) {
  'use server';
  const fullName = formData.get('full_name') as string;
  if (!fullName?.includes('/')) return;

  const [owner, name] = fullName.split('/');

  // Check if already onboarded
  const existing = await query(`SELECT id FROM lore.repos WHERE full_name = $1`, [fullName]);
  if (existing.length > 0) {
    redirect('/');
    return;
  }

  // Insert into repos table
  await query(
    `INSERT INTO lore.repos (owner, name, full_name) VALUES ($1, $2, $3) ON CONFLICT (full_name) DO NOTHING`,
    [owner, name, fullName]
  );

  // Create pipeline task for the onboarding agent
  const task = await query(
    `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by)
     VALUES ($1, 'onboard', $2, 'ui')
     RETURNING id`,
    [fullName, fullName]
  );
  if (task[0]) {
    await query(
      `INSERT INTO pipeline.task_events (task_id, to_status) VALUES ($1, 'pending')`,
      [task[0].id]
    );
  }

  revalidatePath('/');
  redirect('/');
}

export default async function OnboardPage() {
  const onboarded = await query(`SELECT full_name FROM lore.repos`);
  const onboardedSet = new Set(onboarded.map((r: any) => r.full_name));

  return (
    <div>
      <h1>Add Repository</h1>
      <p className="meta">Onboard a repository to Lore. This will create a PR on the target repo with CLAUDE.md, AGENTS.md, PR template, and CI workflows.</p>

      <form action={onboardRepo} className="task-form" style={{maxWidth:'500px', marginTop:'24px'}}>
        <label>Repository (owner/name)</label>
        <input type="text" name="full_name" required placeholder="re-cinq/my-service"
          pattern="[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+"
          title="Format: owner/repo" />
        <p className="meta" style={{fontSize:'12px', marginTop:'4px'}}>
          The GitHub App must have access to this repo.
          {onboarded.length > 0 && ` Already onboarded: ${onboarded.map((r: any) => r.full_name).join(', ')}`}
        </p>
        <button type="submit" style={{marginTop:'12px'}}>Onboard Repository</button>
      </form>
    </div>
  );
}

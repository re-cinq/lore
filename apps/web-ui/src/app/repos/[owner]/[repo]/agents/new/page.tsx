export const dynamic = "force-dynamic";
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { saveAgent } from '@/lib/agents-api';
import { parseAgentForm, saveResultToState, type AgentFormState } from '@/lib/agents-form';
import AgentForm from '../AgentForm';

export default async function NewAgent({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  async function createAction(_prev: AgentFormState, formData: FormData): Promise<AgentFormState> {
    'use server';
    const { name, def, approvalPr } = parseAgentForm(formData);
    if (!name) return { error: 'name required' };
    const r = await saveAgent(fullName, def, false, approvalPr);
    if (r.status === 'ok') redirect(`/repos/${fullName}/agents`);
    return saveResultToState(r);
  }

  return (
    <div>
      <div className="breadcrumb">
        <Link href={`/repos/${fullName}/agents`}>Agents</Link> / <strong>New agent</strong>
      </div>
      <h1>New agent</h1>
      <AgentForm repo={fullName} agent={null} action={createAction} isNew />
    </div>
  );
}

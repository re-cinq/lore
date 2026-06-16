import type { AgentDefinition } from './agents-mirror';
import type { AgentSaveResult } from './agents-api';

// Pure FormData → agent payload parsing shared by the new/edit page server
// actions, plus the save-result → form-state mapping. Kept here (not in the
// coverage-excluded page.tsx) so the branchy bits are unit-tested.

export interface ParsedAgentForm {
  name: string;
  isNew: boolean;
  def: Omit<AgentDefinition, 'project_id'>;
  approvalPr?: string;
}

export function parseAgentForm(fd: FormData): ParsedAgentForm {
  const isNew = fd.get('is_new') === '1';
  const name = (((isNew ? fd.get('name_input') : fd.get('name')) as string) || '').trim();
  const modelSel = (fd.get('model_select') as string) || '';
  const model =
    modelSel === '__custom__'
      ? ((fd.get('model_custom') as string) || '').trim() || null
      : modelSel || null;
  const timeoutRaw = ((fd.get('timeout_minutes') as string) || '').trim();
  return {
    name,
    isNew,
    def: {
      name,
      model,
      timeout_minutes: timeoutRaw ? Number(timeoutRaw) : null,
      prompt: ((fd.get('prompt') as string) || '').trim() || null,
      image: ((fd.get('image') as string) || '').trim() || null,
      execution_mode: (fd.get('execution_mode') as string) || 'claude-code',
      review_required: fd.get('review_required') === '1',
    },
    approvalPr: ((fd.get('approval_pr') as string) || '').trim() || undefined,
  };
}

export interface AgentFormState {
  error?: string;
  twoKey?: boolean;
}

/** Map an agents-api save result to the form state (ok → {} so the page redirects). */
export function saveResultToState(r: AgentSaveResult): AgentFormState {
  if (r.status === 'ok') return {};
  if (r.status === 'two_key_required') return { twoKey: true };
  if (r.status === 'unconfigured') return { error: 'LORE_API_URL / LORE_ADMIN_TOKEN not set' };
  if (r.status === 'codeowners_failed') return { error: r.detail || r.code };
  return { error: r.message };
}

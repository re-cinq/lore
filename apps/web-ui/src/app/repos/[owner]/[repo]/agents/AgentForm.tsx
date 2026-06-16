'use client';
import { useActionState, useState } from 'react';
import { KNOWN_MODELS, type AgentDefinition } from '@/lib/agents-mirror';
import { type AgentFormState } from '@/lib/agents-form';
import styles from './agents.module.css';

export type AgentFormAction = (prev: AgentFormState, fd: FormData) => Promise<AgentFormState>;

const KNOWN_IDS = KNOWN_MODELS.map((m) => m.id);

/**
 * Full-page create/edit form for an agent, shared by /agents/new and
 * /agents/[name]/edit. On success the page's server action redirects back to
 * the list; on error it returns a message. Editing an org agent forks a
 * project agent (the action calls saveAgent with isUpdate, which upserts).
 */
export default function AgentForm({
  repo,
  agent,
  action,
  isNew,
  defaultImage,
}: {
  repo: string;
  agent: AgentDefinition | null;
  action: AgentFormAction;
  isNew: boolean;
  /** The platform default runner image — shown as the image placeholder so the
   *  inherited image is visible without prefilling it as a (gated) value. */
  defaultImage?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const startCustom = !!agent?.model && !KNOWN_IDS.includes(agent.model);
  const [modelSel, setModelSel] = useState(startCustom ? '__custom__' : (agent?.model ?? ''));
  const inherited = !isNew && (agent?.project_id == null || agent.project_id === '');

  return (
    <form action={formAction} className="task-form">
      <input type="hidden" name="repo" value={repo} />
      <input type="hidden" name="is_new" value={isNew ? '1' : '0'} />
      <input type="hidden" name="execution_mode" value={agent?.execution_mode ?? 'claude-code'} />
      <input type="hidden" name="review_required" value={agent?.review_required ? '1' : '0'} />

      {!isNew && (
        <p className={styles.formNote}>
          {inherited
            ? 'These values are inherited from the organisation default. Saving creates a project agent for this repo; later edits update it.'
            : 'This is a project agent for this repo, overriding the organisation default.'}
        </p>
      )}

      <label>Name</label>
      {isNew ? (
        <input name="name_input" placeholder="my-agent" required />
      ) : (
        <>
          <input type="hidden" name="name" value={agent?.name ?? ''} />
          <input value={agent?.name ?? ''} disabled />
        </>
      )}

      <label>Model</label>
      <select name="model_select" value={modelSel} onChange={(e) => setModelSel(e.target.value)}>
        <option value="">(inherit)</option>
        {KNOWN_MODELS.map((m) => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
        <option value="__custom__">Custom…</option>
      </select>
      {modelSel === '__custom__' && (
        <input name="model_custom" defaultValue={startCustom ? (agent?.model ?? '') : ''} placeholder="model id (e.g. claude-opus-4-8)" />
      )}

      <label>Timeout (minutes)</label>
      <input name="timeout_minutes" type="number" min={1} max={1440} defaultValue={agent?.timeout_minutes ?? ''} placeholder="(inherit)" />

      <label>Prompt</label>
      <textarea name="prompt" rows={6} defaultValue={isNew ? '' : (agent?.prompt ?? '')} placeholder={agent?.prompt ?? '(inherit base prompt)'} />

      <label>Execution image (security-gated)</label>
      <input name="image" defaultValue={agent?.image ?? ''} placeholder={agent?.image ?? defaultImage ?? '(inherit default runner image)'} />
      <span className={styles.formNote}>
        Inherits the default runner image{defaultImage ? <> (<code>{defaultImage}</code>)</> : null} when blank.
        Changing it requires a CODEOWNERS-approved <code>dark-factory-approval</code> PR — reference it below.
      </span>

      <label>Approval PR (only when changing the image)</label>
      <input name="approval_pr" placeholder="re-cinq/lore#123" />

      <div className={styles.formActions}>
        <button type="submit">{isNew ? 'Create agent' : 'Save agent'}</button>
        {state.twoKey && <span className={styles.error}>image change needs an approval PR</span>}
        {state.error && <span className={styles.error}>{state.error}</span>}
      </div>
    </form>
  );
}

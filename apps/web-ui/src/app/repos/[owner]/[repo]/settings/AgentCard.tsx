'use client';
import { useActionState, useState } from 'react';
import { KNOWN_MODELS, type AgentDefinition } from '@/lib/agents-mirror';
import styles from './page.module.css';

export interface AgentActionState {
  ok?: boolean;
  twoKey?: boolean;
  error?: string;
}
export const INITIAL_AGENT_STATE: AgentActionState = {};

export type AgentAction = (prev: AgentActionState, fd: FormData) => Promise<AgentActionState>;

const KNOWN_IDS = KNOWN_MODELS.map((m) => m.id);

export default function AgentCard({
  repo,
  agent,
  saveAction,
  deleteAction,
  isNew = false,
}: {
  repo: string;
  agent: AgentDefinition;
  saveAction: AgentAction;
  deleteAction: AgentAction;
  isNew?: boolean;
}) {
  const [state, formAction] = useActionState(saveAction, INITIAL_AGENT_STATE);
  const [delState, delAction] = useActionState(deleteAction, INITIAL_AGENT_STATE);
  const startCustom = agent.model != null && agent.model !== '' && !KNOWN_IDS.includes(agent.model);
  const [modelSel, setModelSel] = useState(startCustom ? '__custom__' : (agent.model ?? ''));
  const inherited = !isNew && agent.project_id === null;

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        {isNew ? (
          <span className={styles.cardName}>New agent</span>
        ) : (
          <span className={styles.cardName}>{agent.name}</span>
        )}
        {inherited && <span className={styles.inherited}>inherited</span>}
        {agent.execution_mode === 'graph-ingest' && <span className={styles.badge}>zero-LLM</span>}
      </div>

      <form action={formAction} className={styles.cardForm}>
        <input type="hidden" name="repo" value={repo} />
        <input type="hidden" name="is_new" value={isNew ? '1' : '0'} />
        <input type="hidden" name="execution_mode" value={agent.execution_mode} />
        <input type="hidden" name="review_required" value={agent.review_required ? '1' : '0'} />
        {isNew ? (
          <>
            <label>Name</label>
            <input name="name_input" placeholder="my-agent" />
          </>
        ) : (
          <input type="hidden" name="name" value={agent.name} />
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
          <input name="model_custom" defaultValue={startCustom ? (agent.model ?? '') : ''} placeholder="model id (e.g. claude-opus-4-8)" />
        )}

        <label>Timeout (minutes)</label>
        <input name="timeout_minutes" type="number" min={1} max={1440} defaultValue={agent.timeout_minutes ?? ''} placeholder="(inherit)" />

        <label>Prompt</label>
        <textarea
          name="prompt"
          rows={5}
          defaultValue={inherited ? '' : (agent.prompt ?? '')}
          placeholder={agent.prompt ?? '(inherit base prompt)'}
        />

        <label>Execution image <span className={styles.gated}>gated</span></label>
        <input name="image" defaultValue={agent.image ?? ''} placeholder="(inherit default runner image)" />

        <label>Approval PR (only when changing the image)</label>
        <input name="approval_pr" placeholder="re-cinq/lore#123" />

        <div className={styles.cardActions}>
          <button type="submit">{isNew ? 'Create agent' : 'Save'}</button>
          {state.ok && <span className={styles.okMsg}>saved</span>}
          {state.twoKey && <span className={styles.errMsg}>image change needs an approval PR</span>}
          {state.error && <span className={styles.errMsg}>{state.error}</span>}
        </div>
      </form>

      {!inherited && !isNew && (
        <form action={delAction} className={styles.delForm}>
          <input type="hidden" name="repo" value={repo} />
          <input type="hidden" name="name" value={agent.name} />
          <button type="submit" className={styles.delBtn}>Reset to org default</button>
          {delState.error && <span className={styles.errMsg}>{delState.error}</span>}
        </form>
      )}
    </div>
  );
}

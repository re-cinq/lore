'use client';
import { useState } from 'react';
import AgentCard, { type AgentAction } from './AgentCard';
import type { AgentDefinition } from '@/lib/agents-mirror';
import styles from './page.module.css';

const BLANK: AgentDefinition = {
  name: '',
  model: null,
  timeout_minutes: null,
  prompt: null,
  image: null,
  execution_mode: 'claude-code',
  review_required: false,
  project_id: '',
};

export default function AgentsTab({
  repo,
  agents,
  saveAction,
  deleteAction,
}: {
  repo: string;
  agents: AgentDefinition[];
  saveAction: AgentAction;
  deleteAction: AgentAction;
}) {
  const [showNew, setShowNew] = useState(false);

  return (
    <div>
      <span className={`meta ${styles.hint}`}>
        Per-repo agents — model, timeout, prompt, and execution image. An <em>inherited</em> card
        shows the organisation default; editing it forks a repo-specific override. Image changes are
        security-gated (CODEOWNERS approval PR).
      </span>

      <div className={styles.cardGrid}>
        {agents.map((a) => (
          <AgentCard key={a.name} repo={repo} agent={a} saveAction={saveAction} deleteAction={deleteAction} />
        ))}
      </div>

      {showNew ? (
        <AgentCard repo={repo} agent={BLANK} saveAction={saveAction} deleteAction={deleteAction} isNew />
      ) : (
        <button type="button" className={styles.addBtn} onClick={() => setShowNew(true)}>
          + Add agent
        </button>
      )}
    </div>
  );
}

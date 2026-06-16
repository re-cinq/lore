'use client';
import { useActionState, useState } from 'react';
import type { ResolvedDarkFactorySettings } from '@/lib/dark-factory-resolve';
import type { AgentDefinition } from '@/lib/agents-mirror';
import HelpPopover from '@/components/HelpPopover';
import SaveResultBanner, { INITIAL_SAVE_STATE, type SaveState } from './SaveResultBanner';
import AgentsTab from './AgentsTab';
import type { AgentAction } from './AgentCard';
import styles from './page.module.css';

export interface RepoSettingsShape {
  task_types?: string[];
  slack_channel_id?: string;
  dispatch_label?: string;
  dispatch_default_type?: string;
  auto_review?: boolean;
  auto_ingest_graph?: boolean;
  trust?: { level?: string };
  cross_repo_repos?: string[];
  dark_factory?: { execution?: { image?: string } };
  incidents?: { title?: string; url?: string; created_at?: string }[];
}

export interface SettingsViewProps {
  fullName: string;
  team: string;
  settings: RepoSettingsShape;
  resolved: ResolvedDarkFactorySettings;
  defaultExecutionImage: string;
  allRepos: { full_name: string }[];
  agents: AgentDefinition[];
  saveAction: (prev: SaveState, formData: FormData) => Promise<SaveState>;
  saveAgentAction: AgentAction;
  deleteAgentAction: AgentAction;
}

const NOTIFY_CHANNELS = ['escalation', 'watched', 'all'] as const;
const TRUST_LEVELS = ['docs', 'tests', 'implementation', 'full'] as const;
type Tab = 'general' | 'agents' | 'dark';

export default function SettingsView({
  fullName, team, settings, resolved, defaultExecutionImage,
  allRepos, agents, saveAction, saveAgentAction, deleteAgentAction,
}: SettingsViewProps) {
  const [state, formAction] = useActionState(saveAction, INITIAL_SAVE_STATE);
  const [tab, setTab] = useState<Tab>('general');
  const selectedRepos = settings.cross_repo_repos ?? [];
  const incidents = settings.incidents ?? [];

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      className={`${styles.tab} ${tab === id ? styles.tabActive : ''}`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>Settings</h2>
        <HelpPopover label="How settings are applied">
          <p>Per-repo configuration, merged over the global <code>task-types.yaml</code> defaults — repo values win.</p>
          <ul>
            <li><strong>Agents</strong> are per-repo model/timeout/prompt/image; an inherited card forks a repo override when edited.</li>
            <li><strong>Trust level</strong> controls which task types are allowed, and auto-promotes after 3 successful merges.</li>
            <li><strong>Dark Factory</strong> + execution-image fields are security-gated: they require an admin token and a CODEOWNERS-approved <code>dark-factory-approval</code> PR.</li>
          </ul>
        </HelpPopover>
      </div>
      <p className={`meta ${styles.lede}`}>
        Per-repo configuration: general routing, agents, and dark-factory autonomy.
      </p>

      <div className={styles.tabs}>
        {tabBtn('general', 'General')}
        {tabBtn('agents', 'Agents')}
        {tabBtn('dark', 'Dark Factory')}
      </div>

      <SaveResultBanner state={state} />

      {/* Agents tab has its own per-card forms, so it lives OUTSIDE the settings form. */}
      <div hidden={tab !== 'agents'}>
        <AgentsTab
          repo={fullName}
          agents={agents}
          saveAction={saveAgentAction}
          deleteAction={deleteAgentAction}
        />
      </div>

      {/* One form spans General + Dark Factory; hidden-tab inputs still submit. */}
      <form action={formAction} className={`task-form ${styles.form}`} hidden={tab === 'agents'}>
        <input type="hidden" name="full_name" value={fullName} />

        <div hidden={tab !== 'general'}>
          <h3 className={styles.section}>General</h3>

          <label>Team</label>
          <input name="team" defaultValue={team} placeholder="e.g. platform, payments" />

          <label>Allowed Task Types (comma-separated)</label>
          <input name="task_types" defaultValue={(settings.task_types ?? []).join(', ')} placeholder="general, runbook, implementation" />

          <label>Default Dispatch Task Type</label>
          <input name="dispatch_default_type" defaultValue={settings.dispatch_default_type ?? ''} placeholder="general" />

          <label>Slack Channel ID</label>
          <input name="slack_channel_id" defaultValue={settings.slack_channel_id ?? ''} placeholder="C0123456789" />

          <label>Dispatch Label</label>
          <input name="dispatch_label" defaultValue={settings.dispatch_label ?? ''} placeholder="lore (default)" />

          <label>Trust Level</label>
          <select name="trust_level" defaultValue={settings.trust?.level ?? 'implementation'}>
            <option value="docs">Docs only (gap-fill, runbook)</option>
            <option value="tests">Tests (+ review)</option>
            <option value="implementation">Implementation (default)</option>
            <option value="full">Full (all task types)</option>
          </select>

          <label>Auto-review PRs</label>
          <select name="auto_review" defaultValue={settings.auto_review ? 'yes' : 'no'}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>

          <label>Auto-ingest knowledge graph</label>
          <select name="auto_ingest_graph" defaultValue={settings.auto_ingest_graph ? 'yes' : 'no'}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>

          <label>Cross-repo context (select repos to include)</label>
          <select name="cross_repo_repos" multiple size={Math.min(Math.max(allRepos.length, 1), 6)} defaultValue={selectedRepos}>
            {allRepos.map((r) => (
              <option key={r.full_name} value={r.full_name}>{r.full_name}</option>
            ))}
          </select>
          <span className={`meta ${styles.hint}`}>Hold Cmd/Ctrl to select multiple. Linked repos automatically get this repo added to their cross-repo list.</span>
        </div>

        <div hidden={tab !== 'dark'}>
          <h3 className={styles.section}>
            Dark Factory <span className={styles.gated}>security-gated</span>
          </h3>
          <span className={`meta ${styles.hint}`}>
            Enabling dark mode, widening auto-merge paths, weakening CI/approval requirements, or
            changing the execution image needs a CODEOWNERS-approved <code>dark-factory-approval</code> PR.
          </span>

          <label>Dark mode enabled</label>
          <select name="df_enabled" defaultValue={resolved.enabled ? 'yes' : 'no'}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>

          <label>Create GitHub Issue</label>
          <select name="df_create_issue" defaultValue={resolved.create_issue}>
            <option value="never">Never</option>
            <option value="on_gate">On gate / escalation only</option>
            <option value="always">Always</option>
          </select>

          <label>Review mode</label>
          <select name="df_review" defaultValue={resolved.review}>
            <option value="trust_based">Trust-based</option>
            <option value="always">Always</option>
            <option value="never">Never</option>
          </select>

          <label>Notify channels</label>
          <select name="df_notify" multiple size={3} defaultValue={resolved.notify}>
            {NOTIFY_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <label>Auto-merge paths (one glob per line)</label>
          <textarea name="df_am_paths" rows={4} defaultValue={resolved.auto_merge.paths.join('\n')} />

          <label>Auto-merge min trust</label>
          <select name="df_am_min_trust" defaultValue={resolved.auto_merge.min_trust}>
            {TRUST_LEVELS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          <label>Require green CI to auto-merge</label>
          <select name="df_am_green_ci" defaultValue={resolved.auto_merge.require_green_ci ? 'yes' : 'no'}>
            <option value="yes">Yes</option>
            <option value="no">No (downgrade — gated)</option>
          </select>

          <label>Require bot approval to auto-merge</label>
          <select name="df_am_bot_approval" defaultValue={resolved.auto_merge.require_bot_approval ? 'yes' : 'no'}>
            <option value="yes">Yes</option>
            <option value="no">No (downgrade — gated)</option>
          </select>

          <label>Execution image (BYO toolchain)</label>
          <input name="df_execution_image" defaultValue={settings.dark_factory?.execution?.image ?? ''} placeholder={defaultExecutionImage} />

          <h3 className={styles.section}>Approval PR (for gated changes)</h3>
          <span className={`meta ${styles.hint}`}>
            Required only when changing a security-gated field. Reference an open PR labeled
            <code> dark-factory-approval</code> approved by a CODEOWNER, as <code>owner/repo#N</code>.
          </span>
          <input name="approval_pr" placeholder="re-cinq/lore#123" />
        </div>

        <button type="submit">Save Settings</button>
      </form>

      {tab === 'general' && (
        <>
          <h3 className={styles.section}>Incidents (read-only)</h3>
          {incidents.length === 0 ? (
            <p className="meta">No recent incidents recorded for this repo.</p>
          ) : (
            <ul className={styles.incidents}>
              {incidents.map((inc, i) => (
                <li key={i}>
                  {inc.url ? <a href={inc.url}>{inc.title ?? inc.url}</a> : (inc.title ?? 'incident')}
                  {inc.created_at && <span className="meta"> — {inc.created_at}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

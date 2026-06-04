import ThemeSwitcher from '@/components/ThemeSwitcher';

export interface SettingsApprovalConfig {
  required: boolean;
  label: string;
  auto_approve: string[];
  repos: Record<string, { required: boolean }>;
}

export interface SettingsViewProps {
  apiUrl: string;
  ingestToken: string;
  repoCount: number;
  totalTasks: number;
  tasksToday: number;
  approvalConfig: SettingsApprovalConfig;
  /** Newline-joined `owner/repo` list of per-repo approval overrides. */
  repoLines: string;
  /** Server actions wired to the forms ("actions up"). */
  saveSettings: (formData: FormData) => void | Promise<void>;
  saveApprovalConfig: (formData: FormData) => void | Promise<void>;
  regenerateToken: (formData: FormData) => void | Promise<void>;
}

export default function SettingsView({
  apiUrl,
  ingestToken,
  repoCount,
  totalTasks,
  tasksToday,
  approvalConfig,
  repoLines,
  saveSettings,
  saveApprovalConfig,
  regenerateToken,
}: SettingsViewProps) {
  return (
    <div>
      <h1>Settings</h1>

      <h2>Appearance</h2>
      <div className="spec-card" style={{maxWidth:'600px', marginBottom:'24px'}}>
        <p className="meta" style={{fontSize:'var(--fs-xs)', marginTop:0, marginBottom:'12px'}}>
          Theme and appearance are stored in your browser and apply only to this device. Auto follows your operating system&apos;s light/dark setting.
        </p>
        <ThemeSwitcher />
      </div>

      <div style={{display:'flex', gap:'16px', marginBottom:'24px'}}>
        <div className="spec-card" style={{flex:1}}>
          <div className="meta">Onboarded Repos</div>
          <div style={{fontSize:'var(--fs-xl)', fontWeight:600}}>{repoCount ?? 0}</div>
        </div>
        <div className="spec-card" style={{flex:1}}>
          <div className="meta">Total Tasks</div>
          <div style={{fontSize:'var(--fs-xl)', fontWeight:600}}>{totalTasks ?? 0}</div>
        </div>
        <div className="spec-card" style={{flex:1}}>
          <div className="meta">Tasks Today</div>
          <div style={{fontSize:'var(--fs-xl)', fontWeight:600}}>{tasksToday ?? 0}</div>
        </div>
      </div>

      <h2>Platform Configuration</h2>
      <form action={saveSettings} className="task-form" style={{maxWidth:'600px'}}>
        <label>Lore API URL</label>
        <input name="api_url" defaultValue={apiUrl || ''} placeholder="https://your-lore-api.example.com" />
        <p className="meta" style={{fontSize:'var(--fs-xs)', marginTop:'2px'}}>
          The external URL for the MCP server API. Used by GitHub Actions workflows and local Claude Code for task delegation.
        </p>

        <label style={{marginTop:'16px'}}>Ingest Token</label>
        <input name="ingest_token" defaultValue={ingestToken || ''} style={{fontFamily:'var(--font-mono)', fontSize:'var(--fs-xs)'}} />
        <p className="meta" style={{fontSize:'var(--fs-xs)', marginTop:'2px'}}>
          Shared token for authenticating ingest and task API calls. Set this in developer installs via <code>git config --global lore.ingest-token</code> and on repos as the <code>LORE_INGEST_TOKEN</code> GitHub Actions secret.
        </p>

        <div style={{display:'flex', gap:'8px', marginTop:'16px'}}>
          <button type="submit">Save</button>
        </div>
      </form>

      <form action={regenerateToken} style={{marginTop:'8px'}}>
        <button type="submit" className="danger" style={{fontSize:'var(--fs-xs)', padding:'6px 12px'}}>Regenerate Token</button>
        <span className="meta" style={{marginLeft:'8px', fontSize:'var(--fs-xs)'}}>Warning: invalidates all existing tokens. You&apos;ll need to update all repos and developer installs.</span>
      </form>

      <h2 style={{marginTop:'32px'}}>Approval Gates</h2>
      <form action={saveApprovalConfig} className="task-form" style={{maxWidth:'600px'}}>
        <label style={{display:'flex', alignItems:'center', gap:'8px'}}>
          <input type="checkbox" name="approval_required" defaultChecked={approvalConfig.required} />
          Require approval for new tasks
        </label>
        <p className="meta" style={{fontSize:'var(--fs-xs)', marginTop:'2px'}}>
          When enabled, new pipeline tasks will wait for a human to add the approval label on the GitHub Issue before the agent processes them.
        </p>

        <label style={{marginTop:'16px'}}>Approval Label</label>
        <input name="approval_label" defaultValue={approvalConfig.label} placeholder="approved" />
        <p className="meta" style={{fontSize:'var(--fs-xs)', marginTop:'2px'}}>
          The GitHub Issue label that approves a task. The agent checks for this label every minute.
        </p>

        <label style={{marginTop:'16px'}}>Auto-approve Task Types (comma-separated)</label>
        <input name="auto_approve" defaultValue={approvalConfig.auto_approve.join(', ')} placeholder="general, gap-fill" />
        <p className="meta" style={{fontSize:'var(--fs-xs)', marginTop:'2px'}}>
          These task types skip the approval gate and are processed immediately, even when approval is required globally.
        </p>

        <label style={{marginTop:'16px'}}>Repos Requiring Approval (one per line, owner/repo)</label>
        <textarea name="approval_repos" defaultValue={repoLines} rows={4} placeholder={'re-cinq/production-app\nre-cinq/billing-service'} style={{fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)'}} />
        <p className="meta" style={{fontSize:'var(--fs-xs)', marginTop:'2px'}}>
          Per-repo overrides. Tasks targeting these repos always require approval, regardless of the global setting. Leave empty to use only the global toggle.
        </p>

        <div style={{display:'flex', gap:'8px', marginTop:'16px'}}>
          <button type="submit">Save Approval Config</button>
        </div>
      </form>

      <h2 style={{marginTop:'32px'}}>Developer Install Command</h2>
      <div className="spec-card">
        <pre style={{margin:0, fontSize:'var(--fs-sm)', overflowX:'auto'}}>{`git clone git@github.com:re-cinq/lore.git
cd lore && scripts/install.sh

# After install, set the token:
git config --global lore.ingest-token ${ingestToken || '<token>'}
git config --global lore.api-url ${apiUrl || 'https://your-lore-api.example.com'}`}</pre>
      </div>
    </div>
  );
}

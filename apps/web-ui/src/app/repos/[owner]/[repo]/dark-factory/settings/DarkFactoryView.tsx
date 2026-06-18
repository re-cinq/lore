'use client';
import { useActionState } from 'react';
import type { ResolvedDarkFactorySettings } from '@/lib/dark-factory-resolve';
import HelpPopover from '@/components/HelpPopover';
import SaveResultBanner, { INITIAL_SAVE_STATE, type SaveState } from '../../settings/SaveResultBanner';
import styles from '../../settings/page.module.css';

const NOTIFY_CHANNELS = ['escalation', 'watched', 'all'] as const;
const TRUST_LEVELS = ['docs', 'tests', 'implementation', 'full'] as const;

export interface DarkFactoryViewProps {
  fullName: string;
  resolved: ResolvedDarkFactorySettings;
  rawImage?: string;
  defaultExecutionImage: string;
  saveAction: (prev: SaveState, formData: FormData) => Promise<SaveState>;
}

export default function DarkFactoryView({
  fullName,
  resolved,
  rawImage,
  defaultExecutionImage,
  saveAction,
}: DarkFactoryViewProps) {
  const [state, formAction] = useActionState(saveAction, INITIAL_SAVE_STATE);

  return (
    <div>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>Dark Factory <span className={styles.gated}>security-gated</span></h2>
        <HelpPopover label="What Dark Factory does">
          <p>Autonomous (dark) mode for this repo. Enabling dark mode, widening auto-merge paths,
            weakening CI/approval requirements, or changing the execution image is security-gated.</p>
          <ul>
            <li>Privileged changes need an admin token <strong>and</strong> a CODEOWNERS-approved <code>dark-factory-approval</code> PR.</li>
          </ul>
        </HelpPopover>
      </div>
      <p className={`meta ${styles.lede}`}>
        Per-repo autonomy. Reference an approved <code>dark-factory-approval</code> PR when changing a gated field.
      </p>

      <SaveResultBanner state={state} />

      <form action={formAction} className={`task-form ${styles.form}`}>
        <input type="hidden" name="full_name" value={fullName} />

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
        <input name="df_execution_image" defaultValue={rawImage ?? ''} placeholder={defaultExecutionImage} />

        <h3 className={styles.section}>Approval PR (for gated changes)</h3>
        <span className={`meta ${styles.hint}`}>
          Required only when changing a security-gated field. Reference an open PR labeled
          <code> dark-factory-approval</code> approved by a CODEOWNER, as <code>owner/repo#N</code>.
        </span>
        <input name="approval_pr" placeholder="re-cinq/lore#123" />

        <button type="submit">Save Dark Factory</button>
      </form>
    </div>
  );
}

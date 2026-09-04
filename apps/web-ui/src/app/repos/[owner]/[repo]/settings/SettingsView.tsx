"use client";
import { useActionState } from "react";
import HelpPopover from "@/components/HelpPopover";
import SaveResultBanner, {
  INITIAL_SAVE_STATE,
  type SaveState,
} from "./SaveResultBanner";
import { SubmitButton } from "@/components/SubmitButton";
import type { components } from "@/lib/api/schema";
import styles from "./page.module.css";

export type RepoSettingsShape = NonNullable<
  components["schemas"]["Repo"]["settings"]
>;

export interface SettingsViewProps {
  fullName: string;
  team: string;
  settings: RepoSettingsShape;
  allRepos: { full_name: string }[];
  saveAction: (prev: SaveState, formData: FormData) => Promise<SaveState>;
}

export default function SettingsView({
  fullName,
  team,
  settings,
  allRepos,
  saveAction,
}: SettingsViewProps) {
  const [state, formAction] = useActionState(saveAction, INITIAL_SAVE_STATE);
  const selectedRepos = settings.cross_repo_repos ?? [];

  return (
    <div>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>Settings</h2>
        <SettingsHelp />
      </div>
      <p className={`meta ${styles.lede}`}>
        Per-repo general configuration: routing, trust, and cross-repo context.
      </p>

      <SaveResultBanner state={state} />

      <form action={formAction} className={`task-form ${styles.form}`}>
        <input type="hidden" name="full_name" value={fullName} />

        <GeneralFields team={team} settings={settings} />
        <CrossRepoField allRepos={allRepos} selectedRepos={selectedRepos} />
        <SubmitButton pendingLabel="Saving…">Save Settings</SubmitButton>
      </form>
    </div>
  );
}

function SettingsHelp() {
  return (
    <HelpPopover label="How settings are applied">
      <p>
        Per-repo configuration, merged over the global{" "}
        <code>task-types.yaml</code> defaults — repo values win.
      </p>
      <ul>
        <li>
          <strong>Trust level</strong> controls which task types are allowed,
          and auto-promotes after 3 successful merges.
        </li>
        <li>
          <strong>Cross-repo</strong> links are bidirectional — adding a repo
          here adds this repo to theirs.
        </li>
        <li>
          Per-repo <strong>agents</strong> live on the <strong>Agents</strong>{" "}
          tab; autonomy on the <strong>Dark Factory</strong> tab.
        </li>
      </ul>
    </HelpPopover>
  );
}

function textFieldDefaults(settings: RepoSettingsShape) {
  return {
    taskTypes: (settings.task_types ?? []).join(", "),
    dispatchDefaultType: settings.dispatch_default_type ?? "",
    slackChannelId: settings.slack_channel_id ?? "",
    dispatchLabel: settings.dispatch_label ?? "",
  };
}

function selectFieldDefaults(settings: RepoSettingsShape) {
  return {
    trustLevel: settings.trust?.level ?? "implementation",
    autoReview: settings.auto_review ? "yes" : "no",
  };
}

/** Routing and trust: who owns the repo, what it is allowed to run, and how much of it happens without asking. */
function GeneralFields({
  team,
  settings,
}: Pick<SettingsViewProps, "team" | "settings">) {
  const { taskTypes, dispatchDefaultType, slackChannelId, dispatchLabel } =
    textFieldDefaults(settings);
  const { trustLevel, autoReview } = selectFieldDefaults(settings);

  return (
    <>
      <h3 className={styles.section}>General</h3>

      <label>Team</label>
      <input
        name="team"
        defaultValue={team}
        placeholder="e.g. platform, payments"
      />

      <label>Allowed Task Types (comma-separated)</label>
      <input
        name="task_types"
        defaultValue={taskTypes}
        placeholder="general, runbook, implementation"
      />

      <label>Default Dispatch Task Type</label>
      <input
        name="dispatch_default_type"
        defaultValue={dispatchDefaultType}
        placeholder="general"
      />

      <label>Slack Channel ID</label>
      <input
        name="slack_channel_id"
        defaultValue={slackChannelId}
        placeholder="C0123456789"
      />

      <label>Dispatch Label</label>
      <input
        name="dispatch_label"
        defaultValue={dispatchLabel}
        placeholder="lore (default)"
      />

      <label>Trust Level</label>
      <select name="trust_level" defaultValue={trustLevel}>
        <option value="docs">Docs only (gap-fill, runbook)</option>
        <option value="tests">Tests (+ review)</option>
        <option value="implementation">Implementation (default)</option>
        <option value="full">Full (all task types)</option>
      </select>

      <label>Auto-review PRs</label>
      <select name="auto_review" defaultValue={autoReview}>
        <option value="no">No</option>
        <option value="yes">Yes</option>
      </select>
    </>
  );
}

/** Links are bidirectional — adding a repo here adds this repo to theirs — so this is a two-sided edit wearing a one-sided control. */
function CrossRepoField({
  allRepos,
  selectedRepos,
}: Pick<SettingsViewProps, "allRepos"> & { selectedRepos: string[] }) {
  return (
    <>
      <label>Cross-repo context (select repos to include)</label>
      <select
        name="cross_repo_repos"
        multiple
        size={Math.min(Math.max(allRepos.length, 1), 6)}
        defaultValue={selectedRepos}
      >
        {allRepos.map((r) => (
          <option key={r.full_name} value={r.full_name}>
            {r.full_name}
          </option>
        ))}
      </select>
      <span className={`meta ${styles.hint}`}>
        Hold Cmd/Ctrl to select multiple. Linked repos automatically get this
        repo added to their cross-repo list.
      </span>
    </>
  );
}

"use client";
import SettingsFormShell, { type SaveAction } from "./SettingsFormShell";
import DigestFields from "./DigestFields";
import SettingsHelp from "./SettingsHelp";
import { SubmitButton } from "@/components/SubmitButton";
import { type SettingsNavItem } from "@/components/SettingsLayout";
import { SettingsCard } from "@/components/SettingsCard";
import Switch from "@/components/Switch";
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
  saveAction: SaveAction;
}

/** Says what this tab covers, so a reader knows before scrolling which settings live here and which live on a sibling tab. */
const SETTINGS_LEDE =
  "Per-repo general configuration: routing, trust, cross-repo context, and the daily Slack digest.";

/** The sub-navigation, in the order the cards are shown. */
const SETTINGS_NAV: SettingsNavItem[] = [
  { id: "set-general", label: "General" },
  { id: "set-policy", label: "Run policy" },
  { id: "set-cross-repo", label: "Cross-repo context" },
  { id: "set-digest", label: "Daily digest" },
];

export default function SettingsView(props: SettingsViewProps) {
  const { fullName, team, settings, allRepos, saveAction } = props;

  return (
    <SettingsFormShell
      fullName={fullName}
      saveAction={saveAction}
      title="Settings"
      help={<SettingsHelp />}
      lede={SETTINGS_LEDE}
      nav={SETTINGS_NAV}
    >
      <SettingsSections team={team} settings={settings} allRepos={allRepos} />
      <div className={styles.saveRow}>
        <SubmitButton pendingLabel="Saving…">Save Settings</SubmitButton>
      </div>
    </SettingsFormShell>
  );
}

type SettingsSectionsProps = Pick<
  SettingsViewProps,
  "team" | "settings" | "allRepos"
>;

/** The form's four section cards, top to bottom. */
function SettingsSections({ team, settings, allRepos }: SettingsSectionsProps) {
  return (
    <>
      <GeneralFields team={team} settings={settings} />
      <RunPolicyFields {...selectFieldDefaults(settings)} />
      <CrossRepoField
        allRepos={allRepos}
        selectedRepos={settings.cross_repo_repos ?? []}
      />
      <DigestFields
        digest={settings.digest ?? undefined}
        slackChannelSet={Boolean(settings.slack_channel_id)}
      />
    </>
  );
}

type GeneralFieldsProps = Pick<SettingsViewProps, "team" | "settings">;

/** The free-text settings, in the order they are shown. `name` is the form field the server action reads, so it is also the key each value is looked up under. */
const GENERAL_FIELDS = [
  { label: "Team", name: "team", placeholder: "e.g. platform, payments" },
  {
    label: "Allowed Task Types (comma-separated)",
    name: "task_types",
    placeholder: "runbook, gap-fill, review",
  },
  {
    label: "Default Dispatch Task Type",
    name: "dispatch_default_type",
    placeholder: "the implementation loop's backlog (default)",
  },
  {
    label: "Slack Channel ID",
    name: "slack_channel_id",
    placeholder: "C0123456789",
  },
  {
    label: "Dispatch Label",
    name: "dispatch_label",
    placeholder: "lore (default)",
  },
];

/** Routing: who owns the repo, what it may run, and where it talks. */
function GeneralFields({ team, settings }: GeneralFieldsProps) {
  const values = generalValues({ team, settings });

  return (
    <SettingsCard
      id="set-general"
      title="General"
      description="Who owns this repository, what it may run, and where Lore posts about it."
      headingLevel={3}
    >
      {GENERAL_FIELDS.map((field) => (
        <TextField key={field.name} {...field} value={values[field.name]} />
      ))}
    </SettingsCard>
  );
}

/** The value each free-text field shows, keyed by the form `name` the server action reads. */
function generalValues(props: GeneralFieldsProps): Record<string, string> {
  const { taskTypes, dispatchDefaultType, slackChannelId, dispatchLabel } =
    textFieldDefaults(props.settings);

  return {
    team: props.team,
    task_types: taskTypes,
    dispatch_default_type: dispatchDefaultType,
    slack_channel_id: slackChannelId,
    dispatch_label: dispatchLabel,
  };
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
    autoReview: Boolean(settings.auto_review),
    autoMergeApprover: settings.auto_merge?.approver ?? "none",
  };
}

interface TextFieldProps {
  label: string;
  name: string;
  value: string;
  placeholder: string;
}

/** A labelled free-text setting. Uncontrolled on purpose: the form posts to a server action, so the browser holds the edits and a re-render cannot discard what the reader typed. */
function TextField({ label, name, value, placeholder }: TextFieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor={`setting-${name}`}>{label}</label>
      <input
        id={`setting-${name}`}
        name={name}
        defaultValue={value}
        placeholder={placeholder}
      />
    </div>
  );
}

interface RunPolicyFieldsProps {
  trustLevel: string;
  autoReview: boolean;
  autoMergeApprover: string;
}

/** Not more text boxes: trust level decides which task types this repo accepts at all, and auto-review decides whether a PR is reviewed without anyone asking. */
function RunPolicyFields(props: RunPolicyFieldsProps) {
  const { trustLevel, autoReview, autoMergeApprover } = props;

  return (
    <SettingsCard
      id="set-policy"
      title="Run policy"
      description="How much Lore does on this repository without a person asking."
      headingLevel={3}
    >
      <TrustLevelField trustLevel={trustLevel} />
      <AutoReviewField autoReview={autoReview} />
      <input
        type="hidden"
        name="auto_merge_approver_saved"
        value={autoMergeApprover}
      />
      <AutoMergeApproverField autoMergeApprover={autoMergeApprover} />
    </SettingsCard>
  );
}

function TrustLevelField({ trustLevel }: { trustLevel: string }) {
  return (
    <div className={styles.field}>
      <label htmlFor="setting-trust_level">Trust Level</label>
      <select
        id="setting-trust_level"
        name="trust_level"
        defaultValue={trustLevel}
      >
        <option value="docs">Docs only (gap-fill, runbook)</option>
        <option value="tests">Tests (+ review)</option>
        <option value="implementation">Implementation (default)</option>
        <option value="full">Full (all task types)</option>
      </select>
    </div>
  );
}

/** A switch posting "yes" when on, the value the server action reads. */
function AutoReviewField({ autoReview }: { autoReview: boolean }) {
  return (
    <Switch
      name="auto_review"
      value="yes"
      defaultChecked={autoReview}
      label="Auto-review PRs"
      detail="Every open pull request gets a review from the code-review line."
    />
  );
}

const INSTALL_URL = "https://github.com/apps/lore-reviewer/installations/new";

function AutoMergeApproverField(props: { autoMergeApprover: string }) {
  return (
    <div className={styles.field}>
      <label htmlFor="setting-auto_merge_approver">Auto-merge Approver</label>
      <select
        id="setting-auto_merge_approver"
        name="auto_merge_approver"
        defaultValue={props.autoMergeApprover}
      >
        <option value="none">none</option>
        <option value="lore-reviewer">lore-reviewer</option>
      </select>
      <ReviewerInstallHint />
    </div>
  );
}

function ReviewerInstallHint() {
  return (
    <span className={styles.hint}>
      Requires the second App to be installed on the repository.{" "}
      <a href={INSTALL_URL} target="_blank" rel="noopener noreferrer">
        Install lore-reviewer
      </a>
    </span>
  );
}

type CrossRepoFieldProps = Pick<SettingsViewProps, "allRepos"> & {
  selectedRepos: string[];
};

/** Links are bidirectional — adding a repo here adds this repo to theirs — so this is a two-sided edit wearing a one-sided control. */
function CrossRepoField({ allRepos, selectedRepos }: CrossRepoFieldProps) {
  return (
    <SettingsCard
      id="set-cross-repo"
      title="Cross-repo context"
      description="Repositories whose context sessions in this one also search."
      headingLevel={3}
    >
      <CrossRepoSelect allRepos={allRepos} selectedRepos={selectedRepos} />
      <span className={styles.hint}>
        Hold Cmd/Ctrl to select multiple. Linked repos automatically get this
        repo added to their cross-repo list.
      </span>
    </SettingsCard>
  );
}

function CrossRepoSelect({ allRepos, selectedRepos }: CrossRepoFieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor="setting-cross_repo_repos">Repos to include</label>
      <select
        id="setting-cross_repo_repos"
        name="cross_repo_repos"
        multiple
        size={Math.min(Math.max(allRepos.length, 1), 6)}
        defaultValue={selectedRepos}
      >
        <RepoOptions allRepos={allRepos} />
      </select>
    </div>
  );
}

function RepoOptions({ allRepos }: Pick<SettingsViewProps, "allRepos">) {
  return (
    <>
      {allRepos.map((repo) => (
        <option key={repo.full_name} value={repo.full_name}>
          {repo.full_name}
        </option>
      ))}
    </>
  );
}

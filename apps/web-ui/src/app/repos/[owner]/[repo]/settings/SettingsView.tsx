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

/** Names the page and what it covers, so a reader knows before scrolling which settings live here and which live on a sibling tab. */
function SettingsHeader() {
  return (
    <>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>Settings</h2>
        <SettingsHelp />
      </div>
      <p className={`meta ${styles.lede}`}>
        Per-repo general configuration: routing, trust, and cross-repo context.
      </p>
    </>
  );
}

export default function SettingsView(props: SettingsViewProps) {
  const { fullName, team, settings, allRepos, saveAction } = props;
  const [state, formAction] = useActionState(saveAction, INITIAL_SAVE_STATE);
  const selectedRepos = settings.cross_repo_repos ?? [];

  return (
    <div>
      <SettingsHeader />

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

/** The three things a reader most often gets wrong about this page. */
function SettingsHelpPoints() {
  return (
    <ul>
      <li>
        <strong>Trust level</strong> controls which task types are allowed, and
        auto-promotes after 3 successful merges.
      </li>
      <li>
        <strong>Cross-repo</strong> links are bidirectional — adding a repo here
        adds this repo to theirs.
      </li>
      <li>
        Per-repo <strong>agents</strong> live on the <strong>Agents</strong>{" "}
        tab; autonomy on the <strong>Dark Factory</strong> tab.
      </li>
    </ul>
  );
}

function SettingsHelp() {
  return (
    <HelpPopover label="How settings are applied">
      <p>
        Per-repo configuration, merged over the global{" "}
        <code>task-types.yaml</code> defaults — repo values win.
      </p>
      <SettingsHelpPoints />
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

interface RunPolicyFieldsProps {
  trustLevel: string;
  autoReview: string;
}

/** Not more text boxes: trust level decides which task types this repo accepts at all, and auto-review decides whether a PR is reviewed without anyone asking. */
function RunPolicyFields({ trustLevel, autoReview }: RunPolicyFieldsProps) {
  return (
    <>
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

/** The free-text settings, in the order they are shown. `name` is the form field the server action reads, so it is also the key each value is looked up under. */
const GENERAL_FIELDS = [
  { label: "Team", name: "team", placeholder: "e.g. platform, payments" },
  {
    label: "Allowed Task Types (comma-separated)",
    name: "task_types",
    placeholder: "general, runbook, implementation",
  },
  {
    label: "Default Dispatch Task Type",
    name: "dispatch_default_type",
    placeholder: "general",
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

interface TextFieldProps {
  label: string;
  name: string;
  value: string;
  placeholder: string;
}

/** A labelled free-text setting. Uncontrolled on purpose: the form posts to a server action, so the browser holds the edits and a re-render cannot discard what the reader typed. */
function TextField({ label, name, value, placeholder }: TextFieldProps) {
  return (
    <>
      <label>{label}</label>
      <input name={name} defaultValue={value} placeholder={placeholder} />
    </>
  );
}

type GeneralFieldsProps = Pick<SettingsViewProps, "team" | "settings">;

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

/** Routing and trust: who owns the repo, what it is allowed to run, and how much of it happens without asking. */
function GeneralFields({ team, settings }: GeneralFieldsProps) {
  const values = generalValues({ team, settings });
  const { trustLevel, autoReview } = selectFieldDefaults(settings);

  return (
    <>
      <h3 className={styles.section}>General</h3>

      {GENERAL_FIELDS.map((field) => (
        <TextField key={field.name} {...field} value={values[field.name]} />
      ))}

      <RunPolicyFields trustLevel={trustLevel} autoReview={autoReview} />
    </>
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

type CrossRepoFieldProps = Pick<SettingsViewProps, "allRepos"> & {
  selectedRepos: string[];
};

/** Links are bidirectional — adding a repo here adds this repo to theirs — so this is a two-sided edit wearing a one-sided control. */
function CrossRepoField({ allRepos, selectedRepos }: CrossRepoFieldProps) {
  return (
    <>
      <label>Cross-repo context (select repos to include)</label>
      <select
        name="cross_repo_repos"
        multiple
        size={Math.min(Math.max(allRepos.length, 1), 6)}
        defaultValue={selectedRepos}
      >
        <RepoOptions allRepos={allRepos} />
      </select>
      <span className={`meta ${styles.hint}`}>
        Hold Cmd/Ctrl to select multiple. Linked repos automatically get this
        repo added to their cross-repo list.
      </span>
    </>
  );
}

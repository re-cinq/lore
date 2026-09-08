"use client";
import { useActionState } from "react";
import type { ResolvedDarkFactorySettings } from "@/lib/dark-factory-resolve";
import HelpPopover from "@/components/HelpPopover";
import SaveResultBanner, {
  INITIAL_SAVE_STATE,
  type SaveState,
} from "../../settings/SaveResultBanner";
import styles from "../../settings/page.module.css";

const NOTIFY_CHANNELS = ["escalation", "watched", "all"] as const;
const TRUST_LEVELS = ["docs", "tests", "implementation", "full"] as const;

export interface DarkFactoryViewProps {
  fullName: string;
  resolved: ResolvedDarkFactorySettings;
  rawImage?: string;
  defaultExecutionImage: string;
  saveAction: (prev: SaveState, formData: FormData) => Promise<SaveState>;
}

/** Names the page and its cost in the same breath: the "security-gated" tag and the approval-PR requirement are the two things a reader needs before touching anything below. */
function SettingsHeader() {
  return (
    <>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>
          Dark Factory <span className={styles.gated}>security-gated</span>
        </h2>
        <DarkFactoryHelp />
      </div>
      <p className={`meta ${styles.lede}`}>
        Per-repo autonomy. Reference an approved{" "}
        <code>dark-factory-approval</code> PR when changing a gated field.
      </p>
    </>
  );
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
      <SettingsHeader />

      <SaveResultBanner state={state} />

      <form action={formAction} className={`task-form ${styles.form}`}>
        <input type="hidden" name="full_name" value={fullName} />

        <ModeFields resolved={resolved} />
        <AutoMergeFields resolved={resolved} />
        <label>Execution image (BYO toolchain)</label>
        <input
          name="df_execution_image"
          defaultValue={rawImage ?? ""}
          placeholder={defaultExecutionImage}
        />

        <ApprovalPrField />
        <button type="submit">Save Dark Factory</button>
      </form>
    </div>
  );
}

function DarkFactoryHelp() {
  return (
    <HelpPopover label="What Dark Factory does">
      <p>
        Autonomous (dark) mode for this repo. Enabling dark mode, widening
        auto-merge paths, weakening CI/approval requirements, or changing the
        execution image is security-gated.
      </p>
      <ul>
        <li>
          Privileged changes need an admin token <strong>and</strong> a
          CODEOWNERS-approved <code>dark-factory-approval</code> PR.
        </li>
      </ul>
    </HelpPopover>
  );
}

/** Issues are off by default in dark mode — the PR is the artifact — so "never" leads. */
const CREATE_ISSUE_OPTIONS: [string, string][] = [
  ["never", "Never"],
  ["on_gate", "On gate / escalation only"],
  ["always", "Always"],
];

const REVIEW_OPTIONS: [string, string][] = [
  ["trust_based", "Trust-based"],
  ["always", "Always"],
  ["never", "Never"],
];

/** "No" first: enabling dark mode is the deliberate act, so the safe answer is the one already selected. */
const YES_NO_OPTIONS: [string, string][] = [
  ["no", "No"],
  ["yes", "Yes"],
];

/** A labelled select over a fixed set of values, given as `[value, label]` pairs so the stored value and the words a reader sees stay together at the call site. */
function ChoiceField({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value: string;
  options: [string, string][];
}) {
  return (
    <>
      <label>{label}</label>
      <select name={name} defaultValue={value}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </>
  );
}

/** Which channels hear about this repo. Multi-select because escalation and routine notification can go to different places, and an empty selection still escalates — the platform's floor, not a silence setting. */
function NotifyField({ selected }: { selected: readonly string[] }) {
  return (
    <>
      <label>Notify channels</label>
      <select name="df_notify" multiple size={3} defaultValue={selected}>
        {NOTIFY_CHANNELS.map((channel) => (
          <option key={channel} value={channel}>
            {channel}
          </option>
        ))}
      </select>
    </>
  );
}

/** What the factory does at all: whether it runs dark, whether it files Issues, whether it reviews, and who hears about it. */
function ModeFields({ resolved }: { resolved: ResolvedDarkFactorySettings }) {
  return (
    <>
      <ChoiceField
        label="Dark mode enabled"
        name="df_enabled"
        value={resolved.enabled ? "yes" : "no"}
        options={YES_NO_OPTIONS}
      />

      <ChoiceField
        label="Create GitHub Issue"
        name="df_create_issue"
        value={resolved.create_issue}
        options={CREATE_ISSUE_OPTIONS}
      />
      <ChoiceField
        label="Review mode"
        name="df_review"
        value={resolved.review}
        options={REVIEW_OPTIONS}
      />

      <NotifyField selected={resolved.notify} />
    </>
  );
}

/** A safety requirement that can be turned off. "No" is labelled as a DOWNGRADE in the option itself, because that word is what the approval ceremony gates — a reader should meet it before choosing, not after the save is refused. */
function RequirementField({
  label,
  name,
  required,
}: {
  label: string;
  name: string;
  required: boolean;
}) {
  return (
    <>
      <label>{label}</label>
      <select name={name} defaultValue={required ? "yes" : "no"}>
        <option value="yes">Yes</option>
        <option value="no">No (downgrade — gated)</option>
      </select>
    </>
  );
}

/** The trust rung a repo must reach before a PR may merge itself. Trust is earned by merges, so this is a floor on experience rather than a permission someone grants. */
function MinTrustField({ value }: { value: string }) {
  return (
    <>
      <label>Auto-merge min trust</label>
      <select name="df_am_min_trust" defaultValue={value}>
        {TRUST_LEVELS.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </select>
    </>
  );
}

/** When a PR may merge itself. Every "No" here is a downgrade, which is exactly what the approval ceremony gates. */
function AutoMergeFields({
  resolved,
}: {
  resolved: ResolvedDarkFactorySettings;
}) {
  return (
    <>
      <label>Auto-merge paths (one glob per line)</label>
      <textarea
        name="df_am_paths"
        rows={4}
        defaultValue={resolved.auto_merge.paths.join("\n")}
      />

      <MinTrustField value={resolved.auto_merge.min_trust} />

      <RequirementField
        label="Require green CI to auto-merge"
        name="df_am_green_ci"
        required={resolved.auto_merge.require_green_ci}
      />
      <RequirementField
        label="Require bot approval to auto-merge"
        name="df_am_bot_approval"
        required={resolved.auto_merge.require_bot_approval}
      />
    </>
  );
}

function ApprovalPrField() {
  return (
    <>
      <h3 className={styles.section}>Approval PR (for gated changes)</h3>
      <span className={`meta ${styles.hint}`}>
        Required only when changing a security-gated field. Reference an open PR
        labeled
        <code> dark-factory-approval</code> approved by a CODEOWNER, as{" "}
        <code>owner/repo#N</code>.
      </span>
      <input name="approval_pr" placeholder="re-cinq/lore#123" />
    </>
  );
}

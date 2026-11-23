import { SettingsCard } from "@/components/SettingsCard";
import styles from "./page.module.css";
import type { RepoSettingsShape } from "./SettingsView";

/** What the auto-merge loop waits when the repository saved no minimum age (lore-shared `autoMergeMinAgeHours`). */
const DEFAULT_MIN_AGE_HOURS = 24;

type FieldProps = { settings: RepoSettingsShape };

/** Trust level decides which task types this repo accepts at all; the minimum age is how long the auto-merge loop waits. The loops' switches (code review, auto merge, …) live on the Loops tab. */
export default function RunPolicyFields({
  settings,
}: {
  settings: RepoSettingsShape;
}) {
  return (
    <SettingsCard
      id="set-policy"
      title="Run policy"
      description="How much Lore does on this repository without a person asking."
      headingLevel={3}
    >
      <TrustLevelField settings={settings} />
      <MinAgeField settings={settings} />
      <DoneCheckField settings={settings} />
      <MaxParallelField settings={settings} />
    </SettingsCard>
  );
}

/** The auto-merge loop's one setting: how long a pull request stays open before the loop merges it. Its on/off switch is on the Loops tab. */
function MinAgeField({ settings }: FieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor="setting-auto_merge_min_age_hours">
        Auto merge: hours a pull request stays open before it merges
      </label>
      <input
        id="setting-auto_merge_min_age_hours"
        name="auto_merge_min_age_hours"
        type="number"
        min={0}
        step={1}
        defaultValue={minAgeHoursOf(settings)}
      />
      <span className={styles.hint}>
        Switch the auto-merge loop on or off on the Loops tab.
      </span>
    </div>
  );
}

function minAgeHoursOf(settings: RepoSettingsShape): number {
  return settings.auto_merge?.min_age_hours ?? DEFAULT_MIN_AGE_HOURS;
}

/** The implementation loop's "already done?" check (FR12.20). Its on/off switch for the loop itself is on the Loops tab. */
function DoneCheckField({ settings }: FieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.choice}>
        <input
          type="checkbox"
          id="setting-implementation_loop_done_check"
          name="implementation_loop_done_check"
          defaultChecked={settings.implementation_loop?.done_check === true}
        />{" "}
        Implementation loop: close a ticket a merged pull request already did,
        before the definition-of-done agent runs
      </label>
      <span className={styles.hint}>
        A small model reads the merged pull requests that touched the files the
        ticket names. Switch the loop itself on or off on the Loops tab.
      </span>
    </div>
  );
}

/** How many tickets of this repository the implementation loop works at once. */
function MaxParallelField({ settings }: FieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor="setting-implementation_loop_max_parallel">
        Implementation loop: tickets worked at once
      </label>
      <input
        id="setting-implementation_loop_max_parallel"
        name="implementation_loop_max_parallel"
        type="number"
        min={1}
        max={5}
        defaultValue={settings.implementation_loop?.max_parallel ?? 1}
      />
      <span className={styles.hint}>
        From 1 to 5. With 1, the next ticket starts when the one worked is done.
      </span>
    </div>
  );
}

function TrustLevelField({ settings }: FieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor="setting-trust_level">Trust Level</label>
      <select
        id="setting-trust_level"
        name="trust_level"
        defaultValue={settings.trust?.level ?? "implementation"}
      >
        <option value="docs">Docs only (gap-fill, runbook)</option>
        <option value="tests">Tests (+ review)</option>
        <option value="implementation">Implementation (default)</option>
        <option value="full">Full (all task types)</option>
      </select>
    </div>
  );
}

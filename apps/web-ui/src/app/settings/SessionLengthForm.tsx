import { SubmitButton } from "@/components/SubmitButton";
import { SettingsCard } from "@/components/SettingsCard";
import styles from "./SettingsView.module.css";
import type { SettingsViewProps } from "./SettingsView";

type SessionLengthFormProps = Pick<
  SettingsViewProps,
  "sessionLengthHours" | "saveSessionLength"
>;

/** lore-api's `SESSION_LENGTH_HOURS` and `DEFAULT_SESSION_LENGTH_HOURS` (libs/shared/src/domain/session-length.ts), which refuses any other length on save; web-ui is not a workspace member and cannot import them. */
const SESSION_LENGTHS = [
  { hours: "8", label: "8 hours" },
  { hours: "24", label: "1 day" },
  { hours: "168", label: "7 days" },
  { hours: "720", label: "30 days" },
];

const DEFAULT_SESSION_LENGTH = "8";

/** How long a person stays signed in to the web UI (ADR-053). */
export default function SessionLengthForm(props: SessionLengthFormProps) {
  return (
    <SettingsCard
      id="set-session"
      title="Sign-in session"
      description="How long a person stays signed in to this web UI before GitHub is asked again."
    >
      <SessionLengthFields {...props} />
    </SettingsCard>
  );
}

function SessionLengthFields(props: SessionLengthFormProps) {
  return (
    <form
      action={props.saveSessionLength}
      className={`task-form ${styles.form}`}
    >
      <LengthField hours={props.sessionLengthHours} />
      <LengthNote />
      <div className={styles.actions}>
        <SubmitButton pendingLabel="Saving…">Save session length</SubmitButton>
      </div>
    </form>
  );
}

function LengthField({ hours }: { hours: string }) {
  return (
    <>
      <label htmlFor="session_length_hours">Session length</label>
      <select
        id="session_length_hours"
        name="session_length_hours"
        defaultValue={hours || DEFAULT_SESSION_LENGTH}
      >
        {SESSION_LENGTHS.map((length) => (
          <option key={length.hours} value={length.hours}>
            {length.label}
          </option>
        ))}
      </select>
    </>
  );
}

function LengthNote() {
  return (
    <p className={styles.fieldNote}>
      A new length applies from each person&apos;s next sign-in. Someone removed
      from the GitHub organisation keeps their access until their session ends.
    </p>
  );
}

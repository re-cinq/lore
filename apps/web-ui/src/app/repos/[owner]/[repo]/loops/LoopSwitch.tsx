"use client";

import { useState } from "react";
import PendingActionButton from "@/components/PendingActionButton";
import StateDot from "./StateDot";
import styles from "./LoopSwitch.module.scss";

/** What a click asks for; the auto-merge loop also takes its minimum age. */
export interface SwitchAsk {
  enabled: boolean;
  min_age_hours?: number;
}

interface LoopSwitchProps {
  /** The loop's full name, e.g. "Implementation loop". */
  label: string;
  description: string;
  enabled: boolean;
  /** The auto-merge loop's one setting: hours a pull request must have been open before it merges. Absent on every other loop. */
  minAgeHours?: number;
  /** Answers why the switch was refused, or null. */
  toggle: (next: SwitchAsk) => Promise<string | null>;
}

/** The loop's name and its one control: a button that shows the state it is in (green On, red Off) and flips it on click. */
export default function LoopSwitch(props: LoopSwitchProps) {
  const { label, description } = props;

  return (
    <div className={styles.row}>
      <div>
        <h2 className={styles.name}>{label}</h2>
        <p className={`meta ${styles.description}`}>{description}</p>
      </div>
      <SwitchButton {...props} />
    </div>
  );
}

/** The switch shows the state it was flipped to from the click on, with a spinner, until the refreshed page brings that state: the refresh re-reads every loop and takes seconds, and the old state would read as a click that did nothing. A refused write falls back to the saved state and says why. */
function SwitchButton(props: LoopSwitchProps) {
  const { label, enabled, minAgeHours, toggle } = props;
  const { shown, pending, refusal, flip } = useRequestedState(props);

  return (
    <div className={styles.control}>
      <StateButton state={{ label, shown, pending }} onFlip={flip} />
      {minAgeHours !== undefined && (
        <MinAgeField
          hours={minAgeHours}
          save={(hours) => toggle({ enabled, min_age_hours: hours })}
        />
      )}
      {refusal && <SwitchRefused reason={refusal} />}
    </div>
  );
}

/** The auto-merge loop's one setting, saved when the field loses focus with a changed whole number of hours. */
function MinAgeField(props: {
  hours: number;
  save: (hours: number) => Promise<string | null>;
}) {
  const { value, setValue, note, commit } = useMinAge(props);

  return (
    <label className={styles.minAge}>
      Merges once open
      <input
        type="number"
        min={0}
        step={1}
        aria-label="Hours a pull request must be open before it merges"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void commit()}
      />
      hours
      {note && <SwitchRefused reason={note} />}
    </label>
  );
}

/** The field's text, and what saving it answered; a value that is not a changed whole number of hours goes back to the saved one. */
function useMinAge(props: {
  hours: number;
  save: (hours: number) => Promise<string | null>;
}) {
  const [value, setValue] = useState(String(props.hours));
  const [note, setNote] = useState<string | null>(null);

  async function commit() {
    const hours = Number(value);

    if (!Number.isInteger(hours) || hours < 0 || hours === props.hours) {
      setValue(String(props.hours));

      return;
    }
    setNote(await props.save(hours));
  }

  return { value, setValue, note, commit };
}

/** The button itself: the state it shows, in its colour, with a spinner while a flip is on its way. */
function StateButton({
  state,
  onFlip,
}: {
  state: { label: string; shown: boolean; pending: boolean };
  onFlip: () => Promise<void>;
}) {
  const { label, shown, pending } = state;
  const face = <SwitchFace enabled={shown} />;

  return (
    <PendingActionButton
      action={onFlip}
      pending={pending}
      text={face}
      pendingText={face}
      className={`${styles.switch} ${shown ? styles.on : styles.off}`}
      title={shown ? `Switch ${label} off` : `Switch ${label} on`}
    />
  );
}

function SwitchFace({ enabled }: { enabled: boolean }) {
  return (
    <>
      <StateDot enabled={enabled} />
      {enabled ? "On" : "Off"}
    </>
  );
}

function SwitchRefused({ reason }: { reason: string }) {
  return (
    <span role="alert" className={styles.failed}>
      {reason}
    </span>
  );
}

type Requested = boolean | { refused: string } | null;

/** The state the last click asked for (or why its write was refused), until the saved state catches up with it; forgotten once it does, so a later change made elsewhere shows as it is. */
function useRequestedState(props: Pick<LoopSwitchProps, "enabled" | "toggle">) {
  const { enabled, toggle } = props;
  const [requested, setRequested] = useState<Requested>(null);

  if (requested === enabled) {
    setRequested(null);
  }

  async function flip() {
    setRequested(!enabled);
    const refused = await toggle({ enabled: !enabled }).catch(
      () => "Could not switch it; try again.",
    );

    if (refused) {
      setRequested({ refused });
    }
  }

  return { ...shownState({ requested, enabled }), flip };
}

function shownState({
  requested,
  enabled,
}: {
  requested: Requested;
  enabled: boolean;
}) {
  const target = typeof requested === "boolean" ? requested : null;
  const refusal =
    requested !== null && typeof requested === "object"
      ? requested.refused
      : null;

  return { shown: target ?? enabled, pending: target !== null, refusal };
}

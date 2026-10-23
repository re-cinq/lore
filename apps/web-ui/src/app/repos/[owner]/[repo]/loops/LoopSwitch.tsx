"use client";

import { useState } from "react";
import PendingActionButton from "@/components/PendingActionButton";
import StateDot from "./StateDot";
import styles from "./LoopSwitch.module.scss";

/** What a click asks for. */
export interface SwitchAsk {
  enabled: boolean;
}

interface LoopSwitchProps {
  /** The loop's full name, e.g. "Implementation loop". */
  label: string;
  description: string;
  enabled: boolean;
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
  const { shown, pending, refusal, flip } = useRequestedState(props);

  return (
    <div className={styles.control}>
      <StateButton
        state={{ label: props.label, shown, pending }}
        onFlip={flip}
      />
      {refusal && <SwitchRefused reason={refusal} />}
    </div>
  );
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

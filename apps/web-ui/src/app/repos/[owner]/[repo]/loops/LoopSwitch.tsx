"use client";

import { useState } from "react";
import PendingActionButton from "@/components/PendingActionButton";
import StateDot from "./StateDot";
import styles from "./LoopSwitch.module.scss";

interface LoopSwitchProps {
  /** The loop's full name, e.g. "Implementation loop". */
  label: string;
  description: string;
  enabled: boolean;
  toggle: (next: { enabled: boolean }) => Promise<void>;
}

/** The loop's name and its one control: a button that shows the state it is in (green On, red Off) and flips it on click. */
export default function LoopSwitch(props: LoopSwitchProps) {
  const { label, description, enabled, toggle } = props;

  return (
    <div className={styles.row}>
      <div>
        <h2 className={styles.name}>{label}</h2>
        <p className={`meta ${styles.description}`}>{description}</p>
      </div>
      <SwitchButton label={label} enabled={enabled} toggle={toggle} />
    </div>
  );
}

/** The switch shows the state it was flipped to from the click on, with a spinner, until the refreshed page brings that state: the refresh re-reads every loop and takes seconds, and the old state would read as a click that did nothing. A refused write falls back to the saved state and says so. */
function SwitchButton(props: Omit<LoopSwitchProps, "description">) {
  const { label } = props;
  const { shown, pending, failed, flip } = useRequestedState(props);
  const face = <SwitchFace enabled={shown} />;

  return (
    <div className={styles.control}>
      <PendingActionButton
        action={flip}
        pending={pending}
        text={face}
        pendingText={face}
        className={`${styles.switch} ${shown ? styles.on : styles.off}`}
        title={shown ? `Switch ${label} off` : `Switch ${label} on`}
      />
      {failed && <SwitchFailed />}
    </div>
  );
}

function SwitchFailed() {
  return (
    <span role="alert" className={styles.failed}>
      Could not switch it; try again.
    </span>
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

/** The state the last click asked for (or that its write was refused), until the saved state catches up with it; forgotten once it does, so a later change made elsewhere shows as it is. */
function useRequestedState(props: Pick<LoopSwitchProps, "enabled" | "toggle">) {
  const { enabled, toggle } = props;
  const [requested, setRequested] = useState<boolean | "refused" | null>(null);

  if (requested === enabled) {
    setRequested(null);
  }

  async function flip() {
    setRequested(!enabled);
    await toggle({ enabled: !enabled }).catch(() => setRequested("refused"));
  }

  const target = typeof requested === "boolean" ? requested : null;

  return {
    shown: target ?? enabled,
    pending: target !== null,
    failed: requested === "refused",
    flip,
  };
}

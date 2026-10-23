"use client";

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

/** The loop's name and its one control: a button that shows the state it is in (green On, red Off) and flips it on click. Disabled while the server action runs, so a double click cannot send two conflicting switches. */
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

function SwitchButton({
  label,
  enabled,
  toggle,
}: Omit<LoopSwitchProps, "description">) {
  return (
    <PendingActionButton
      action={() => toggle({ enabled: !enabled })}
      text={
        <>
          <StateDot enabled={enabled} />
          {enabled ? "On" : "Off"}
        </>
      }
      pendingText="Switching…"
      className={`${styles.switch} ${enabled ? styles.on : styles.off}`}
      title={enabled ? `Switch ${label} off` : `Switch ${label} on`}
    />
  );
}

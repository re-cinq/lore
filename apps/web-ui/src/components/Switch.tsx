import type { ReactNode } from "react";
import styles from "./Switch.module.css";

export interface SwitchProps {
  name: string;
  label: ReactNode;
  detail?: ReactNode;
  defaultChecked: boolean;
  /** What the form posts when on; the browser's "on" when omitted. */
  value?: string;
}

/** A boolean setting drawn as a switch: a real checkbox, so the form posts it unchanged. */
export default function Switch(props: SwitchProps) {
  const { name, label, detail, defaultChecked, value } = props;

  return (
    <label className={styles.row}>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {detail && <span className={styles.detail}>{detail}</span>}
      </span>
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className={styles.control}
      />
    </label>
  );
}

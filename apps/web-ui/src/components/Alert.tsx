// The one way a page shows a passive informational note — the bootstrap-style
// info/secondary alert. `role="status"` (polite), not `role="alert"`: these
// notes are ambient context, never a failed action (that's FormError's job).
import type { ReactNode } from "react";
import styles from "./Alert.module.scss";

export function Alert({
  variant = "info",
  children,
}: {
  variant?: "info" | "secondary";
  children: ReactNode;
}) {
  return (
    <p role="status" className={`${styles.alert} ${styles[variant]}`}>
      {children}
    </p>
  );
}

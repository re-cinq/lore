// Passive info alert; role="status" not "alert" — ambient context, never a failed action (see FormError).
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

// Passive info alert; role="status" not "alert" — ambient context, never a failed action (see FormError). The warning variant is the exception: something failed and the person should know, so it is an alert region led by an icon.
import type { ReactNode } from "react";
import Icon from "@/components/Icon";
import styles from "./Alert.module.scss";

export function Alert({
  variant = "info",
  children,
}: {
  variant?: "info" | "secondary" | "warning";
  children: ReactNode;
}) {
  const isWarning = variant === "warning";

  return (
    <p
      role={isWarning ? "alert" : "status"}
      className={`${styles.alert} ${styles[variant]}`}
    >
      {isWarning && <Icon name="warning" size={16} />}
      {children}
    </p>
  );
}

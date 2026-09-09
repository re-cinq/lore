// role="alert" is the point of sharing this; NOT adopted in FailureBlock (already an alert region), AgentForm (inline spans), or SaveResultBanner (different union).
import styles from "./FormError.module.scss";

export function FormError({
  message,
  className,
}: {
  message?: string | null;
  className?: string;
}) {
  if (!message) {
    return null;
  }

  return (
    <p
      role="alert"
      className={[styles.error, className].filter(Boolean).join(" ")}
    >
      {message}
    </p>
  );
}

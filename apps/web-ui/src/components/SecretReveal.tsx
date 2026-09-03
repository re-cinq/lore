"use client";

import { useState } from "react";
import CopyButton from "./CopyButton";
import styles from "./EnrollmentSection.module.css";
import buttonStyles from "./CopyButton.module.css";

/** Masked by default, so a sensitive value never sits on screen in plaintext until the operator reveals it. */
export default function SecretReveal({
  value,
  label,
}: {
  value: string;
  label?: string;
}) {
  const [shown, setShown] = useState(false);

  return (
    <span className={styles.copyUrl}>
      {label && <span className="meta">{label}:</span>}
      <code className={styles.copyUrlValue}>
        {shown ? value : "•".repeat(Math.min(value.length, 32))}
      </code>
      <button
        type="button"
        className={`btn-secondary ${buttonStyles.button}`}
        onClick={() => setShown((s) => !s)}
      >
        {shown ? "Hide" : "Reveal"}
      </button>
      <CopyButton text={value} />
    </span>
  );
}

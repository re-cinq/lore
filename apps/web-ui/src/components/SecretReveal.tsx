"use client";

import { useState } from "react";
import CopyButton from "./CopyButton";
import styles from "./EnrollmentSection.module.css";
import buttonStyles from "./CopyButton.module.css";

/**
 * Renders a sensitive value (the webhook signing secret) masked by default with
 * a reveal toggle + copy button — so an operator can copy it into GitHub's
 * webhook form without it sitting on screen in plaintext.
 */
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

"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./OnboardedBanner.module.css";

export default function OnboardedBanner({ fullName }: { fullName: string }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return null;
  }

  return (
    <div className={styles.banner} role="status">
      <p className={styles.message}>
        Onboarding started for{" "}
        <Link href={`/repos/${fullName}`}>{fullName}</Link>. Lore is opening the
        onboarding PR on the repo.
      </p>
      <button type="button" onClick={() => setDismissed(true)}>
        Dismiss
      </button>
    </div>
  );
}

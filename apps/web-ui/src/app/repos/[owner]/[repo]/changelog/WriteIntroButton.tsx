"use client";

import { useState } from "react";
import PendingActionButton from "@/components/PendingActionButton";
import styles from "./ChangelogView.module.scss";

export type WriteIntro = (week: string) => Promise<string>;

/** Starts a finished week's introduction again and says what came of it. */
export default function WriteIntroButton(props: {
  week: string;
  writeIntro: WriteIntro;
}) {
  const [said, setSaid] = useState<string | null>(null);

  if (said) {
    return <p className={styles.note}>{said}</p>;
  }

  return (
    <PendingActionButton
      action={async () => setSaid(await props.writeIntro(props.week))}
      text="Write the introduction"
      pendingText="Starting…"
    />
  );
}

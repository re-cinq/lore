"use client";

import ShellDialog from "./ShellDialog";
import { GLOSSARY } from "./shell-content";
import styles from "./ShellLists.module.css";

/** Lore's own vocabulary, opened from the sidebar's Glossary button. */
export default function GlossaryDialog({ onClose }: { onClose: () => void }) {
  return (
    <ShellDialog title="Glossary" onClose={onClose} size="wide">
      <dl className={styles.list}>
        {GLOSSARY.map(({ term, definition }) => (
          <div key={term} className={styles.entry}>
            <dt className={styles.term}>{term}</dt>
            <dd className={styles.definition}>{definition}</dd>
          </div>
        ))}
      </dl>
    </ShellDialog>
  );
}

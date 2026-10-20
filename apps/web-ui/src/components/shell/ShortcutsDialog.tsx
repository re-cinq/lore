"use client";

import ShellDialog, { Kbd } from "./ShellDialog";
import { SHORTCUTS } from "./shell-content";
import styles from "./ShellLists.module.css";

/** Every key the frame answers, opened with `?` or the sidebar's Shortcuts button. */
export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <ShellDialog title="Keyboard shortcuts" onClose={onClose}>
      <ul className={styles.list}>
        {SHORTCUTS.map(({ keys, description }) => (
          <li key={keys.join("+")} className={styles.shortcut}>
            <span>{description}</span>
            <span className={styles.keys}>
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </ShellDialog>
  );
}

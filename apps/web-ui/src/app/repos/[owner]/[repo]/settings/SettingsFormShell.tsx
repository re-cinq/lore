"use client";
import { useActionState, type ReactNode } from "react";
import SaveResultBanner, {
  INITIAL_SAVE_STATE,
  type SaveState,
} from "./SaveResultBanner";
import styles from "./page.module.css";

export type SaveAction = (
  prev: SaveState,
  formData: FormData,
) => Promise<SaveState>;

export interface SettingsFormShellProps {
  fullName: string;
  title: ReactNode;
  help: ReactNode;
  lede: ReactNode;
  saveAction: SaveAction;
  children: ReactNode;
}

/** The chrome every per-repo settings tab wears: title row with its help popover, lede, the save-result banner, and the form carrying the repo the action saves against. */
export default function SettingsFormShell(props: SettingsFormShellProps) {
  const { fullName, title, help, lede, saveAction, children } = props;
  const [state, formAction] = useActionState(saveAction, INITIAL_SAVE_STATE);

  return (
    <div>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>{title}</h2>
        {help}
      </div>
      <p className={`meta ${styles.lede}`}>{lede}</p>

      <SaveResultBanner state={state} />

      <form action={formAction} className={`task-form ${styles.form}`}>
        <input type="hidden" name="full_name" value={fullName} />
        {children}
      </form>
    </div>
  );
}

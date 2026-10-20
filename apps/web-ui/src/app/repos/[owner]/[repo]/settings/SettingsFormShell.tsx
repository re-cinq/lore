"use client";
import { useActionState, type ReactNode } from "react";
import SettingsLayout, {
  type SettingsNavItem,
} from "@/components/SettingsLayout";
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
  /** The sub-navigation, one entry per section card. */
  nav: SettingsNavItem[];
  saveAction: SaveAction;
  children: ReactNode;
}

/** The chrome every per-repo settings tab wears: title row with its help popover, lede, the save-result banner, and one form spanning every section card. */
export default function SettingsFormShell(props: SettingsFormShellProps) {
  const { fullName, nav, saveAction, children } = props;
  const [state, formAction] = useActionState(saveAction, INITIAL_SAVE_STATE);

  return (
    <div>
      <ShellHeading {...props} />
      <SaveResultBanner state={state} />
      <form action={formAction} className={`task-form ${styles.form}`}>
        <input type="hidden" name="full_name" value={fullName} />
        <SettingsLayout nav={nav}>{children}</SettingsLayout>
      </form>
    </div>
  );
}

function ShellHeading({ title, help, lede }: SettingsFormShellProps) {
  return (
    <>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>{title}</h2>
        {help}
      </div>
      <p className={styles.lede}>{lede}</p>
    </>
  );
}

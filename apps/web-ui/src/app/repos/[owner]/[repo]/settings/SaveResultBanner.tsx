import styles from "./page.module.css";

export interface SaveState {
  saved: boolean;
}

export const INITIAL_SAVE_STATE: SaveState = { saved: false };

export default function SaveResultBanner({ state }: { state: SaveState }) {
  if (!state.saved) {
    return null;
  }

  return (
    <div className={styles.banner} role="status">
      <p className={styles.savedOk}>Settings saved.</p>
    </div>
  );
}

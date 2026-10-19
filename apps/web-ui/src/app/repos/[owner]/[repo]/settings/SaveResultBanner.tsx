import styles from "./page.module.css";

export interface SaveState {
  saved: boolean;
  error?: string;
}

export const INITIAL_SAVE_STATE: SaveState = { saved: false };

export default function SaveResultBanner({ state }: { state: SaveState }) {
  if (state.error) {
    return (
      <div className={styles.banner} role="alert">
        <p className={styles.warn}>{state.error}</p>
      </div>
    );
  }

  if (!state.saved) {
    return null;
  }

  return (
    <div className={styles.banner} role="status">
      <p className={styles.savedOk}>Settings saved.</p>
    </div>
  );
}

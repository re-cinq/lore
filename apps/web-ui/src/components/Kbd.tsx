import type { ReactNode } from "react";
import styles from "./Kbd.module.css";

/** A key cap, as the shortcuts list and the palette draw them. */
export default function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={styles.key}>{children}</kbd>;
}

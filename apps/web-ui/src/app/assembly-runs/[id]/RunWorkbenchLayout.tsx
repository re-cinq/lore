// The run workbench (run-viz FR4.14): the graph on the left, the inspector beside it and always in view, everything run-wide below. Pure layout — it owns no state and reads nothing.
import type { ReactNode } from "react";
import styles from "./RunVisualizationPanel.module.css";

export interface RunWorkbenchLayoutProps {
  graph: ReactNode;
  inspector: ReactNode;
  below: ReactNode;
}

export function RunWorkbenchLayout({
  graph,
  inspector,
  below,
}: RunWorkbenchLayoutProps) {
  return (
    <>
      <div className={styles.workbench}>
        <div className={styles.graphColumn}>{graph}</div>
        <aside className={styles.sidebar} aria-label="Selected node">
          {inspector}
        </aside>
      </div>
      {below}
    </>
  );
}

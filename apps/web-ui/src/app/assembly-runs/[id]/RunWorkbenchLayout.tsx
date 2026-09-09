// The run workbench (run-viz FR4.14): the graph, the inspector for the selected node directly under it, then everything run-wide. Pure layout — it owns no state and reads nothing.
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
        {graph}
        <section className={styles.inspectorRegion} aria-label="Selected node">
          {inspector}
        </section>
      </div>
      {below}
    </>
  );
}

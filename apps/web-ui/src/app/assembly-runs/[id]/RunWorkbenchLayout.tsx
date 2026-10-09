// The run workbench (run-viz FR4.14): the graph with the attempt column under it, the selected node's detail panel beside both with a draggable edge, then everything run-wide. Pure layout — it owns no state and reads nothing.
import type { ReactNode } from "react";
import { PANEL_WIDTH } from "./resizable-panel";
import { ResizeHandle } from "./ResizeHandle";
import styles from "./RunVisualizationPanel.module.css";

export interface RunWorkbenchLayoutProps {
  graph: ReactNode;
  center: ReactNode;
  side: ReactNode;
  below: ReactNode;
  sideWidth: number;
  onResizeSide: (width: number) => void;
}

export function RunWorkbenchLayout(props: RunWorkbenchLayoutProps) {
  const { graph, center, below, sideWidth } = props;

  return (
    <>
      <div
        className={styles.workbench}
        style={{ ["--inspector-width" as string]: `${sideWidth}px` }}
      >
        <div className={styles.graphCell}>{graph}</div>
        <div className={styles.centerCell}>{center}</div>
        <SidePanel {...props} />
      </div>
      {below}
    </>
  );
}

/** The handle and the panel it sizes: the panel's left edge is the handle. */
function SidePanel({ side, sideWidth, onResizeSide }: RunWorkbenchLayoutProps) {
  return (
    <>
      <ResizeHandle
        width={sideWidth}
        bounds={PANEL_WIDTH}
        onResize={onResizeSide}
      />
      <aside className={styles.sideRegion} aria-label="Selected node">
        {side}
      </aside>
    </>
  );
}

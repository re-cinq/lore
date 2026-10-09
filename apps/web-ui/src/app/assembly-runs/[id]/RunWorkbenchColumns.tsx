// The workbench's two filled columns (run-viz FR4.14). Beside the graph: the selected node's detail card, then what the run touched, because both are about reading the run from the side. Under it: the run's facts, the diff a touched file opens, the attempt on show and the task's accounting, since all of them need the width. Pure render.
import type { ReactNode } from "react";
import FileDiffDrawer, { type FileDiffDrawerProps } from "./FileDiffDrawer";
import FileHeatmapView, { type FileHeatmapViewProps } from "./FileHeatmapView";
import {
  NodeInspectorPanel,
  type NodeInspectorPanelProps,
} from "./NodeInspectorPanel";
import {
  AttemptInspector,
  type AttemptInspectorProps,
} from "./AttemptInspector";

interface SideColumnProps {
  inspector: NodeInspectorPanelProps;
  files: FileHeatmapViewProps;
}

export function SideColumn({ inspector, files }: SideColumnProps) {
  return (
    <>
      <NodeInspectorPanel {...inspector} />
      <FileHeatmapView {...files} />
    </>
  );
}

interface CenterColumnProps {
  /** The run's facts card, directly under the graph. */
  facts: ReactNode;
  diff: FileDiffDrawerProps;
  attempts: AttemptInspectorProps;
  /** The task's cost table, or the note that a run has none, after everything about the attempt. */
  taskContext: ReactNode;
}

export function CenterColumn(props: CenterColumnProps) {
  return (
    <>
      {props.facts}
      <FileDiffDrawer {...props.diff} />
      <AttemptInspector {...props.attempts} />
      {props.taskContext}
    </>
  );
}

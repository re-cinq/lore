// The workbench's two filled columns (run-viz FR4.14). Beside the graph: the selected node's detail card, then what the run touched, because both are about reading the run from the side. Under it: the diff a touched file opens, then the attempt on show, since both need the width. Pure render.
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
  diff: FileDiffDrawerProps;
  attempts: AttemptInspectorProps;
}

export function CenterColumn({ diff, attempts }: CenterColumnProps) {
  return (
    <>
      <FileDiffDrawer {...diff} />
      <AttemptInspector {...attempts} />
    </>
  );
}

"use client";

// The files strip below the graph: the heatmap and the diff drawer a bar opens. Owns only which file is open; the panel above owns the touches.
import { useCallback, useState } from "react";
import type { TouchCounts } from "@/lib/file-heatmap";
import FileDiffDrawer from "./FileDiffDrawer";
import FileHeatmapView from "./FileHeatmapView";

/** Which touched file's diff is open. Viewer state, not run state: it survives every live event. */
function useDiffDrawer() {
  const [openDiffPath, setOpenDiffPath] = useState<string | null>(null);
  const openDiff = useCallback((path: string) => setOpenDiffPath(path), []);
  const closeDiff = useCallback(() => setOpenDiffPath(null), []);

  return { openDiffPath, openDiff, closeDiff };
}

export interface RunFilesSectionProps {
  touches: Record<string, TouchCounts>;
  showAll: boolean;
  onToggleShowAll: () => void;
  runId: string;
  prNumber: number | null;
}

export function RunFilesSection(props: RunFilesSectionProps) {
  const { runId, prNumber, ...heatmap } = props;
  const drawer = useDiffDrawer();

  return (
    <>
      <FileHeatmapView
        {...heatmap}
        onOpenFile={drawer.openDiff}
        activePath={drawer.openDiffPath}
      />
      <FileDiffDrawer
        runId={runId}
        path={drawer.openDiffPath}
        prNumber={prNumber}
        onClose={drawer.closeDiff}
      />
    </>
  );
}

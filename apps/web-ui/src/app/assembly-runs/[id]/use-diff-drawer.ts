// Which touched file's diff is open (run-viz FR8.6). Viewer state, not run state: it survives every live event. The Files touched card in the side panel opens it and the drawer in the center column shows it, so the panel above both owns it.
import { useCallback, useState } from "react";

export function useDiffDrawer() {
  const [openDiffPath, setOpenDiffPath] = useState<string | null>(null);
  const openDiff = useCallback((path: string) => setOpenDiffPath(path), []);
  const closeDiff = useCallback(() => setOpenDiffPath(null), []);

  return { openDiffPath, openDiff, closeDiff };
}

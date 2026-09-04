import { nodeMatchesQuery } from "@/lib/graph-search";
import {
  FADED,
  LEVEL_OPACITY,
  levelPairOpacity,
  type SimNode,
} from "./spec-graph-visual";

/** Focus (BFS-distance-from-selection) + live search opacity — shared by the SVG skeleton and the canvas draw. */

export interface FocusState {
  nodeOpacity: (id: string) => number;
  edgeOpacity: (sourceId: string, targetId: string) => number;
  setFocusLevels: (levels: Map<string, number> | null) => void;
  setSearchTerm: (term: string) => void;
}

export function createFocusState(
  getNodeById: () => Map<string, SimNode>,
): FocusState {
  let focusLevels: Map<string, number> | null = null;
  let searchTerm = "";

  const matchesSearch = (id: string) => {
    const n = getNodeById().get(id);

    return n ? nodeMatchesQuery(n, searchTerm) : false;
  };

  const nodeOpacity = (id: string): number => {
    if (searchTerm.trim()) {
      return matchesSearch(id) ? 1 : FADED;
    }

    if (!focusLevels) {
      return 1;
    }
    const lv = focusLevels.get(id);

    return lv === undefined ? FADED : (LEVEL_OPACITY[lv] ?? FADED);
  };

  const edgeOpacity = (sourceId: string, targetId: string): number => {
    if (searchTerm.trim()) {
      return matchesSearch(sourceId) && matchesSearch(targetId) ? 0.5 : FADED;
    }

    if (!focusLevels) {
      return 0.5;
    }

    return levelPairOpacity(
      focusLevels.get(sourceId),
      focusLevels.get(targetId),
    );
  };

  return {
    nodeOpacity,
    edgeOpacity,
    setFocusLevels: (levels) => {
      focusLevels = levels;
    },
    setSearchTerm: (term) => {
      searchTerm = term;
    },
  };
}

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

/** Search wins over focus: while a query is active, everything not matching fades regardless of what is focused, because the reader is asking a different question. */
function searchOpacity(matches: boolean, full: number): number {
  return matches ? full : FADED;
}

/** A node's opacity by focus level. With no focus set everything is fully visible; a node the focus walk never reached is faded rather than hidden, so the graph keeps its shape. */
function levelOpacity(
  focusLevels: Map<string, number> | null,
  id: string,
): number {
  if (!focusLevels) {
    return 1;
  }
  const level = focusLevels.get(id);

  return level === undefined ? FADED : (LEVEL_OPACITY[level] ?? FADED);
}

/** An edge's opacity, from the levels of BOTH endpoints — an edge is only as prominent as its dimmer end. */
function edgeLevelOpacity(
  focusLevels: Map<string, number> | null,
  sourceId: string,
  targetId: string,
): number {
  if (!focusLevels) {
    return 0.5;
  }

  return levelPairOpacity(focusLevels.get(sourceId), focusLevels.get(targetId));
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

  const nodeOpacity = (id: string): number =>
    searchTerm.trim()
      ? searchOpacity(matchesSearch(id), 1)
      : levelOpacity(focusLevels, id);
  const edgeOpacity = (sourceId: string, targetId: string): number =>
    searchTerm.trim()
      ? searchOpacity(matchesSearch(sourceId) && matchesSearch(targetId), 0.5)
      : edgeLevelOpacity(focusLevels, sourceId, targetId);

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

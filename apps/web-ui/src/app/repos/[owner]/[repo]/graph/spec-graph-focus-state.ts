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

/** The mutable half of a focus state: the two settings the setters write and every opacity read consults. */
interface FocusVars {
  focusLevels: Map<string, number> | null;
  searchTerm: string;
}

type SearchMatcher = (id: string) => boolean;

/** Does this node id match the live query? Reads the node fresh each call, because expand/collapse replaces the map. */
function createMatcher(
  getNodeById: () => Map<string, SimNode>,
  vars: FocusVars,
): SearchMatcher {
  return (id) => {
    const node = getNodeById().get(id);

    return node ? nodeMatchesQuery(node, vars.searchTerm) : false;
  };
}

/** Search wins over focus: while a query is active, everything not matching fades regardless of what is focused, because the reader is asking a different question. */
function nodeOpacityOf(
  vars: FocusVars,
  matchesSearch: SearchMatcher,
  id: string,
): number {
  if (!vars.searchTerm.trim()) {
    return levelOpacity(vars.focusLevels, id);
  }

  return matchesSearch(id) ? 1 : FADED;
}

function edgeOpacityOf(
  vars: FocusVars,
  matchesSearch: SearchMatcher,
  sourceId: string,
  targetId: string,
): number {
  if (!vars.searchTerm.trim()) {
    return edgeLevelOpacity(vars.focusLevels, sourceId, targetId);
  }

  return matchesSearch(sourceId) && matchesSearch(targetId) ? 0.5 : FADED;
}

export function createFocusState(
  getNodeById: () => Map<string, SimNode>,
): FocusState {
  const vars: FocusVars = { focusLevels: null, searchTerm: "" };
  const matchesSearch = createMatcher(getNodeById, vars);

  return {
    nodeOpacity: (id) => nodeOpacityOf(vars, matchesSearch, id),
    edgeOpacity: (sourceId, targetId) =>
      edgeOpacityOf(vars, matchesSearch, sourceId, targetId),
    setFocusLevels: (levels) => {
      vars.focusLevels = levels;
    },
    setSearchTerm: (term) => {
      vars.searchTerm = term;
    },
  };
}

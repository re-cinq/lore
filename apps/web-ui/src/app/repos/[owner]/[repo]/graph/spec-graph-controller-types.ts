import type * as d3 from "d3";
import type { SpecGraphNode } from "@/lib/spec-graph";
import type { Disc } from "@/lib/ring-exclusion";
import type { SimNode, SimLink } from "./spec-graph-visual";
import type { ExpandData } from "./spec-graph-ring-layout";
import type { Point } from "./spec-graph-seed-layout";
import type { CanvasDrawState } from "./spec-graph-canvas-draw";
import type { FocusState } from "./spec-graph-focus-state";

/** The one mutable object every controller function (render, interaction, tick) reads and writes — replaces the closures the original single effect used, so the logic can live in more than one file without losing shared state. */
export interface GraphController {
  el: SVGSVGElement;
  canvas: HTMLCanvasElement;
  repo: string;
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  container: d3.Selection<SVGGElement, unknown, null, undefined>;
  ringG: d3.Selection<SVGGElement, unknown, null, undefined>;
  nodeG: d3.Selection<SVGGElement, unknown, null, undefined>;

  nodes: SimNode[];
  links: SimLink[];
  expanded: Map<string, ExpandData>;
  adj: Map<string, Set<string>>;
  nodeById: Map<string, SimNode>;
  ringPinned: Set<string>;
  ringDiscs: Disc[];
  aggHidden: Set<string>;
  forest: Map<string, string>;

  boundR: number;
  seedOf: (d: SimNode) => Point;
  viewportCenter: Point;
  degOf: (node: string | number | SimNode) => number;

  sim: d3.Simulation<SimNode, undefined>;
  linkForce: d3.ForceLink<SimNode, SimLink>;
  zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;

  focus: FocusState;
  drawer: { draw: (state: CanvasDrawState) => void };
  transform: d3.ZoomTransform;
  width: number;
  height: number;

  selectedIdRef: { current: string | null };
  setSelected: (n: SpecGraphNode | null) => void;
  setHover: (h: { text: string; x: number; y: number } | null) => void;
  setCrossings: (n: number | null) => void;
  saveState: () => void;
}

/** The canvas-draw snapshot for the controller's current mutable state. */
export function drawState(c: GraphController): CanvasDrawState {
  return {
    transform: c.transform,
    nodes: c.nodes,
    links: c.links,
    ringDiscs: c.ringDiscs,
    ringPinned: c.ringPinned,
    nodeById: c.nodeById,
    nodeOpacity: c.focus.nodeOpacity,
    edgeOpacity: c.focus.edgeOpacity,
  };
}

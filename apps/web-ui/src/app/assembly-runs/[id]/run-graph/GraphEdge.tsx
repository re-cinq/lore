// One connector between two steps. Its tone carries the branch's meaning — a
// plain executed hop is neutral gray and unlabelled — and in a run the hop the
// walk took is drawn bold while the road not (yet) travelled fades back.

import type { LayoutEdge } from "@/lib/dag-layout";
import type { ConnectorTone } from "@/lib/graph-view-model";
import { ARROW_MARKER_URL } from "./ArrowMarkerDefs";
import { edgeMapKey } from "./run-graph-geometry";
import { classes, edgeStrokeClass } from "./run-graph-tone-classes";
import styles from "./run-graph.module.css";

export interface GraphEdgeProps {
  edge: LayoutEdge;
  tone: ConnectorTone;
  /** Whether the walk traversed this hop; undefined when no run is being shown. */
  taken?: boolean;
}

export default function GraphEdge({ edge, tone, taken }: GraphEdgeProps) {
  return (
    <path
      className={classes(
        styles.edge,
        styles[edge.kind],
        edgeStrokeClass(tone),
        taken === true ? styles.taken : undefined,
        taken === false ? styles.dim : undefined,
      )}
      data-edge={edgeMapKey(edge.from, edge.to)}
      data-tone={tone}
      data-taken={taken === undefined ? undefined : String(taken)}
      d={edge.d}
      markerEnd={ARROW_MARKER_URL}
    />
  );
}

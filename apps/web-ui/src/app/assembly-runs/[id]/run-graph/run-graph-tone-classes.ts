// Tone → CSS class, in one place. Every graph part reads its colors from here,
// so an edge stroke, a status glyph and a label can never disagree about what
// "warn" looks like. The maps are total over GraphTone: a missing key used to
// mean a silently uncolored label.

import type { ConnectorTone } from "@/lib/graph-view-model";
import type { NodeStatusTone } from "@/lib/run-node-status";
import styles from "./run-graph.module.css";

/** Every tone the graph can draw — a node's run status or a connector's verdict. */
export type GraphTone = NodeStatusTone | ConnectorTone;

const EDGE_STROKE: Record<ConnectorTone, string> = {
  ok: styles.toneOk,
  warn: styles.toneWarn,
  err: styles.toneErr,
  neutral: styles.toneNeutral,
};

const TEXT_FILL: Record<GraphTone, string> = {
  ok: styles.outOk,
  warn: styles.outWarn,
  err: styles.outErr,
  running: styles.outInfo,
  waiting: styles.outWarn,
  idle: styles.outNeutral,
  neutral: styles.outNeutral,
};

const ICON_FILL: Record<GraphTone, string> = {
  ok: styles.iconOk,
  warn: styles.iconWarn,
  err: styles.iconErr,
  running: styles.iconRunning,
  waiting: styles.iconWaiting,
  idle: styles.iconIdle,
  neutral: styles.iconIdle,
};

/** Join class names, dropping the ones a CSS module does not define (`.forward`
 *  has no rule, so `styles.forward` is undefined). */
export function classes(...names: (string | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

export function edgeStrokeClass(tone: ConnectorTone): string {
  return EDGE_STROKE[tone];
}

export function textFillClass(tone: GraphTone): string {
  return TEXT_FILL[tone];
}

export function iconFillClass(tone: GraphTone): string {
  return ICON_FILL[tone];
}

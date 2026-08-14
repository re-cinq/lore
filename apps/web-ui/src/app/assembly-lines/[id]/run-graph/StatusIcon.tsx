// A small circular status glyph — check / dash / cross / pause / dot — drawn at
// any radius. Every state a node or an outcome can be in reads from its shape,
// so meaning never rests on color alone.

import { iconFillClass, type GraphTone } from "./run-graph-tone-classes";
import styles from "./run-graph.module.css";

/** The stroked mark inside the disc, as a function of the disc's centre and its
 *  scale (1 at the base radius of 8). `running` and `idle` carry no mark. */
const GLYPH_PATH: Partial<
  Record<GraphTone, (cx: number, cy: number, s: number) => string>
> = {
  ok: (cx, cy, s) =>
    `M ${cx - 3.6 * s} ${cy + 0.3 * s} L ${cx - 1.2 * s} ${cy + 2.8 * s} L ${cx + 3.8 * s} ${cy - 3 * s}`,
  err: (cx, cy, s) =>
    `M ${cx - 2.8 * s} ${cy - 2.8 * s} L ${cx + 2.8 * s} ${cy + 2.8 * s} M ${cx + 2.8 * s} ${cy - 2.8 * s} L ${cx - 2.8 * s} ${cy + 2.8 * s}`,
  warn: (cx, cy, s) => `M ${cx - 3.2 * s} ${cy} L ${cx + 3.2 * s} ${cy}`,
  // Pause bars: the walk is held here, not working.
  waiting: (cx, cy, s) =>
    `M ${cx - 1.6 * s} ${cy - 2.6 * s} L ${cx - 1.6 * s} ${cy + 2.6 * s} M ${cx + 1.6 * s} ${cy - 2.6 * s} L ${cx + 1.6 * s} ${cy + 2.6 * s}`,
};

export interface StatusIconProps {
  tone: GraphTone;
  cx: number;
  cy: number;
  r?: number;
}

export default function StatusIcon({ tone, cx, cy, r = 8 }: StatusIconProps) {
  const scale = r / 8;
  const glyph = GLYPH_PATH[tone];

  return (
    <g aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} className={iconFillClass(tone)} />
      {glyph ? (
        <path className={styles.iconGlyph} d={glyph(cx, cy, scale)} />
      ) : null}
      {tone === "running" ? (
        <circle cx={cx} cy={cy} r={2.4 * scale} className={styles.iconInner} />
      ) : null}
    </g>
  );
}

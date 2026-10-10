// The step-type mark in a node's top-left corner and in the legend (run-viz FR4.1h): a shape per family, so type reads without colour too, in the family's colour.
import type { NodeTypeFamily } from "@/lib/node-type-family";
import styles from "./run-graph.module.css";

// Each mark drawn around its centre at scale 1 for a 10px glyph.
const GLYPH_PATH: Record<NodeTypeFamily, (cx: number, cy: number) => string> = {
  // A four-point spark: the work is a model's.
  agent: (cx, cy) =>
    `M ${cx} ${cy - 5} Q ${cx} ${cy} ${cx + 5} ${cy} Q ${cx} ${cy} ${cx} ${cy + 5} Q ${cx} ${cy} ${cx - 5} ${cy} Q ${cx} ${cy} ${cx} ${cy - 5} Z`,
  // A square: a machine step.
  service: (cx, cy) =>
    `M ${cx - 4} ${cy - 4} L ${cx + 4} ${cy - 4} L ${cx + 4} ${cy + 4} L ${cx - 4} ${cy + 4} Z`,
  // A head and shoulders: it waits on a person.
  person: (cx, cy) =>
    `M ${cx - 2.5} ${cy - 2.5} A 2.5 2.5 0 1 1 ${cx + 2.5} ${cy - 2.5} A 2.5 2.5 0 1 1 ${cx - 2.5} ${cy - 2.5} Z M ${cx - 5} ${cy + 5} Q ${cx} ${cy - 1} ${cx + 5} ${cy + 5} Z`,
  // A diamond: a point in the line with no work of its own.
  marker: (cx, cy) =>
    `M ${cx} ${cy - 5} L ${cx + 5} ${cy} L ${cx} ${cy + 5} L ${cx - 5} ${cy} Z`,
};

export const FAMILY_CLASS: Record<NodeTypeFamily, string> = {
  agent: styles.familyAgent,
  service: styles.familyService,
  person: styles.familyPerson,
  marker: styles.familyMarker,
};

interface TypeGlyphProps {
  family: NodeTypeFamily;
  cx: number;
  cy: number;
}

export default function TypeGlyph({ family, cx, cy }: TypeGlyphProps) {
  return (
    <path
      aria-hidden="true"
      className={`${styles.typeGlyph} ${FAMILY_CLASS[family]}`}
      d={GLYPH_PATH[family](cx, cy)}
    />
  );
}

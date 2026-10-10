// Under the graph: what each step-type mark means, for the families this line has (run-viz FR4.1h).
import type { NodeTypeFamily } from "@/lib/node-type-family";
import TypeGlyph, { FAMILY_CLASS } from "./TypeGlyph";
import styles from "./run-graph.module.css";

const FAMILY_ORDER: readonly NodeTypeFamily[] = [
  "agent",
  "service",
  "person",
  "marker",
];

const FAMILY_LABEL: Record<NodeTypeFamily, string> = {
  agent: "Agent",
  service: "Service",
  person: "Person",
  marker: "Marker",
};

export default function RunGraphLegend({
  families,
}: {
  families: ReadonlySet<NodeTypeFamily>;
}) {
  return (
    <ul className={styles.legend} aria-label="Step types">
      {FAMILY_ORDER.filter((family) => families.has(family)).map((family) => (
        <li key={family} className={styles.legendItem}>
          <LegendSwatch family={family} />
          {FAMILY_LABEL[family]}
        </li>
      ))}
    </ul>
  );
}

const SWATCH_BOX = { x: 1, y: 1, width: 16, height: 12, rx: 3 };

/** A small box in the family's colours with its mark, as a node of this family is drawn. */
function LegendSwatch({ family }: { family: NodeTypeFamily }) {
  return (
    <svg
      className={styles.legendSwatch}
      width="18"
      height="14"
      viewBox="0 0 18 14"
      aria-hidden="true"
    >
      <g className={FAMILY_CLASS[family]}>
        <rect className={styles.legendBox} {...SWATCH_BOX} />
        <TypeGlyph family={family} cx={9} cy={7} />
      </g>
    </svg>
  );
}

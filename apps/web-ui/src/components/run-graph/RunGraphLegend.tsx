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

const SWATCH_STRIPE = { x: 0, y: 1, width: 3, height: 12, rx: 1.5 };

/** The stripe and the mark a node of this family wears, side by side. */
function LegendSwatch({ family }: { family: NodeTypeFamily }) {
  return (
    <svg
      className={styles.legendSwatch}
      width="18"
      height="14"
      viewBox="0 0 18 14"
      aria-hidden="true"
    >
      <rect
        className={`${styles.typeStripe} ${FAMILY_CLASS[family]}`}
        {...SWATCH_STRIPE}
      />
      <TypeGlyph family={family} cx={11} cy={7} />
    </svg>
  );
}

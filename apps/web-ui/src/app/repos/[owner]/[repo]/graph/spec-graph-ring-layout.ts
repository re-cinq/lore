import * as d3 from "d3";
import type { SpecRing, RingSection, RingStatement } from "@/lib/spec-graph";
import { RADIUS } from "./spec-graph-visual";

/** Lays out a spec's two rings (section arcs + per-statement arcs) for the expand-on-double-click view. */

export interface SectionArc {
  uid: string;
  heading: string;
  total: number;
  tested: number;
  d: string;
}
export interface StatementArc {
  uid: string;
  tested: boolean;
  text: string;
  mid: number;
  d: string;
}
export interface ExpandData {
  specPath: string;
  outerMid: number;
  outerR1: number;
  sections: SectionArc[];
  statements: StatementArc[];
}

function groupStatementsBySection(
  statements: RingStatement[],
): Map<string, RingStatement[]> {
  const bySec = new Map<string, RingStatement[]>();

  for (const st of statements) {
    const list = bySec.get(st.sectionUid);

    if (list) {
      list.push(st);
      continue;
    }

    bySec.set(st.sectionUid, [st]);
  }

  return bySec;
}

interface StatementArcLayout {
  span: Map<string, { a0: number; a1: number }>;
  bySec: Map<string, RingStatement[]>;
  arc: d3.Arc<unknown, d3.DefaultArcObject>;
  outerR0: number;
  outerR1: number;
}

/** One section's statement arcs, spread evenly across the angle span its section arc already claimed. */
function statementArcsForSection(
  sec: RingSection,
  layout: StatementArcLayout,
): StatementArc[] {
  const { span, bySec, arc, outerR0, outerR1 } = layout;
  const sp = span.get(sec.uid);
  const sts = bySec.get(sec.uid) ?? [];

  if (!sp || sts.length === 0) {
    return [];
  }

  const w = (sp.a1 - sp.a0) / sts.length;

  return sts.map((st, i) => {
    const a0 = sp.a0 + i * w;
    const a1 = a0 + w;

    return {
      uid: st.uid,
      tested: st.tested,
      text: st.text,
      mid: (a0 + a1) / 2,
      d:
        arc({
          innerRadius: outerR0,
          outerRadius: outerR1,
          startAngle: a0 + 0.004,
          endAngle: a1 - 0.004,
        }) ?? "",
    };
  });
}

/** The four radii the ring is drawn between. The outer radius GROWS with statement count, clamped to 64–150: a spec with many statements needs each arc to stay wide enough to click, and one with few should not draw a ring larger than the node it surrounds. */
function ringRadii(statementCount: number) {
  const outerR0 = Math.max(
    64,
    Math.min(150, (Math.max(statementCount, 1) * 11) / (Math.PI * 2)),
  );
  const innerR1 = outerR0 - 4;

  return {
    outerR0,
    outerR1: outerR0 + 13,
    innerR1,
    innerR0: Math.max(RADIUS.Spec + 6, innerR1 - 16),
  };
}

/** One inner arc per section, sized by how many statements it holds. The `+ 1.2` floor gives an empty section a visible slice — a heading that exists but has nothing under it is still something the reader should see. Records each section's angular span, which the statement arcs then subdivide. */
function sectionArcs(
  ringSections: RingSection[],
  span: Map<string, { a0: number; a1: number }>,
  arc: d3.Arc<unknown, d3.DefaultArcObject>,
  { innerR0, innerR1 }: { innerR0: number; innerR1: number },
): SectionArc[] {
  const pie = d3
    .pie<RingSection>()
    .sort(null)
    .value((s) => s.total + 1.2)(ringSections);

  return pie.map((slice) => {
    span.set(slice.data.uid, { a0: slice.startAngle, a1: slice.endAngle });

    return {
      uid: slice.data.uid,
      heading: slice.data.heading,
      total: slice.data.total,
      tested: slice.data.tested,
      d:
        arc({
          innerRadius: innerR0,
          outerRadius: innerR1,
          startAngle: slice.startAngle,
          endAngle: slice.endAngle,
        }) ?? "",
    };
  });
}

export function computeRing(specPath: string, ring: SpecRing): ExpandData {
  const { innerR0, innerR1, outerR0, outerR1 } = ringRadii(
    ring.statements.length,
  );
  const arc = d3.arc();
  const span = new Map<string, { a0: number; a1: number }>();
  const sections = sectionArcs(ring.sections, span, arc, {
    innerR0,
    innerR1,
  });
  const bySec = groupStatementsBySection(ring.statements);
  const statements: StatementArc[] = ring.sections.flatMap((sec) =>
    statementArcsForSection(sec, { span, bySec, arc, outerR0, outerR1 }),
  );

  return {
    specPath,
    outerMid: (outerR0 + outerR1) / 2,
    outerR1,
    sections,
    statements,
  };
}

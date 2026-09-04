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

export function computeRing(specPath: string, ring: SpecRing): ExpandData {
  const TWO_PI = Math.PI * 2;
  const nSt = Math.max(ring.statements.length, 1);
  // Grow the radius with statement count so each outer arc stays clickable.
  const outerR0 = Math.max(64, Math.min(150, (nSt * 11) / TWO_PI));
  const innerR1 = outerR0 - 4;
  const innerR0 = Math.max(RADIUS.Spec + 6, innerR1 - 16);
  const outerR1 = outerR0 + 13;
  const arc = d3.arc();

  const span = new Map<string, { a0: number; a1: number }>();
  const pie = d3
    .pie<RingSection>()
    .sort(null)
    .value((s) => s.total + 1.2)(ring.sections);
  const sections: SectionArc[] = pie.map((p) => {
    span.set(p.data.uid, { a0: p.startAngle, a1: p.endAngle });

    return {
      uid: p.data.uid,
      heading: p.data.heading,
      total: p.data.total,
      tested: p.data.tested,
      d:
        arc({
          innerRadius: innerR0,
          outerRadius: innerR1,
          startAngle: p.startAngle,
          endAngle: p.endAngle,
        }) ?? "",
    };
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

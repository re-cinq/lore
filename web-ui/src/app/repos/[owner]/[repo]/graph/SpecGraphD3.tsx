'use client';

import { memo, useEffect, useRef, useState } from 'react';
import TestPreview from './TestPreview';
import * as d3 from 'd3';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { SpecGraph, SpecGraphNode, SpecRing, RingSection, RingStatement } from '@/lib/spec-graph';
import { resolveExclusion, type Disc } from '@/lib/ring-exclusion';
import { visibleSegments } from '@/lib/segment-clip';
import { resolveSpacing, type Anchor } from '@/lib/anchor-spacing';
import { captureGraphState, applyGraphState, serializeGraphState, parseGraphState } from '@/lib/graph-persistence';

const RING_CLEARANCE = 24; // keep non-ring nodes this far outside every open ring
const ANCHOR_SEPARATION = 80; // min center distance between Spec/ADR nodes (and off rings)

type SimNode = SpecGraphNode & d3.SimulationNodeDatum;
type SimLink = d3.SimulationLinkDatum<SimNode> & { kind: string };

const TESTED_FILL = '#16a34a';
const UNTESTED_FILL = '#dc2626';
const coverageTint = d3.interpolateRgb(UNTESTED_FILL, TESTED_FILL);

// A spec's expansion: two concentric rings drawn around it — the inner ring is
// its Sections (sized by statement count, tinted by coverage), the outer ring is
// the individual Statements (green = tested, red = untested) grouped per section.
interface SectionArc {
  uid: string;
  heading: string;
  total: number;
  tested: number;
  d: string;
}
interface StatementArc {
  uid: string;
  tested: boolean;
  text: string;
  mid: number;
  d: string;
}
interface ExpandData {
  specPath: string;
  outerMid: number;
  outerR1: number;
  sections: SectionArc[];
  statements: StatementArc[];
}

/** Lays out a spec's two rings: section arcs (inner) + per-statement arcs (outer). */
function computeRing(specPath: string, ring: SpecRing): ExpandData {
  const TWO_PI = Math.PI * 2;
  const nSt = Math.max(ring.statements.length, 1);
  // Grow the radius with statement count so each outer arc stays clickable.
  const outerR0 = Math.max(64, Math.min(150, (nSt * 11) / TWO_PI));
  const innerR1 = outerR0 - 4;
  const innerR0 = Math.max(RADIUS.Spec + 6, innerR1 - 16);
  const outerR1 = outerR0 + 13;
  const arc = d3.arc();

  const span = new Map<string, { a0: number; a1: number }>();
  const pie = d3.pie<RingSection>().sort(null).value((s) => s.total + 1.2)(ring.sections);
  const sections: SectionArc[] = pie.map((p) => {
    span.set(p.data.uid, { a0: p.startAngle, a1: p.endAngle });
    return {
      uid: p.data.uid,
      heading: p.data.heading,
      total: p.data.total,
      tested: p.data.tested,
      d: arc({ innerRadius: innerR0, outerRadius: innerR1, startAngle: p.startAngle, endAngle: p.endAngle }) ?? '',
    };
  });

  const bySec = new Map<string, RingStatement[]>();
  for (const st of ring.statements) (bySec.get(st.sectionUid) ?? bySec.set(st.sectionUid, []).get(st.sectionUid)!).push(st);

  const statements: StatementArc[] = [];
  for (const sec of ring.sections) {
    const sp = span.get(sec.uid);
    const sts = bySec.get(sec.uid) ?? [];
    if (!sp || sts.length === 0) continue;
    const w = (sp.a1 - sp.a0) / sts.length;
    sts.forEach((st, i) => {
      const a0 = sp.a0 + i * w;
      const a1 = a0 + w;
      statements.push({
        uid: st.uid,
        tested: st.tested,
        text: st.text,
        mid: (a0 + a1) / 2,
        d: arc({ innerRadius: outerR0, outerRadius: outerR1, startAngle: a0 + 0.004, endAngle: a1 - 0.004 }) ?? '',
      });
    });
  }
  return { specPath, outerMid: (outerR0 + outerR1) / 2, outerR1, sections, statements };
}

const COLORS: Record<SpecGraphNode['type'], string> = {
  Feature: '#db2777',
  Spec: '#7c3aed',
  Section: '#0891b2',
  Statement: '#2563eb',
  TestChunk: '#16a34a',
  CodeChunk: '#ea580c',
  File: '#ea580c',
  ADR: '#d97706',
};
const RADIUS: Record<SpecGraphNode['type'], number> = { Feature: 20, Spec: 16, Section: 10, Statement: 8, TestChunk: 11, CodeChunk: 11, File: 12, ADR: 13 };

// Focus + context: opacity by graph distance from the selected node, fading with
// depth (level 0 = selected, then 1/2/3 hops); past 3 hops is dimmed.
const LEVEL_OPACITY = [1, 0.85, 0.5, 0.28];
const FADED = 0.07;

const idOf = (x: string | number | SimNode): string => (typeof x === 'object' ? x.id : String(x));

function nodeLinks(node: SpecGraphNode, repo: string): Array<{ label: string; href: string; external: boolean }> {
  const out: Array<{ label: string; href: string; external: boolean }> = [];
  if ((node.type === 'Spec' || node.type === 'Statement' || node.type === 'Section') && node.path) {
    out.push({ label: 'Open in Lore', href: `/specs/${encodeURIComponent(node.path)}`, external: false });
  }
  if (node.path) {
    const line = node.line ? `#L${node.line}` : '';
    out.push({ label: 'View on GitHub', href: `https://github.com/${repo}/blob/HEAD/${node.path}${line}`, external: true });
  }
  return out;
}

// Memoized so the markdown only re-parses when the text changes, not on every
// cursor move while the tooltip follows the pointer.
const HoverMarkdown = memo(function HoverMarkdown({ text }: { text: string }) {
  return (
    <div className="md-popover">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

function bfsLevels(adj: Map<string, Set<string>>, startId: string, maxDepth: number): Map<string, number> {
  const level = new Map<string, number>([[startId, 0]]);
  let frontier = [startId];
  for (let d = 1; d <= maxDepth; d += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!level.has(nb)) {
          level.set(nb, d);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return level;
}

export default function SpecGraphD3({ data, repo }: { data: SpecGraph; repo: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<SpecGraphNode | null>(null);
  const [hover, setHover] = useState<{ text: string; x: number; y: number } | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = el.clientWidth || 900;
    let height = el.clientHeight || 600;
    const svg = d3.select(el);
    svg.selectAll('*').remove();
    if (data.nodes.length === 0) return;

    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const links: SimLink[] = data.links.map((l) => ({ source: l.source, target: l.target, kind: l.kind }));
    const expanded = new Map<string, ExpandData>(); // spec id → its two-ring layout
    let adj = new Map<string, Set<string>>();
    let nodeById = new Map<string, SimNode>();
    let ringPinned = new Set<string>(); // statement ids pinned onto an outer ring

    // Persist the layout to localStorage so a reload restores the previous topology
    // (node positions, pins, which specs were expanded). Best-effort — storage may
    // be unavailable or hold a stale/corrupt blob, both handled by returning early.
    const STORAGE_KEY = `lore.graph:${repo}`;
    const saveState = () => {
      try {
        localStorage.setItem(STORAGE_KEY, serializeGraphState(captureGraphState(nodes, [...expanded.keys()])));
      } catch {
        // storage disabled or over quota — persistence is best-effort
      }
    };
    let savedExpanded: string[] = [];
    try {
      const saved = parseGraphState(localStorage.getItem(STORAGE_KEY));
      if (saved) {
        applyGraphState(saved, nodes);
        savedExpanded = saved.expanded;
      }
    } catch {
      // unavailable/corrupt storage — start from a fresh force layout
    }

    const linkForce = d3
      .forceLink<SimNode, SimLink>([])
      .id((d) => d.id)
      // Spec→Section/Statement (the expanded drill-down) gets more length so the
      // fanned-out children don't pile on top of each other.
      .distance((l) => (l.kind === 'in_feature' ? 170 : l.kind === 'in_section' || l.kind === 'has_statement' || l.kind === 'in_spec' ? 150 : 110))
      .strength(0.35);
    const sim = d3
      .forceSimulation<SimNode>([])
      .force('link', linkForce)
      .force('charge', d3.forceManyBody<SimNode>().strength((d) => (d.type === 'Feature' ? -850 : d.type === 'Spec' ? -700 : -520)))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('x', d3.forceX(width / 2).strength(0.03))
      .force('y', d3.forceY(height / 2).strength(0.03))
      .force('collide', d3.forceCollide<SimNode>((d) => RADIUS[d.type] + 16).strength(1))
      // Spacing pass: Spec/ADR "anchor" nodes are kept clear of each other AND of
      // the open rings (resolveSpacing, gap = ANCHOR_SEPARATION); every other node
      // is just kept off the rings (resolveExclusion). Ring-owned nodes (the spec
      // itself, its pinned statements) and user-dragged nodes (fx/fy set) are exempt
      // so a dragged node never snaps back. Uses the unit-tested resolvers.
      .force('spacing', () => {
        const discs: Disc[] = [];
        for (const [specId, exp] of expanded) {
          const spec = nodeById.get(specId);
          if (spec) discs.push({ x: spec.x ?? 0, y: spec.y ?? 0, r: exp.outerR1 });
        }
        const anchors: Anchor[] = [];
        for (const n of nodes) {
          if (n.type === 'Feature' || n.type === 'Spec' || n.type === 'ADR') anchors.push({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 });
        }
        for (const n of nodes) {
          if (expanded.has(n.id) || ringPinned.has(n.id) || n.fx != null || n.fy != null) continue;
          const isAnchor = n.type === 'Feature' || n.type === 'Spec' || n.type === 'ADR';
          const safe = isAnchor
            ? resolveSpacing({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 }, anchors, discs, ANCHOR_SEPARATION)
            : resolveExclusion({ x: n.x ?? 0, y: n.y ?? 0 }, discs, RING_CLEARANCE);
          if (safe.x === n.x && safe.y === n.y) continue;
          n.x = safe.x;
          n.y = safe.y;
          n.vx = 0; // kill velocity so the integration step can't pull it back in
          n.vy = 0;
        }
      });

    const container = svg.append('g');
    const linkG = container.append('g').attr('fill', 'none').attr('stroke', '#94a3b8');
    const ringG = container.append('g'); // section/statement rings, between links and nodes
    const nodeG = container.append('g');

    // Open-ring discs (one per expanded spec), rebuilt each tick. Edge paths are
    // clipped against these via the unit-tested `visibleSegments`, so no edge is
    // ever drawn inside a ring — it attaches to the ring's edge instead.
    let ringDiscs: Disc[] = [];

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 4])
      .on('zoom', (event) => container.attr('transform', event.transform.toString()));
    svg.call(zoom).on('dblclick.zoom', null).style('cursor', 'grab');
    svg.on('click', () => {
      selectedIdRef.current = null;
      setSelected(null);
      clearHighlight();
    });

    const centerOn = (d: SimNode) => {
      const k = 1.4;
      const t = d3.zoomIdentity.translate(width / 2 - (d.x ?? 0) * k, height / 2 - (d.y ?? 0) * k).scale(k);
      svg.transition().duration(500).call(zoom.transform, t);
    };

    function buildAdj() {
      adj = new Map();
      for (const l of links) {
        const s = idOf(l.source as string | SimNode);
        const t = idOf(l.target as string | SimNode);
        (adj.get(s) ?? adj.set(s, new Set()).get(s)!).add(t);
        (adj.get(t) ?? adj.set(t, new Set()).get(t)!).add(s);
      }
    }

    function highlight(startId: string) {
      const level = bfsLevels(adj, startId, 3);
      const op = (id: string | undefined) => {
        if (id === undefined) return FADED;
        const lv = level.get(id);
        return lv === undefined ? FADED : LEVEL_OPACITY[lv] ?? FADED;
      };
      nodeG.selectAll<SVGGElement, SimNode>('g').attr('opacity', (d) => op(d.id));
      nodeG.selectAll<SVGCircleElement, SimNode>('circle').attr('stroke-width', (d) => (d.id === startId ? 4 : 2));
      linkG.selectAll<SVGPathElement, SimLink>('path').attr('stroke-opacity', (d) => {
        const ls = level.get(idOf(d.source as string | SimNode));
        const lt = level.get(idOf(d.target as string | SimNode));
        if (ls === undefined || lt === undefined) return FADED;
        return 0.6 * (LEVEL_OPACITY[Math.max(ls, lt)] ?? FADED);
      });
    }

    function clearHighlight() {
      nodeG.selectAll<SVGGElement, SimNode>('g').attr('opacity', 1);
      nodeG.selectAll<SVGCircleElement, SimNode>('circle').attr('stroke-width', 2);
      linkG.selectAll<SVGPathElement, SimLink>('path').attr('stroke-opacity', 0.5);
    }

    // Hide the force-nodes/edges that the rings now represent: a pinned statement
    // is drawn as an outer-ring arc, and its spec→statement edge is redundant.
    function applyRingState() {
      ringPinned = new Set<string>();
      for (const exp of expanded.values()) for (const s of exp.statements) ringPinned.add(s.uid);
      nodeG.selectAll<SVGGElement, SimNode>('g').style('display', (d) => (ringPinned.has(d.id) ? 'none' : ''));
      linkG
        .selectAll<SVGPathElement, SimLink>('path')
        .style('display', (d) => (d.kind === 'in_spec' && ringPinned.has(idOf(d.target as string | SimNode)) ? 'none' : ''));
    }

    function renderRings() {
      const sel = ringG.selectAll<SVGGElement, [string, ExpandData]>('g.ring').data([...expanded.entries()], (d) => d[0]);
      sel.exit().remove();
      sel
        .enter()
        .append('g')
        .attr('class', 'ring')
        .merge(sel)
        .each(function (entry) {
          const exp = entry[1];
          const g = d3.select(this);
          g.selectAll<SVGPathElement, SectionArc>('path.sec')
            .data(exp.sections, (s) => s.uid)
            .join('path')
            .attr('class', 'sec')
            .attr('d', (s) => s.d)
            .attr('fill', (s) => (s.total > 0 ? coverageTint(s.tested / s.total) : '#9ca3af'))
            .attr('fill-opacity', 0.5)
            .attr('stroke', 'var(--bg-surface)')
            .attr('stroke-width', 1)
            .style('cursor', 'pointer')
            .on('click', (event: PointerEvent, s) => {
              event.stopPropagation();
              selectedIdRef.current = null;
              setSelected({ id: s.uid, type: 'Section', label: s.heading, path: exp.specPath });
            })
            .on('mouseenter mousemove', (event: PointerEvent, s) => {
              const [px, py] = d3.pointer(event, el);
              setHover({ text: `${s.heading} — ${s.tested}/${s.total} tested`, x: px, y: py });
            })
            .on('mouseleave', () => setHover(null));
          g.selectAll<SVGPathElement, StatementArc>('path.st')
            .data(exp.statements, (s) => s.uid)
            .join('path')
            .attr('class', 'st')
            .attr('d', (s) => s.d)
            .attr('fill', (s) => (s.tested ? TESTED_FILL : UNTESTED_FILL))
            .attr('fill-opacity', 0.78)
            .style('cursor', 'pointer')
            .on('click', (event: PointerEvent, s) => {
              event.stopPropagation();
              selectedIdRef.current = null;
              setSelected({ id: s.uid, type: 'Statement', label: '', detail: s.text, path: exp.specPath });
            })
            .on('mouseenter mousemove', (event: PointerEvent, s) => {
              const [px, py] = d3.pointer(event, el);
              setHover({ text: s.text || '(statement)', x: px, y: py });
            })
            .on('mouseleave', () => setHover(null));
        });
    }

    async function toggleExpand(d: SimNode) {
      if (d.type !== 'Spec' || !d.path) return;
      if (expanded.has(d.id)) {
        expanded.delete(d.id);
        d.fx = null;
        d.fy = null;
        applyRingState();
        renderRings();
        sim.alpha(0.4).restart();
        saveState();
        return;
      }
      // Pin the spec so the ring stays put — the simulation restart would otherwise
      // drift it, and the second double-click (to collapse) would miss.
      d.fx = d.x;
      d.fy = d.y;
      const res = await fetch(`/api/repos/${repo}/spec-ring?spec=${encodeURIComponent(d.path)}`);
      if (!res.ok) return;
      const ring = (await res.json()) as SpecRing;
      if (ring.sections.length === 0 && ring.statements.length === 0) return;
      expanded.set(d.id, computeRing(d.path, ring));
      applyRingState();
      renderRings();
      sim.alpha(0.5).restart();
      saveState();
    }

    function update() {
      sim.nodes(nodes);
      linkForce.links(links);

      linkG
        .selectAll<SVGPathElement, SimLink>('path')
        .data(links, (d) => `${idOf(d.source as string | SimNode)}~${idOf(d.target as string | SimNode)}~${d.kind}`)
        .join('path')
        .attr('stroke-width', 1.3)
        .attr('stroke-opacity', 0.5);

      nodeG
        .selectAll<SVGGElement, SimNode>('g')
        .data(nodes, (d) => d.id)
        .join((enter) => {
          const g = enter
            .append('g')
            .style('cursor', 'pointer')
            .on('click', (event: PointerEvent, d) => {
              event.stopPropagation();
              selectedIdRef.current = d.id;
              setSelected(d);
              highlight(d.id);
              centerOn(d);
            })
            .on('dblclick', (event: PointerEvent, d) => {
              event.stopPropagation();
              void toggleExpand(d);
            })
            .on('mouseenter mousemove', (event: PointerEvent, d) => {
              const text = (d.detail?.trim() || d.label || d.path || '').trim();
              if (!text) {
                setHover(null);
                return;
              }
              const [px, py] = d3.pointer(event, el);
              setHover({ text, x: px, y: py });
            })
            .on('mouseleave', () => setHover(null))
            .call(
              d3
                .drag<SVGGElement, SimNode>()
                .on('start', (event, d) => {
                  if (!event.active) sim.alphaTarget(0.3).restart();
                  d.fx = d.x;
                  d.fy = d.y;
                })
                .on('drag', (event, d) => {
                  d.fx = event.x;
                  d.fy = event.y;
                })
                .on('end', (event) => {
                  if (!event.active) sim.alphaTarget(0);
                  // Leave fx/fy pinned at the drop point — a dragged node stays put
                  // and never snaps back to its force-driven location.
                  saveState();
                }),
            );
          g.append('circle')
            .attr('r', (d) => RADIUS[d.type])
            .attr('fill', (d) => COLORS[d.type])
            .style('stroke', 'var(--bg-surface)')
            .attr('stroke-width', 2);
          g.filter((d) => d.label !== '')
            .append('text')
            .text((d) => d.label)
            .attr('x', (d) => RADIUS[d.type] + 4)
            .attr('y', 4)
            .attr('font-size', '12px')
            .attr('font-weight', (d) => (d.type === 'Spec' ? 600 : 400))
            .attr('fill', 'currentColor')
            .style('pointer-events', 'none');
          return g;
        });

      buildAdj();
      nodeById = new Map(nodes.map((n) => [n.id, n]));
      applyRingState();
      sim.alpha(0.6).restart();
      if (selectedIdRef.current && adj.has(selectedIdRef.current)) highlight(selectedIdRef.current);
    }

    sim.on('tick', () => {
      // Pin each expanded spec's statements onto its outer ring (which tracks the
      // spec), and fan their related test/code/ADR nodes radially OUTWARD at the
      // same angle — so every edge is a short spoke outside the ring, never a chord
      // crossing the (now clean) interior.
      for (const [specId, exp] of expanded) {
        const spec = nodeById.get(specId);
        if (!spec) continue;
        const cx = spec.x ?? 0;
        const cy = spec.y ?? 0;
        for (const s of exp.statements) {
          const n = nodeById.get(s.uid);
          if (n) {
            n.x = cx + exp.outerMid * Math.sin(s.mid);
            n.y = cy - exp.outerMid * Math.cos(s.mid);
            n.vx = 0;
            n.vy = 0;
          }
          let k = 0;
          for (const nb of adj.get(s.uid) ?? []) {
            if (ringPinned.has(nb) || expanded.has(nb)) continue;
            const leaf = nodeById.get(nb);
            // Only test/code chunks get spoked onto the ring. ADRs are anchors —
            // they go through the spacing force (kept apart + off rings), never spoked.
            if (!leaf || (leaf.type !== 'TestChunk' && leaf.type !== 'CodeChunk')) continue;
            // Only hard-place leaves owned by a single statement (clean radial
            // spokes). Shared chunks float; their edges are clipped to the ring
            // edge by visibleSegments.
            if ((adj.get(nb)?.size ?? 0) !== 1) continue;
            const r = exp.outerR1 + 32 + k * 34;
            leaf.x = cx + r * Math.sin(s.mid);
            leaf.y = cy - r * Math.cos(s.mid);
            leaf.vx = 0;
            leaf.vy = 0;
            k += 1;
          }
        }
      }
      ringDiscs = [];
      for (const [specId, exp] of expanded) {
        const spec = nodeById.get(specId);
        if (spec) ringDiscs.push({ x: spec.x ?? 0, y: spec.y ?? 0, r: exp.outerR1 });
      }
      linkG.selectAll<SVGPathElement, SimLink>('path').attr('d', (d) => {
        const s = d.source as SimNode;
        const t = d.target as SimNode;
        const pieces = visibleSegments({ x: s.x ?? 0, y: s.y ?? 0 }, { x: t.x ?? 0, y: t.y ?? 0 }, ringDiscs);
        return pieces.map((p) => `M${p.a.x},${p.a.y}L${p.b.x},${p.b.y}`).join('');
      });
      nodeG.selectAll<SVGGElement, SimNode>('g').attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      ringG.selectAll<SVGGElement, [string, ExpandData]>('g.ring').attr('transform', (entry) => {
        const spec = nodeById.get(entry[0]);
        return `translate(${spec?.x ?? 0},${spec?.y ?? 0})`;
      });
    });

    update();

    // Re-open the rings that were expanded last session, and persist whenever the
    // layout cools so the next reload restores this exact topology.
    for (const id of savedExpanded) {
      const spec = nodeById.get(id);
      if (spec) void toggleExpand(spec);
    }
    sim.on('end', saveState);

    const resize = new ResizeObserver(() => {
      width = el.clientWidth || width;
      height = el.clientHeight || height;
      sim.force('center', d3.forceCenter(width / 2, height / 2));
      sim.alpha(0.3).restart();
    });
    resize.observe(el);

    return () => {
      resize.disconnect();
      sim.stop();
    };
  }, [data, repo]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', gap: 16, margin: '8px 0', fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap', alignItems: 'center' }}>
        {(Object.keys(COLORS) as SpecGraphNode['type'][]).map((t) => (
          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[t], display: 'inline-block' }} />
            {t}
          </span>
        ))}
        <span style={{ marginLeft: 'auto' }}>click to focus · double-click a spec to expand · scroll to zoom · drag to pan</span>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <svg
          ref={ref}
          width="100%"
          height="100%"
          style={{ display: 'block', width: '100%', height: '100%', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', background: 'var(--bg-surface)' }}
        />
        {hover && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(hover.x + 14, 9999),
              top: hover.y + 14,
              maxWidth: 320,
              pointerEvents: 'none',
              padding: '6px 9px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              color: 'var(--text)',
              boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
              fontSize: 12,
              lineHeight: 1.4,
              maxHeight: 240,
              overflow: 'hidden',
              zIndex: 10,
            }}
          >
            <HoverMarkdown text={hover.text} />
          </div>
        )}
        {selected && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, 28px)',
              maxWidth: 420,
              maxHeight: 320,
              overflow: 'auto',
              padding: 12,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              color: 'var(--text)',
              boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
              fontSize: 13,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[selected.type], display: 'inline-block' }} />
              <strong>{selected.type}</strong>
              {selected.type === 'Spec' && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>· double-click to expand</span>}
              <button
                onClick={() => {
                  selectedIdRef.current = null;
                  setSelected(null);
                }}
                style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {selected.label && <div style={{ fontWeight: 600, marginBottom: 4 }}>{selected.label}</div>}
            {selected.detail && (
              <div className="md-popover" style={{ marginBottom: 8, lineHeight: 1.5 }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {selected.detail}
                </ReactMarkdown>
              </div>
            )}
            {selected.path && (
              <div style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12, marginBottom: 8, wordBreak: 'break-all' }}>
                {selected.path}{selected.line ? `:${selected.line}` : ''}
              </div>
            )}
            {selected.type === 'TestChunk' && selected.path && selected.line && (
              <div style={{ marginBottom: 8 }}>
                <TestPreview repo={repo} path={selected.path} start={selected.line} end={selected.endLine} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 12 }}>
              {nodeLinks(selected, repo).map((l) => (
                <a key={l.href} href={l.href} target={l.external ? '_blank' : undefined} rel={l.external ? 'noreferrer' : undefined} style={{ color: '#3b82f6' }}>
                  {l.label} →
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

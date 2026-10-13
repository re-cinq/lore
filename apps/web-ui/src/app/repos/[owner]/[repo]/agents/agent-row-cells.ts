// The two derived cells of an agent-definitions row (used by / mode), as text plus the flag saying the text is bad news.

import type { AgentDefinition } from "@/lib/agents-mirror";
import type { AgentUsage, AgentUsageRef } from "@/lib/agents-api";

/** The two cells derived from usage. A null `usage` means the endpoint was unreachable, NOT that the definition is unused — each helper renders that as unknown rather than as a claim nothing references it. */
export function rowCells(agent: AgentDefinition, usage: AgentUsage | null) {
  const refs = usage === null ? null : usage.refs;

  return {
    use: usageLine(agent, refs),
    mode: modeLabel(agent, refs),
  };
}

/** Where definition is dispatched from; three shapes: blueprint refs, single-agent, dormant-station. */
function usageLine(
  def: AgentDefinition,
  refs: Record<string, AgentUsageRef[] | undefined> | null,
): { text: string; dormant: boolean } {
  // Unknown ≠ unreferenced: null usage means endpoint unreachable or old lore-api.
  if (refs === null) {
    return { text: "—", dormant: false };
  }
  const own = refs[def.name];
  const unreferenced = !own || own.length === 0;

  if (unreferenced) {
    return def.execution_mode === "station"
      ? { text: "not referenced by any assembly line", dormant: true }
      : { text: "no assembly line — runs as a single agent", dormant: false };
  }

  return { text: `used by ${groupRefsByLine(own)}`, dormant: false };
}

// Group per blueprint; dedupe (line, node) pairs; collapse duplicate refs.
function groupRefsByLine(refs: AgentUsageRef[]): string {
  const byLine = new Map<string, string[]>();

  for (const ref of refs) {
    const node = `${ref.node_id}${ref.inherited ? "" : " (station_ref)"}`;
    const nodes = byLine.get(ref.blueprint) ?? [];

    if (!nodes.includes(node)) {
      nodes.push(node);
    }
    byLine.set(ref.blueprint, nodes);
  }

  return [...byLine]
    .map(([blueprint, nodes]) => `${blueprint} · ${nodes.join(", ")}`)
    .join("; ");
}

/** Mode cell: LLM recipes show dispatch lines (deduped), station/zero-LLM keep tags, single-agent fallback. */
function modeLabel(
  def: AgentDefinition,
  refs: Record<string, AgentUsageRef[] | undefined> | null,
): string {
  if (def.execution_mode === "station") {
    return "station";
  }

  if (def.execution_mode === "graph-ingest") {
    return "zero-LLM";
  }
  const own = ownRefs(def, refs);

  if (own && own.length > 0) {
    return dispatchLines(own);
  }

  return refs === null ? def.execution_mode : "single agent";
}

function dispatchLines(refs: AgentUsageRef[]): string {
  return [...new Set(refs.map((ref) => ref.blueprint))].join(", ");
}

function ownRefs(
  def: AgentDefinition,
  refs: Record<string, AgentUsageRef[] | undefined> | null,
): AgentUsageRef[] | null {
  return refs ? (refs[def.name] ?? null) : null;
}

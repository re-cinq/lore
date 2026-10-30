import type { AgentDefinition } from "@/lib/agents-mirror";
import type { AgentUsage, AgentUsageRef } from "@/lib/agents-api";

export const UNUSED_LINE = "No assembly line";

export interface LineGroup {
  line: string;
  agents: AgentDefinition[];
}

/** One group per assembly line, by name, then the agents no line references; null usage is unknown, so everything stays in one group. */
export function groupAgentsByLine(
  agents: AgentDefinition[],
  usage: AgentUsage | null,
): LineGroup[] {
  if (usage === null) {
    return [{ line: UNUSED_LINE, agents }];
  }
  const byLine = new Map<string, AgentDefinition[]>();

  for (const agent of agents) {
    const line = lineOf(usage.refs[agent.name]);

    byLine.set(line, [...(byLine.get(line) ?? []), agent]);
  }

  return [...byLine]
    .map(([line, lineAgents]) => ({ line, agents: lineAgents }))
    .sort(
      (a, b) =>
        Number(a.line === UNUSED_LINE) - Number(b.line === UNUSED_LINE) ||
        a.line.localeCompare(b.line),
    );
}

/** An agent sits under the first line that dispatches it; in the shipped pipelines no agent serves two lines. */
function lineOf(refs: AgentUsageRef[] | undefined): string {
  return refs && refs.length > 0 ? refs[0].blueprint : UNUSED_LINE;
}

/** A hyphenated id as a sentence-case title: "code-review" reads "Code review". */
export function lineTitle(line: string): string {
  const words = line.replaceAll("-", " ");

  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Each agent's title within its line: the hyphen-separated prefix every name shares is dropped, so "triage-verify" beside "triage-diagnose" reads "Verify". */
export function agentTitles(names: string[]): string[] {
  const parts = names.map((name) => name.split("-"));
  const shared = sharedPrefixLength(parts);

  return parts.map((words) => lineTitle(words.slice(shared).join("-")));
}

// A lone name keeps every word, and no name is cut down to nothing.
function sharedPrefixLength(parts: string[][]): number {
  if (parts.length < 2) {
    return 0;
  }
  let shared = 0;

  while (
    parts.every(
      (words) =>
        words.length > shared + 1 && words[shared] === parts[0][shared],
    )
  ) {
    shared += 1;
  }

  return shared;
}

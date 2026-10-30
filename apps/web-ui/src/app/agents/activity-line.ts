import type { DefinitionActivity } from "@/lib/agents-api";
import { formatCost } from "@/lib/task-presenter";
import { formatTokens } from "@/lib/run-tokens";

/** A card's last-30-days fact: unknown reads as a dash, never as "no runs"; one run is singular. */
export function activityLine(
  activity: Partial<Record<string, DefinitionActivity>> | null,
  name: string,
): string {
  if (activity === null) {
    return "—";
  }
  const entry = activity[name];

  if (entry === undefined) {
    return "No runs";
  }
  const runs = entry.visits === 1 ? "1 run" : `${entry.visits} runs`;
  const tokens = formatTokens(entry.tokens_in + entry.tokens_out);

  return `${runs} · ${formatCost(entry.cost_usd)} · ${tokens} tokens`;
}

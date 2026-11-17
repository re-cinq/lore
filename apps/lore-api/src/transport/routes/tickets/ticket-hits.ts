import type { SearchHit } from "@re-cinq/lore-shared/utopia/read-shapes.js";

export interface TicketHit {
  number: number;
  score: number;
  excerpt: string;
}

const ISSUE_ID = /^issue:(\d+)$/;
const EXCERPT_LENGTH = 280;

/** The issues the hits of the repo's `issues` source name, one per issue at its best-scoring chunk, best first. The `test-coverage` source carries `issue:` items too, so the source decides, not the id. */
export function ticketHitsOf(
  hits: readonly SearchHit[],
  issuesSourceId: string,
): TicketHit[] {
  const best = new Map<number, TicketHit>();

  for (const hit of hits.filter((h) => h.sourceId === issuesSourceId)) {
    const number = issueNumberOf(hit.externalId);
    const held = number === null ? undefined : best.get(number);

    if (number !== null && (!held || hit.score > held.score)) {
      best.set(number, {
        number,
        score: hit.score,
        excerpt: excerptOf(hit.text),
      });
    }
  }

  return [...best.values()].sort((a, b) => b.score - a.score);
}

function issueNumberOf(externalId: string | null): number | null {
  const match = externalId?.match(ISSUE_ID);

  return match ? Number(match[1]) : null;
}

function excerptOf(text: string): string {
  const trimmed = text.trim();

  return trimmed.length > EXCERPT_LENGTH
    ? `${trimmed.slice(0, EXCERPT_LENGTH - 1)}…`
    : trimmed;
}

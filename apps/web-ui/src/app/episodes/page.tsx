export const dynamic = "force-dynamic";
import { query } from "@/lib/db";
import EpisodesView, { type EpisodeRow } from "./EpisodesView";

const PAGE_SIZE = 30;

interface CountResult {
  count: number;
}

export default async function EpisodesPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; offset?: string }>;
}) {
  const { source, offset: offsetStr } = await searchParams;
  const offset = Math.max(0, parseInt(offsetStr || "0", 10) || 0);

  const conditions: string[] = [];
  const params: any[] = [];
  const paramIndex = 1;

  if (source && source.trim()) {
    conditions.push(`e.source = $${paramIndex}`);
    params.push(source.trim());
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [{ count: totalCount }] = await query<CountResult>(
    `
    SELECT count(*)::int as count FROM memory.episodes e ${whereClause}
  `,
    params,
  );

  const episodes = await query<EpisodeRow>(
    `
    SELECT e.id, e.agent_id, e.source, e.ref,
           LEFT(e.content, 300) as content_preview,
           (SELECT count(*)::int FROM memory.facts f WHERE f.episode_id = e.id) as fact_count,
           e.created_at
    FROM memory.episodes e
    ${whereClause}
    ORDER BY e.created_at DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `,
    params,
  );

  const sources = ["manual", "session", "pr-review", "ci"];

  return (
    <EpisodesView
      source={source}
      offset={offset}
      totalCount={totalCount}
      episodes={episodes}
      sources={sources}
      pageSize={PAGE_SIZE}
    />
  );
}

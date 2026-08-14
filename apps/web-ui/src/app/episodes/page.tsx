export const dynamic = "force-dynamic";
import { listEpisodes } from "@/lib/api/memory";
import EpisodesView, { type EpisodeRow } from "./EpisodesView";

const PAGE_SIZE = 30;

export default async function EpisodesPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; offset?: string }>;
}) {
  const { source, offset: offsetStr } = await searchParams;
  const offset = Math.max(0, parseInt(offsetStr || "0", 10) || 0);

  const page = await listEpisodes({
    source,
    limit: PAGE_SIZE,
    offset,
  });
  const totalCount = page.status === "ok" ? page.data.total : 0;
  const episodes = (page.status === "ok"
    ? page.data.episodes
    : []) as unknown as EpisodeRow[];

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

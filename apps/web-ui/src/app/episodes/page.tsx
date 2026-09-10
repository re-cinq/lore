export const dynamic = "force-dynamic";
import { listEpisodes } from "@/lib/api/memory";
import EpisodesView, { type EpisodeRow } from "./EpisodesView";

const PAGE_SIZE = 30;

const SOURCES = ["manual", "session", "pr-review", "ci"];

interface EpisodesPageProps {
  searchParams: Promise<{ source?: string; offset?: string }>;
}

export default async function EpisodesPage(props: EpisodesPageProps) {
  const { source, offset: offsetStr } = await props.searchParams;
  const offset = Math.max(0, parseInt(offsetStr || "0", 10) || 0);
  const { totalCount, episodes } = await readEpisodePage(source, offset);

  return (
    <EpisodesView
      source={source}
      offset={offset}
      totalCount={totalCount}
      episodes={episodes}
      sources={SOURCES}
      pageSize={PAGE_SIZE}
    />
  );
}

/** One page of episodes, with the total behind it. An unreachable lore-api reads as an empty page. */
async function readEpisodePage(source: string | undefined, offset: number) {
  const page = await listEpisodes({
    source,
    limit: PAGE_SIZE,
    offset,
  });
  const totalCount = page.status === "ok" ? page.data.total : 0;
  const episodes = (page.status === "ok"
    ? page.data.episodes
    : []) as unknown as EpisodeRow[];

  return { totalCount, episodes };
}

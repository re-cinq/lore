export const dynamic = "force-dynamic";
import { fetchRepoEvents } from "./events-data";
import EventsView from "./EventsView";

export default async function RepoEvents({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const { events, hasMore } = await fetchRepoEvents(fullName, 0);

  return (
    <EventsView owner={owner} repo={repo} events={events} hasMore={hasMore} />
  );
}

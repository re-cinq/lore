export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import { EVENTS_PAGE_SIZE, repoEventsQuery, type RepoEvent } from './pagination';
import EventsView from './EventsView';

export default async function RepoEvents({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  // Fetch one extra row past the page size to detect a further page without a
  // separate COUNT. The first page renders server-side; the rest pages in
  // client-side via InfiniteEvents against the events API route.
  const { sql, params: sqlParams } = repoEventsQuery(fullName, 0);
  const rows = await query<RepoEvent>(sql, sqlParams).catch(() => []);

  const hasMore = rows.length > EVENTS_PAGE_SIZE;
  const events = rows.slice(0, EVENTS_PAGE_SIZE);

  return <EventsView owner={owner} repo={repo} events={events} hasMore={hasMore} />;
}

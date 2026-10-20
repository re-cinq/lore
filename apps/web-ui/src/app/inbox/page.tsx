export const dynamic = "force-dynamic";
import { getInboxItems } from "@/lib/api/inbox";
import InboxView, { parseInboxFilter } from "./InboxView";

interface InboxPageProps {
  searchParams: Promise<{ kind?: string | string[] }>;
}

/** `/inbox`: the floor's failed and parked runs across every repository. */
export default async function InboxPage({ searchParams }: InboxPageProps) {
  const { kind } = await searchParams;
  const entries = await getInboxItems();

  return <InboxView entries={entries} filter={parseInboxFilter(kind)} />;
}

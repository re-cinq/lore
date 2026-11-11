export const dynamic = "force-dynamic";
import { getInbox, type InboxKind, type InboxResponse } from "@/lib/api/inbox";
import InboxView from "./InboxView";

const VALID_KINDS = new Set<InboxKind>([
  "failed_run",
  "plan_review",
  "spec_pr",
  "backlog_pr",
  "triage_issue",
]);

const EMPTY_INBOX: InboxResponse = {
  items: [],
  counts: {},
  next_cursor: null,
};

interface InboxPageProps {
  searchParams: Promise<{
    repo?: string;
    kind?: string | string[];
    include?: string;
    cursor?: string;
  }>;
}

export default async function InboxPage({ searchParams }: InboxPageProps) {
  const params = await searchParams;
  const selectedKinds = parseKinds(params.kind);
  const inbox = await readInbox(params.repo, selectedKinds, params.cursor);

  return (
    <InboxView
      entries={inbox.items}
      counts={inbox.counts}
      unavailable={inbox.unavailable}
      selectedKinds={selectedKinds}
    />
  );
}

async function readInbox(
  repo: string | undefined,
  selectedKinds: InboxKind[],
  cursor: string | undefined,
): Promise<InboxResponse> {
  const result = await getInbox({
    repo,
    kind: selectedKinds.length > 0 ? selectedKinds : undefined,
    cursor,
  });

  return result.status === "ok" ? result.data : EMPTY_INBOX;
}

function parseKinds(raw: string | string[] | undefined): InboxKind[] {
  if (!raw) {
    return [];
  }
  const values = Array.isArray(raw) ? raw : [raw];

  return values.filter((v): v is InboxKind => VALID_KINDS.has(v as InboxKind));
}

export const dynamic = "force-dynamic";
import { getMemoryAudit } from "@/lib/api/activity";
import AuditView, { type AuditEntryRow } from "./AuditView";

const PAGE_SIZE = 50;

/** Every operation the audit trail records, for the filter. A fixed list rather than the distinct values present: an operation with no entries yet should still be selectable, so a reader can confirm there are none. */
const OPERATIONS = [
  "write",
  "read",
  "search",
  "delete",
  "snapshot",
  "restore",
  "shared_write",
  "shared_read",
  "list",
];

interface AuditPageProps {
  searchParams: Promise<{ agent?: string; op?: string; offset?: string }>;
}

export default async function AuditPage(props: AuditPageProps) {
  const { agent, op, offset: offsetStr } = await props.searchParams;
  const offset = Math.max(0, parseInt(offsetStr || "0", 10) || 0);

  const { entries, totalCount } = await readAuditPage(agent, op, offset);

  return (
    <AuditView
      entries={entries}
      totalCount={totalCount}
      operations={OPERATIONS}
      agent={agent}
      op={op}
      offset={offset}
      pageSize={PAGE_SIZE}
      hasPrev={offset > 0}
      hasNext={offset + PAGE_SIZE < totalCount}
    />
  );
}

/** One page of audit entries, with the total behind it. An unreachable lore-api reads as an empty page: the filters and the pager still render, and the reader can retry. */
async function readAuditPage(
  agent: string | undefined,
  op: string | undefined,
  offset: number,
) {
  const page = await getMemoryAudit({
    agent,
    operation: op,
    limit: PAGE_SIZE,
    offset,
  });

  return page.status === "ok"
    ? {
        entries: page.data.entries as AuditEntryRow[],
        totalCount: page.data.total,
      }
    : { entries: [] as AuditEntryRow[], totalCount: 0 };
}

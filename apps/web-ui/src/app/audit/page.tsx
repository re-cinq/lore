export const dynamic = "force-dynamic";
import { getMemoryAudit } from "@/lib/api/activity";
import AuditView, { type AuditEntryRow } from "./AuditView";

const PAGE_SIZE = 50;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; op?: string; offset?: string }>;
}) {
  const { agent, op, offset: offsetStr } = await searchParams;
  const offset = Math.max(0, parseInt(offsetStr || "0", 10) || 0);

  const page = await getMemoryAudit({
    agent,
    operation: op,
    limit: PAGE_SIZE,
    offset,
  });
  const totalCount = page.status === "ok" ? page.data.total : 0;
  const entries: AuditEntryRow[] =
    page.status === "ok" ? (page.data.entries as AuditEntryRow[]) : [];

  const operations = [
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

  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < totalCount;

  return (
    <AuditView
      entries={entries}
      totalCount={totalCount}
      operations={operations}
      agent={agent}
      op={op}
      offset={offset}
      pageSize={PAGE_SIZE}
      hasPrev={hasPrev}
      hasNext={hasNext}
    />
  );
}

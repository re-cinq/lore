export const dynamic = "force-dynamic";
import { query } from "@/lib/db";
import AuditView, { type AuditEntryRow } from "./AuditView";

const PAGE_SIZE = 50;

interface CountResult {
  count: number;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; op?: string; offset?: string }>;
}) {
  const { agent, op, offset: offsetStr } = await searchParams;
  const offset = Math.max(0, parseInt(offsetStr || "0", 10) || 0);

  // Build WHERE conditions with proper NULL handling
  const conditions: string[] = [];
  const params: (string | null)[] = [];
  let paramIndex = 1;

  if (agent && agent.trim()) {
    conditions.push(`agent_id = $${paramIndex}`);
    params.push(agent.trim());
    paramIndex++;
  }

  if (op && op.trim()) {
    conditions.push(`operation = $${paramIndex}`);
    params.push(op.trim());
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Get total count for pagination
  const [{ count: totalCount }] = await query<CountResult>(
    `
    SELECT count(*)::int as count FROM memory.audit_log ${whereClause}
  `,
    params,
  );

  // Fetch page of entries
  const entries = await query<AuditEntryRow>(
    `
    SELECT id, agent_id, operation, memory_key, pool_name, metadata, created_at
    FROM memory.audit_log
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `,
    params,
  );

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

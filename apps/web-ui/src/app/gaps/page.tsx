export const dynamic = "force-dynamic";

import { query } from "@/lib/db";
import GapsView, {
  type ZeroResultSearchRow,
  type GapMemoryRow,
} from "./GapsView";

export default async function GapsPage() {
  const zeroResultSearches = await query<ZeroResultSearchRow>(`
    SELECT memory_key, metadata, created_at
    FROM memory.audit_log
    WHERE operation = 'search'
      AND metadata->>'result_count' = '0'
    ORDER BY created_at DESC
    LIMIT 20
  `);

  const gapMemories = await query<GapMemoryRow>(`
    SELECT key, value, created_at
    FROM memory.memories
    WHERE agent_id = 'klaus-gap-detection'
      AND is_deleted = FALSE
    ORDER BY created_at DESC
    LIMIT 10
  `);

  return (
    <GapsView
      gapMemories={gapMemories}
      zeroResultSearches={zeroResultSearches}
    />
  );
}

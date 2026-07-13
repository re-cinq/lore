export const dynamic = "force-dynamic";
import { query } from "@/lib/db";
import AgentDetailView, { MemoryViewRow } from "./AgentDetailView";

interface Memory {
  id: string;
  key: string;
  value: string;
  version: number;
  created_at: string;
  ttl_seconds: number | null;
  has_facts: boolean;
}

interface Version {
  version: number;
  value: string;
  created_at: string;
}

interface Fact {
  fact_text: string;
  created_at: string;
}

export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agentId = decodeURIComponent(id);

  const memories = await query<Memory>(
    `
    SELECT m.id, m.key, m.value, m.version, m.created_at, m.ttl_seconds,
           EXISTS(SELECT 1 FROM memory.facts f WHERE f.memory_id = m.id) as has_facts
    FROM memory.memories m
    WHERE m.agent_id = $1 AND m.is_deleted = FALSE
      AND (m.expires_at IS NULL OR m.expires_at > now())
    ORDER BY m.created_at DESC
    LIMIT 100
  `,
    [agentId],
  );

  // Get version histories and facts for each memory
  const memoriesWithDetails: MemoryViewRow[] = await Promise.all(
    memories.map(async (m) => {
      const versions = await query<Version>(
        `
      SELECT version, value, created_at FROM memory.memory_versions
      WHERE memory_id = $1 ORDER BY version DESC
    `,
        [m.id],
      );
      const facts = m.has_facts
        ? await query<Fact>(
            `
      SELECT fact_text, created_at FROM memory.facts WHERE memory_id = $1
    `,
            [m.id],
          )
        : [];
      return { ...m, versions, facts };
    }),
  );

  return (
    <AgentDetailView
      agentId={agentId}
      memoryCount={memories.length}
      memories={memoriesWithDetails}
    />
  );
}

export const dynamic = "force-dynamic";
import { listMemories } from "@/lib/api/memory";
import AgentDetailView, { MemoryViewRow } from "./AgentDetailView";

export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agentId = decodeURIComponent(id);

  // One call reads memories + version histories + facts — used to fan out up to 201 round trips per screen.
  const result = await listMemories(agentId);
  const memoriesWithDetails = (result.status === "ok"
    ? result.data.memories
    : []) as unknown as MemoryViewRow[];

  return (
    <AgentDetailView
      agentId={agentId}
      memoryCount={memoriesWithDetails.length}
      memories={memoriesWithDetails}
    />
  );
}

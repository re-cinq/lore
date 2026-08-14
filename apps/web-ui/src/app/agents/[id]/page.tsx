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

  // lore-api reads the memories with their version histories and facts in one
  // call. The page used to fan out a version query PLUS a fact query per row —
  // up to 201 round trips for one screen.
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

export const dynamic = "force-dynamic";

import { getMemoryAudit } from "@/lib/api/activity";
import { listMemories } from "@/lib/api/memory";
import GapsView, {
  type ZeroResultSearchRow,
  type GapMemoryRow,
} from "./GapsView";

export default async function GapsPage() {
  const searches = await getMemoryAudit({
    operation: "search",
    zeroResults: true,
    limit: 20,
  });
  const zeroResultSearches: ZeroResultSearchRow[] =
    searches.status === "ok"
      ? (searches.data.entries as unknown as ZeroResultSearchRow[])
      : [];

  const memories = await listMemories("klaus-gap-detection", 10);
  const gapMemories = (memories.status === "ok"
    ? memories.data.memories
    : []) as unknown as GapMemoryRow[];

  return (
    <GapsView
      gapMemories={gapMemories}
      zeroResultSearches={zeroResultSearches}
    />
  );
}

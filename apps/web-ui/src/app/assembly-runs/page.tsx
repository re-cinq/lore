export const dynamic = "force-dynamic";
import { getFloorRuns } from "@/lib/api/floor-runs";
import AssemblyRunsLive from "./AssemblyRunsLive";

export default async function AssemblyLinesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const { status, cursor } = await searchParams;
  const initial = await getFloorRuns({ status, cursor });

  return (
    <AssemblyRunsLive
      key={`${status ?? ""}:${cursor ?? ""}`}
      activeStatus={status}
      cursor={cursor}
      initial={initial}
    />
  );
}

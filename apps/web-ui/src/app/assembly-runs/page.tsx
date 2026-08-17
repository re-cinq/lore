export const dynamic = "force-dynamic";
import AssemblyRunListView from "./AssemblyRunListView";
import { fetchAssemblyRuns } from "@/lib/assembly-runs";

export default async function AssemblyLinesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const runs = await fetchAssemblyRuns({ status });

  return <AssemblyRunListView activeStatus={status} runs={runs} />;
}

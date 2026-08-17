export const dynamic = "force-dynamic";
import AssemblyLineRunListView from "./AssemblyLineRunListView";
import { fetchAssemblyLineRuns } from "@/lib/assembly-line-runs";

export default async function AssemblyLinesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const runs = await fetchAssemblyLineRuns({ status });

  return <AssemblyLineRunListView activeStatus={status} runs={runs} />;
}

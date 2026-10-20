export const dynamic = "force-dynamic";
import {
  fetchAssemblyRun,
  fetchAssemblyRunNodes,
  fetchRunTokens,
  type AssemblyRun,
} from "@/lib/assembly-runs";
import { getFloorRuns } from "@/lib/api/floor-runs";
import CompareView, { type CompareSide } from "./CompareView";

const CANDIDATE_LIMIT = 6;

interface ComparePageProps {
  searchParams: Promise<{ a?: string; b?: string }>;
}

/** `/compare?a=<run>&b=<run>`: two runs of one line, station by station; with only A, the runs to compare it with. */
export default async function ComparePage({ searchParams }: ComparePageProps) {
  const { a: aId, b: bId } = await searchParams;
  const [a, b] = await Promise.all([readSide(aId), readSide(bId)]);
  const candidates = a ? await candidatesFor(a.run) : [];

  return <CompareView a={a} b={b} candidates={candidates} />;
}

async function readSide(id: string | undefined): Promise<CompareSide | null> {
  const run = id ? await fetchAssemblyRun(id) : null;

  if (!run) {
    return null;
  }
  const [nodes, tokens] = await Promise.all([
    fetchAssemblyRunNodes(run.id),
    fetchRunTokens(run.id),
  ]);

  return { run, nodes, tokens };
}

/** The newest other runs of A's line in A's repository. */
async function candidatesFor(run: AssemblyRun): Promise<AssemblyRun[]> {
  const { runs } = await getFloorRuns({ repo: run.repo });
  const sameLine = runs.filter((other) => isSameLine(run, other));

  return sameLine.slice(0, CANDIDATE_LIMIT);
}

function isSameLine(run: AssemblyRun, other: AssemblyRun): boolean {
  return other.id !== run.id && other.blueprintName === run.blueprintName;
}

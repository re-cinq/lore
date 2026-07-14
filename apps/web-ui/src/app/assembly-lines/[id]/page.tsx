export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { queryOne } from "@/lib/db";
import {
  fetchAssemblyLineRun,
  fetchAssemblyLineRunNodes,
} from "@/lib/assembly-line-runs";
import AssemblyLineRunView from "./AssemblyLineRunView";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolver for `/assembly-lines/[id]`. The id disambiguates itself: a
 * `pipeline.assembly_lines` run renders the run detail; otherwise a
 * `pipeline.tasks` row redirects to the task detail at `/tasks/[id]` (so every
 * legacy task-UUID link — UUID linkification, repo overview, GitHub comments —
 * keeps working). A non-UUID or unknown id renders "Not found".
 */
export default async function AssemblyLineResolverPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return <p>Not found.</p>;
  }

  const run = await fetchAssemblyLineRun(id);

  if (run) {
    const nodes = await fetchAssemblyLineRunNodes(id);

    return <AssemblyLineRunView run={run} nodes={nodes} />;
  }

  const task = await queryOne<{ id: string }>(
    `SELECT id FROM pipeline.tasks WHERE id = $1`,
    [id],
  );

  if (task) {
    redirect(`/tasks/${id}`);
  }

  return <p>Not found.</p>;
}

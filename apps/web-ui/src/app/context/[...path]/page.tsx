export const dynamic = "force-dynamic";

import { getChunksByPath } from "@/lib/api/chunks";
import { decodeCatchAllPath } from "@/lib/catch-all-path";
import ContextFileView, {
  type ContextFileGroup,
  type ContextFileChunk,
} from "@/app/repos/[owner]/[repo]/context/ContextFileView";

interface ContextFileRow extends ContextFileChunk {
  repo: string | null;
}

const chunkOrder = (c: ContextFileChunk) =>
  Number(c.metadata?.chunk_index ?? c.metadata?.start_line ?? 0);

/** The chunks grouped by the repo they came from, each group in file order. A path is unique within a repo but the global view spans every schema, so the same file can appear more than once — and a row whose repo is unknown is kept under that name rather than dropped. */
function groupByRepo(
  rows: ContextFileRow[],
  filePath: string,
): ContextFileGroup[] {
  const byRepo = new Map<string, ContextFileRow[]>();

  for (const row of rows) {
    const key = row.repo ?? "unknown";
    const group = byRepo.get(key) ?? byRepo.set(key, []).get(key)!;

    group.push(row);
  }

  return [...byRepo.entries()].map(([repo, chunks]) => ({
    repo,
    repoHref: repo.includes("/")
      ? `/repos/${repo}/context/${encodeURIComponent(filePath)}`
      : null,
    chunks: [...chunks].sort((a, b) => chunkOrder(a) - chunkOrder(b)),
  }));
}

export default async function GlobalContextFile({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const filePath = decodeCatchAllPath(path);

  const result = await getChunksByPath(filePath);
  const rows = (result.status === "ok"
    ? result.data.chunks
    : []) as unknown as ContextFileRow[];
  const groups = groupByRepo(rows, filePath);

  return (
    <ContextFileView
      filePath={filePath}
      contextLink="/context"
      groups={groups}
    />
  );
}

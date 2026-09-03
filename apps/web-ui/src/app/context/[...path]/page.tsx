export const dynamic = "force-dynamic";

import { getChunksByPath } from "@/lib/api/chunks";
import ContextFileView, {
  type ContextFileGroup,
  type ContextFileChunk,
} from "@/app/repos/[owner]/[repo]/context/ContextFileView";

interface ContextFileRow extends ContextFileChunk {
  repo: string | null;
}

const chunkOrder = (c: ContextFileChunk) =>
  Number(c.metadata?.chunk_index ?? c.metadata?.start_line ?? 0);

export default async function GlobalContextFile({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const filePath = path.map(decodeURIComponent).join("/");

  const result = await getChunksByPath(filePath);
  const rows = (result.status === "ok"
    ? result.data.chunks
    : []) as unknown as ContextFileRow[];

  // Group by repo: file path unique to one repo, but global view spans all schemas.
  const byRepo = new Map<string, ContextFileRow[]>();

  for (const row of rows) {
    const key = row.repo ?? "unknown";
    const group = byRepo.get(key) ?? byRepo.set(key, []).get(key)!;

    group.push(row);
  }

  const groups: ContextFileGroup[] = [...byRepo.entries()].map(
    ([repo, chunks]) => ({
      repo,
      repoHref: repo.includes("/")
        ? `/repos/${repo}/context/${encodeURIComponent(filePath)}`
        : null,
      chunks: [...chunks].sort((a, b) => chunkOrder(a) - chunkOrder(b)),
    }),
  );

  return (
    <ContextFileView
      filePath={filePath}
      contextLink="/context"
      groups={groups}
    />
  );
}

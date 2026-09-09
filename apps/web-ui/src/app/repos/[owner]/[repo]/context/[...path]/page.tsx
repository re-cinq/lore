export const dynamic = "force-dynamic";
import { getChunksByPath } from "@/lib/api/chunks";
import ContextFileView, { type ContextFileChunk } from "../ContextFileView";
import { decodeCatchAllPath } from "@/lib/catch-all-path";

export default async function RepoContextFile({
  params,
}: {
  params: Promise<{ owner: string; repo: string; path: string[] }>;
}) {
  const { owner, repo, path } = await params;
  const fullName = `${owner}/${repo}`;
  const filePath = decodeCatchAllPath(path);

  const result = await getChunksByPath(filePath, fullName);
  const chunks = (result.status === "ok"
    ? result.data.chunks
    : []) as unknown as ContextFileChunk[];

  return (
    <ContextFileView
      filePath={filePath}
      contextLink={`/repos/${owner}/${repo}/context`}
      groups={[{ repo: fullName, chunks }]}
    />
  );
}

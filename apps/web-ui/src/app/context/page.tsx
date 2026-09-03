export const dynamic = "force-dynamic";

import { getChunks, getChunkTypes } from "@/lib/api/chunks";
import { previewBlock } from "@/lib/preview-block";
import { contentTypeOf } from "@/lib/content-types";
import ContextView, { type ContextChunk } from "./ContextView";

interface RankedChunk extends ContextChunk {
  rank: number;
}

export default async function ContextPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; q?: string }>;
}) {
  const { type, q } = await searchParams;

  // Data-driven chips: all types across schemas (unaffected by filter/search).
  const typeResult = await getChunkTypes();
  const types = typeResult.status === "ok" ? typeResult.data.types : [];

  const chunkResult = await getChunks({ type, q, limit: 50 });
  const allChunks = (chunkResult.status === "ok"
    ? chunkResult.data.chunks
    : []) as unknown as RankedChunk[];

  const chunks = allChunks.map((c) => ({
    ...c,
    content: previewBlock(c.content, contentTypeOf(c.content_type)),
  }));

  return <ContextView type={type} q={q} types={types} chunks={chunks} />;
}

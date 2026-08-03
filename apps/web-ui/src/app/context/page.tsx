export const dynamic = "force-dynamic";

import { queryAllChunks } from "@/lib/db";
import { previewBlock } from "@/lib/preview-block";
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

  // Data-driven chips: distinct content types across every schema (unaffected
  // by the active filter/search so chips never disappear).
  const typeRows = await queryAllChunks<{ content_type: string }>((schema) => ({
    sql: `SELECT DISTINCT content_type FROM ${schema}.chunks`,
    params: [],
  }));
  const types = [
    ...new Set(typeRows.map((r) => r.content_type).filter(Boolean)),
  ];

  const allChunks = await queryAllChunks<RankedChunk>(
    (schema, offset) => ({
      sql: `SELECT id, file_path, content_type, repo, metadata,
                 substring(content, 1, 300) as content, ingested_at,
                 CASE WHEN $${offset + 1}::text IS NULL THEN 0
                      ELSE ts_rank(search_tsv, websearch_to_tsquery('english', $${offset + 1})) END as rank
          FROM ${schema}.chunks
          WHERE ($${offset}::text IS NULL OR content_type = $${offset})
            AND ($${offset + 1}::text IS NULL OR search_tsv @@ websearch_to_tsquery('english', $${offset + 1}))`,
      params: [type || null, q || null],
    }),
    [],
    {
      orderBy: q ? "rank DESC, id DESC" : "ingested_at DESC, id DESC",
      limit: 50,
    },
  );

  const chunks = allChunks.map((c) => ({
    ...c,
    content: previewBlock(c.content, c.content_type),
  }));

  return <ContextView type={type} q={q} types={types} chunks={chunks} />;
}

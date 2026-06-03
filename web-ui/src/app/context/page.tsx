export const dynamic = "force-dynamic";

import { queryAllChunks } from '@/lib/db';
import ContextView, { type ContextChunk } from './ContextView';

export default async function ContextPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;

  const allChunks = await queryAllChunks<ContextChunk>(
    (schema, offset) => ({
      sql: `SELECT id, file_path, content_type, substring(content, 1, 300) as content, ingested_at
            FROM ${schema}.chunks
            WHERE ($${offset}::text IS NULL OR content_type = $${offset})`,
      params: [type || null],
    }),
  );
  const chunks = allChunks.sort((a, b) => new Date(b.ingested_at).getTime() - new Date(a.ingested_at).getTime()).slice(0, 50);

  return <ContextView type={type} chunks={chunks} />;
}

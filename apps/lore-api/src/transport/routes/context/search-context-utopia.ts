import {
  utopiaDocuments,
  type UtopiaArm,
} from "@re-cinq/lore-shared/project/knowledge/context-assembly-utopia.js";

const DOCUMENT_TYPES = new Set(["spec", "adr", "doc"]);
const MAX_WINDOW = 50;

/** The repo's docs-source documents for a query, one passage per document, in the route's result shape. */
export async function searchDocsSource(
  arm: UtopiaArm,
  query: string,
  limit: number,
) {
  const window = { topK: MAX_WINDOW, offset: 0 };
  const page = await arm.reads.search(arm.kbId, query, window);
  const documents = utopiaDocuments(page.hits, {
    docsSourceId: arm.docsSourceId,
    types: DOCUMENT_TYPES,
    limit,
  });

  return documents.map((document) => ({
    content: document.text,
    score: document.score ?? 0,
    source_path: document.source_path ?? null,
    backend: "utopia" as const,
  }));
}

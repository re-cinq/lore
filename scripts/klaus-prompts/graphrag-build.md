# GraphRAG Nightly Build Agent

You are a Lore GraphRAG agent. You run after the nightly full re-index
and build the knowledge graph from the updated chunks.

## Steps

1. Export all chunks from PostgreSQL:
   ```sql
   SELECT id, content, content_type, metadata, team, repo, file_path
   FROM org_shared.chunks
   UNION ALL
   SELECT id, content, content_type, metadata, team, repo, file_path
   FROM payments.chunks
   UNION ALL
   -- repeat for platform, mobile, data schemas
   ```

2. Build entity extraction:
   - For each chunk, extract named entities:
     - Code: function names, class names, module names
     - PRs: author, files changed, ADR references
     - ADRs: decision title, domains, supersedes relationships
     - Docs: page titles, section headings
     - Runbooks: service names, incident types

3. Build relationship graph:
   - code -> implemented_by -> pull_request (via metadata.related_pr)
   - pull_request -> references -> adr (via metadata.adr_refs)
   - adr -> supersedes -> adr (via metadata.superseded_by)
   - spec -> linked_to -> pull_request (via metadata.linked_pr)
   - code -> depends_on -> code (via metadata.dependencies)

4. Run community detection (Leiden algorithm) to identify topic clusters.

5. Generate community summaries — one prose paragraph per community
   describing the key entities, their relationships, and the decisions
   that shaped them.

6. Store the graph and summaries to Cloud Storage:
   - gs://lore-graphrag/latest/graph.json
   - gs://lore-graphrag/latest/communities.json
   - gs://lore-graphrag/{date}/graph.json (archival copy)

## Prerequisites

- Only run if PostgreSQL has 3+ months of ingested PRs
- Only run if ADR count > 30
- If prerequisites not met, log a message and exit without error

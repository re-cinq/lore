[
  {
    "name": "jaccard > returns 1 for two identical result sets",
    "file": "/home/bogdan/workspace/lore/shared/dist/backfill-parity.test.js"
  },
  {
    "name": "jaccard > returns 0.5 for {a,b,c} vs {a,b,d} (2 shared of 4 total)",
    "file": "/home/bogdan/workspace/lore/shared/dist/backfill-parity.test.js"
  },
  {
    "name": "jaccard > returns 0 for disjoint result sets",
    "file": "/home/bogdan/workspace/lore/shared/dist/backfill-parity.test.js"
  },
  {
    "name": "jaccard > returns 1 for two empty sets (vacuously identical)",
    "file": "/home/bogdan/workspace/lore/shared/dist/backfill-parity.test.js"
  },
  {
    "name": "jaccard > treats inputs as sets, deduping repeats",
    "file": "/home/bogdan/workspace/lore/shared/dist/backfill-parity.test.js"
  },
  {
    "name": "meanTopkJaccard > returns 0.7 for [1, 0.5, 0.6] (sum 2.1 over 3)",
    "file": "/home/bogdan/workspace/lore/shared/dist/backfill-parity.test.js"
  },
  {
    "name": "meanTopkJaccard > returns 0 (not NaN) for an empty sample so the retrieval gate fails loudly",
    "file": "/home/bogdan/workspace/lore/shared/dist/backfill-parity.test.js"
  },
  {
    "name": "evaluateParityGates > passes with exit 0 when every table count matches and mean jaccard is 0.87",
    "file": "/home/bogdan/workspace/lore/shared/dist/backfill-parity.test.js"
  },
  {
    "name": "evaluateParityGates > fails with non-zero exit naming the table when facts count mismatches",
    "file": "/home/bogdan/workspace/lore/shared/dist/backfill-parity.test.js"
  },
  {
    "name": "evaluateParityGates > fails with non-zero exit naming the jaccard gate when tables match but mean jaccard is 0.5",
    "file": "/home/bogdan/workspace/lore/shared/dist/backfill-parity.test.js"
  },
  {
    "name": "evaluateParityGates > passes when mean jaccard is exactly the threshold 0.8 (gate is >=)",
    "file": "/home/bogdan/workspace/lore/shared/dist/backfill-parity.test.js"
  },
  {
    "name": "evaluateParityGates > accumulates both a table-mismatch and a jaccard failure when both gates fail",
    "file": "/home/bogdan/workspace/lore/shared/dist/backfill-parity.test.js"
  },
  {
    "name": "evaluateParityGates > fails a jaccard of 0.9 against a stricter custom threshold of 0.95",
    "file": "/home/bogdan/workspace/lore/shared/dist/backfill-parity.test.js"
  },
  {
    "name": "formatTrailers > formats minimal trailer block",
    "file": "/home/bogdan/workspace/lore/shared/dist/commit-trailers.test.js"
  },
  {
    "name": "formatTrailers > appends extras after required keys",
    "file": "/home/bogdan/workspace/lore/shared/dist/commit-trailers.test.js"
  },
  {
    "name": "parseTrailers > round-trips a minimal trailer block",
    "file": "/home/bogdan/workspace/lore/shared/dist/commit-trailers.test.js"
  },
  {
    "name": "parseTrailers > round-trips with extras",
    "file": "/home/bogdan/workspace/lore/shared/dist/commit-trailers.test.js"
  },
  {
    "name": "parseTrailers > parses trailer block at end of multi-paragraph commit",
    "file": "/home/bogdan/workspace/lore/shared/dist/commit-trailers.test.js"
  },
  {
    "name": "parseTrailers > returns null when no trailers present",
    "file": "/home/bogdan/workspace/lore/shared/dist/commit-trailers.test.js"
  },
  {
    "name": "parseTrailers > returns null when required key is missing",
    "file": "/home/bogdan/workspace/lore/shared/dist/commit-trailers.test.js"
  },
  {
    "name": "parseTrailers > returns null when iteration is not a number",
    "file": "/home/bogdan/workspace/lore/shared/dist/commit-trailers.test.js"
  },
  {
    "name": "parseTrailers > returns null when last paragraph mixes trailer and non-trailer lines",
    "file": "/home/bogdan/workspace/lore/shared/dist/commit-trailers.test.js"
  },
  {
    "name": "parseTrailers > returns null for empty input",
    "file": "/home/bogdan/workspace/lore/shared/dist/commit-trailers.test.js"
  },
  {
    "name": "parseTrailers > preserves arbitrary extras",
    "file": "/home/bogdan/workspace/lore/shared/dist/commit-trailers.test.js"
  },
  {
    "name": "parseTrailers > handles CRLF line endings",
    "file": "/home/bogdan/workspace/lore/shared/dist/commit-trailers.test.js"
  },
  {
    "name": "parseTrailers > strips trailing whitespace before parsing",
    "file": "/home/bogdan/workspace/lore/shared/dist/commit-trailers.test.js"
  },
  {
    "name": "parseTrailers > omits extras when only required keys are present",
    "file": "/home/bogdan/workspace/lore/shared/dist/commit-trailers.test.js"
  },
  {
    "name": "parseValidatesTrailers > returns one ref with numeric ordinal for a single Lore-Validates line",
    "file": "/home/bogdan/workspace/lore/shared/dist/commit-trailers.test.js"
  },
  {
    "name": "formatValidatesTrailer > renders specs/foo/spec.md#7 -> test/x.test.ts and round-trips through parseValidatesTrailers",
    "file": "/home/bogdan/workspace/lore/shared/dist/commit-trailers.test.js"
  },
  {
    "name": "createDgraphClient > returns a client exposing newTxn when LORE_DGRAPH_HTTP is set",
    "file": "/home/bogdan/workspace/lore/shared/dist/dgraph-client.test.js"
  },
  {
    "name": "chunkFile > stamps content_hash equal to sha256 of the chunk's own content",
    "file": "/home/bogdan/workspace/lore/shared/dist/chunker.test.js"
  },
  {
    "name": "buildIngestedChunkMetadata > carries content_hash, file_path, and ingested_by from an api ingest",
    "file": "/home/bogdan/workspace/lore/shared/dist/chunker.test.js"
  },
  {
    "name": "buildIngestedChunkMetadata > omits commit when not provided for a reindex-job ingest",
    "file": "/home/bogdan/workspace/lore/shared/dist/chunker.test.js"
  },
  {
    "name": "resolveAgentId > returns the explicit agent id over all other sources",
    "file": "/home/bogdan/workspace/lore/shared/dist/agent-id.test.js"
  },
  {
    "name": "resolveAgentId > returns LORE_AGENT_ID when no explicit id is given",
    "file": "/home/bogdan/workspace/lore/shared/dist/agent-id.test.js"
  },
  {
    "name": "resolveAgentId > reads ~/.lore/agent-id when no explicit id or env var",
    "file": "/home/bogdan/workspace/lore/shared/dist/agent-id.test.js"
  },
  {
    "name": "resolveAgentId > generates a uuid and persists it when no source is set",
    "file": "/home/bogdan/workspace/lore/shared/dist/agent-id.test.js"
  },
  {
    "name": "classifyFile > classifies CLAUDE.md / AGENTS.md / CODEOWNERS as doc",
    "file": "/home/bogdan/workspace/lore/shared/dist/content-classify.test.js"
  },
  {
    "name": "classifyFile > classifies top-level adrs/specs markdown as adr/spec",
    "file": "/home/bogdan/workspace/lore/shared/dist/content-classify.test.js"
  },
  {
    "name": "classifyFile > classifies source files as code by extension",
    "file": "/home/bogdan/workspace/lore/shared/dist/content-classify.test.js"
  },
  {
    "name": "classifyFile > classifies a .tsx/.jsx source file under a nested specs/ dir as code, not spec",
    "file": "/home/bogdan/workspace/lore/shared/dist/content-classify.test.js"
  },
  {
    "name": "classifyFile > classifies a source file under a nested adrs/ or runbooks/ dir as code",
    "file": "/home/bogdan/workspace/lore/shared/dist/content-classify.test.js"
  },
  {
    "name": "classifyFile > still classifies a real markdown spec under a nested specs/ dir as spec",
    "file": "/home/bogdan/workspace/lore/shared/dist/content-classify.test.js"
  },
  {
    "name": "classifyFile > returns code for the new tsx/jsx/mjs/cjs extensions",
    "file": "/home/bogdan/workspace/lore/shared/dist/content-classify.test.js"
  },
  {
    "name": "classifyFile > classifies other markdown / yaml as doc and skips binaries/unknowns",
    "file": "/home/bogdan/workspace/lore/shared/dist/content-classify.test.js"
  },
  {
    "name": "auditDgraphAcl > returns no violations for no documents",
    "file": "/home/bogdan/workspace/lore/shared/dist/dgraph-acl-policy.test.js"
  },
  {
    "name": "auditDgraphAcl > flags a container env that hardcodes a credential value",
    "file": "/home/bogdan/workspace/lore/shared/dist/dgraph-acl-policy.test.js"
  },
  {
    "name": "auditDgraphAcl > flags a dgraph alpha workload whose args do not enable --acl",
    "file": "/home/bogdan/workspace/lore/shared/dist/dgraph-acl-policy.test.js"
  },
  {
    "name": "auditDgraphAcl > flags a runtime StatefulSet that references the guardian credential",
    "file": "/home/bogdan/workspace/lore/shared/dist/dgraph-acl-policy.test.js"
  },
  {
    "name": "auditDgraphAcl > flags a ServiceAccount missing the Workload Identity annotation",
    "file": "/home/bogdan/workspace/lore/shared/dist/dgraph-acl-policy.test.js"
  },
  {
    "name": "auditDgraphAcl > returns no violations for a fully compliant Dgraph deployment set",
    "file": "/home/bogdan/workspace/lore/shared/dist/dgraph-acl-policy.test.js"
  },
  {
    "name": "auditDgraphAcl > does not flag a secretKeyRef env (no literal value) as a hardcoded credential",
    "file": "/home/bogdan/workspace/lore/shared/dist/dgraph-acl-policy.test.js"
  },
  {
    "name": "auditDgraphAcl > does not flag the pre-install bootstrap Job for using the guardian credential",
    "file": "/home/bogdan/workspace/lore/shared/dist/dgraph-acl-policy.test.js"
  },
  {
    "name": "LORE_INGEST_WORKFLOW_CONTENT > targets the workflows path",
    "file": "/home/bogdan/workspace/lore/shared/dist/ingest-workflow.test.js"
  },
  {
    "name": "LORE_INGEST_WORKFLOW_CONTENT > carries the current version marker on the first line",
    "file": "/home/bogdan/workspace/lore/shared/dist/ingest-workflow.test.js"
  },
  {
    "name": "LORE_INGEST_WORKFLOW_CONTENT > exposes FILES as a step-level env var, not inside the run block",
    "file": "/home/bogdan/workspace/lore/shared/dist/ingest-workflow.test.js"
  },
  {
    "name": "LORE_INGEST_WORKFLOW_CONTENT > sends a literal-escaped JSON body referencing the FILES env var",
    "file": "/home/bogdan/workspace/lore/shared/dist/ingest-workflow.test.js"
  },
  {
    "name": "LORE_INGEST_WORKFLOW_CONTENT > posts to the ingest endpoint without a self-referential url fallback",
    "file": "/home/bogdan/workspace/lore/shared/dist/ingest-workflow.test.js"
  },
  {
    "name": "LORE_INGEST_WORKFLOW_CONTENT > keeps the secret and token wiring",
    "file": "/home/bogdan/workspace/lore/shared/dist/ingest-workflow.test.js"
  },
  {
    "name": "parseIngestWorkflowVersion > reads the version from the marker line",
    "file": "/home/bogdan/workspace/lore/shared/dist/ingest-workflow.test.js"
  },
  {
    "name": "parseIngestWorkflowVersion > returns null when no marker is present",
    "file": "/home/bogdan/workspace/lore/shared/dist/ingest-workflow.test.js"
  },
  {
    "name": "ingestWorkflowStatus > returns missing when the file is absent",
    "file": "/home/bogdan/workspace/lore/shared/dist/ingest-workflow.test.js"
  },
  {
    "name": "ingestWorkflowStatus > returns stale when the file has no version marker (legacy broken install)",
    "file": "/home/bogdan/workspace/lore/shared/dist/ingest-workflow.test.js"
  },
  {
    "name": "ingestWorkflowStatus > returns stale when the marker version is older than current",
    "file": "/home/bogdan/workspace/lore/shared/dist/ingest-workflow.test.js"
  },
  {
    "name": "ingestWorkflowStatus > returns aligned for the canonical content",
    "file": "/home/bogdan/workspace/lore/shared/dist/ingest-workflow.test.js"
  },
  {
    "name": "ingestWorkflowStatus > returns aligned when the marker version is newer than current",
    "file": "/home/bogdan/workspace/lore/shared/dist/ingest-workflow.test.js"
  },
  {
    "name": "public barrel (index.ts) > re-exports every non-test module in src/",
    "file": "/home/bogdan/workspace/lore/shared/dist/index.test.js"
  },
  {
    "name": "lore-test-commands skill > carries the canonical TEST_COMMAND_SETUP_PROMPT verbatim",
    "file": "/home/bogdan/workspace/lore/shared/dist/lore-test-commands-skill.test.js"
  },
  {
    "name": "rrfMerge > carries confidence from the candidate onto the fused result",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "computeTransferScore > returns 0.5 for neutral text with no portable or local keywords",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "computeTransferScore > adds 0.15 per portable keyword above the base",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "computeTransferScore > subtracts 0.15 per local keyword below the base",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "computeTransferScore > clamps to 1 when many portable keywords stack",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "computeTransferScore > clamps to 0 when many local keywords stack",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "diversify > keeps only the 3 highest-scoring from one agent_id::source over the cap",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "diversify > caps each distinct agent_id::source independently",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "diversify > slices the total output to limit across all sources",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "diversify > keeps all items when each source is under the cap",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "scoreImportance > returns 10 for a fresh memory with no score adjustments",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "scoreImportance > decays to score 5 when effective age equals one half-life",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "scoreImportance > subtracts 2 for a value shorter than 50 chars",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "scoreImportance > adds 2 for a key containing gotcha",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "scoreImportance > subtracts 1 for stale confidence",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "scoreImportance > uses last_retrieved_at over created_at for effective age",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "scoreImportance > clamps to 0 when decay and penalties push below zero",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-ranking.test.js"
  },
  {
    "name": "redactSecrets > redacts ghp_ tokens",
    "file": "/home/bogdan/workspace/lore/shared/dist/redact.test.js"
  },
  {
    "name": "redactSecrets > redacts sk- tokens",
    "file": "/home/bogdan/workspace/lore/shared/dist/redact.test.js"
  },
  {
    "name": "redactSecrets > redacts AWS access keys",
    "file": "/home/bogdan/workspace/lore/shared/dist/redact.test.js"
  },
  {
    "name": "redactSecrets > redacts JWTs",
    "file": "/home/bogdan/workspace/lore/shared/dist/redact.test.js"
  },
  {
    "name": "redactSecrets > redacts PEM private keys",
    "file": "/home/bogdan/workspace/lore/shared/dist/redact.test.js"
  },
  {
    "name": "redactSecrets > redacts postgres connection strings",
    "file": "/home/bogdan/workspace/lore/shared/dist/redact.test.js"
  },
  {
    "name": "redactSecrets > redacts Bearer tokens",
    "file": "/home/bogdan/workspace/lore/shared/dist/redact.test.js"
  },
  {
    "name": "redactSecrets > redacts x-access-token clone URLs",
    "file": "/home/bogdan/workspace/lore/shared/dist/redact.test.js"
  },
  {
    "name": "redactSecrets > redacts long base64 blobs",
    "file": "/home/bogdan/workspace/lore/shared/dist/redact.test.js"
  },
  {
    "name": "redactSecrets > redacts multiple secrets in one string",
    "file": "/home/bogdan/workspace/lore/shared/dist/redact.test.js"
  },
  {
    "name": "redactSecrets > leaves normal text untouched",
    "file": "/home/bogdan/workspace/lore/shared/dist/redact.test.js"
  },
  {
    "name": "redactSecrets > leaves short token-like strings untouched",
    "file": "/home/bogdan/workspace/lore/shared/dist/redact.test.js"
  },
  {
    "name": "memoryStore > throws when no store has been set",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-store.test.js"
  },
  {
    "name": "memoryStore > returns the store registered via setMemoryStore",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-store.test.js"
  },
  {
    "name": "selectMemoryStore > returns a postgres store when LORE_MEMORY_BACKEND is unset",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-store.test.js"
  },
  {
    "name": "selectMemoryStore > throws when postgres backend is selected without a pgPool",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-store.test.js"
  },
  {
    "name": "selectMemoryStore > throws when dgraph backend is selected without a dgraph client",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-store.test.js"
  },
  {
    "name": "selectMemoryStore > returns a dgraph store when dgraph backend is selected with a client",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-store.test.js"
  },
  {
    "name": "selectMemoryStore > rolls back to postgres on the single value LORE_MEMORY_BACKEND=postgres",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-store.test.js"
  },
  {
    "name": "selectMemoryStore > flips the served backend with only the LORE_MEMORY_BACKEND value (cutover and rollback)",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-store.test.js"
  },
  {
    "name": "selectMemoryStore > throws on an unrecognized LORE_MEMORY_BACKEND value instead of silently serving postgres",
    "file": "/home/bogdan/workspace/lore/shared/dist/memory-store.test.js"
  },
  {
    "name": "LORE_TESTS_INSTRUCTION > is a non-empty string",
    "file": "/home/bogdan/workspace/lore/shared/dist/lore-tests-instruction.test.js"
  },
  {
    "name": "LORE_TESTS_INSTRUCTION > names no concrete language or test runner",
    "file": "/home/bogdan/workspace/lore/shared/dist/lore-tests-instruction.test.js"
  },
  {
    "name": "LORE_TESTS_INSTRUCTION > instructs running on both push and pull_request",
    "file": "/home/bogdan/workspace/lore/shared/dist/lore-tests-instruction.test.js"
  },
  {
    "name": "LORE_TESTS_INSTRUCTION > instructs posting to the test-report ingest route",
    "file": "/home/bogdan/workspace/lore/shared/dist/lore-tests-instruction.test.js"
  },
  {
    "name": "LORE_TESTS_INSTRUCTION > instructs running the .lore/test-commands.yml commands",
    "file": "/home/bogdan/workspace/lore/shared/dist/lore-tests-instruction.test.js"
  },
  {
    "name": "LORE_TESTS_INSTRUCTION > instructs one subdir-scoped job per detected toolchain for monorepos",
    "file": "/home/bogdan/workspace/lore/shared/dist/lore-tests-instruction.test.js"
  },
  {
    "name": "LORE_TESTS_INSTRUCTION > names the LORE_INGEST_TOKEN secret and LORE_INGEST_URL var",
    "file": "/home/bogdan/workspace/lore/shared/dist/lore-tests-instruction.test.js"
  },
  {
    "name": "linkifyMarkdown > links a file path to the GitHub blob url on the given branch",
    "file": "/home/bogdan/workspace/lore/shared/dist/references.test.js"
  },
  {
    "name": "linkifyMarkdown > defaults to the main branch when none is given",
    "file": "/home/bogdan/workspace/lore/shared/dist/references.test.js"
  },
  {
    "name": "linkifyMarkdown > links an issue reference to the issues url",
    "file": "/home/bogdan/workspace/lore/shared/dist/references.test.js"
  },
  {
    "name": "linkifyMarkdown > links a task uuid to the web-ui pipeline page when uiUrl is set",
    "file": "/home/bogdan/workspace/lore/shared/dist/references.test.js"
  },
  {
    "name": "linkifyMarkdown > leaves a uuid untouched when no uiUrl is configured",
    "file": "/home/bogdan/workspace/lore/shared/dist/references.test.js"
  },
  {
    "name": "linkifyMarkdown > does not linkify inside inline code",
    "file": "/home/bogdan/workspace/lore/shared/dist/references.test.js"
  },
  {
    "name": "linkifyMarkdown > does not touch an existing markdown link",
    "file": "/home/bogdan/workspace/lore/shared/dist/references.test.js"
  },
  {
    "name": "linkifyMarkdown > does not linkify a path inside a bare url",
    "file": "/home/bogdan/workspace/lore/shared/dist/references.test.js"
  },
  {
    "name": "linkifyMarkdown > links multiple references in one string",
    "file": "/home/bogdan/workspace/lore/shared/dist/references.test.js"
  },
  {
    "name": "linkifyMarkdown > strips a leading ./ from the linked path",
    "file": "/home/bogdan/workspace/lore/shared/dist/references.test.js"
  },
  {
    "name": "linkifyMarkdown > leaves plain prose with no references unchanged",
    "file": "/home/bogdan/workspace/lore/shared/dist/references.test.js"
  },
  {
    "name": "linkifyMarkdown > does not treat a version number as a file path",
    "file": "/home/bogdan/workspace/lore/shared/dist/references.test.js"
  },
  {
    "name": "parseReferences > returns text and link segments in order",
    "file": "/home/bogdan/workspace/lore/shared/dist/references.test.js"
  },
  {
    "name": "parseReferences > returns a single text segment for plain prose",
    "file": "/home/bogdan/workspace/lore/shared/dist/references.test.js"
  },
  {
    "name": "segmentBlocks / reassembleBlocks > round-trips a single-paragraph source verbatim",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-blocks.test.js"
  },
  {
    "name": "segmentBlocks / reassembleBlocks > segments two blank-separated paragraphs into paragraph, blank, paragraph",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-blocks.test.js"
  },
  {
    "name": "segmentBlocks / reassembleBlocks > splits an ATX heading into a level-2 heading block before the following paragraph",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-blocks.test.js"
  },
  {
    "name": "segmentBlocks / reassembleBlocks > keeps a fenced code block with an internal blank and # line as one verbatim code block",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-blocks.test.js"
  },
  {
    "name": "segmentBlocks / reassembleBlocks > groups header, separator, and data rows into one table block",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-blocks.test.js"
  },
  {
    "name": "segmentBlocks / reassembleBlocks > splits two bullet lines into two separate list-item blocks",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-blocks.test.js"
  },
  {
    "name": "ShadowMemoryStore > serves readMemory from the primary, not the shadow",
    "file": "/home/bogdan/workspace/lore/shared/dist/shadow-memory-store.test.js"
  },
  {
    "name": "ShadowMemoryStore > emits lore.memory.shadow_divergence when primary and shadow differ",
    "file": "/home/bogdan/workspace/lore/shared/dist/shadow-memory-store.test.js"
  },
  {
    "name": "ShadowMemoryStore > serves the primary result when the shadow read throws",
    "file": "/home/bogdan/workspace/lore/shared/dist/shadow-memory-store.test.js"
  },
  {
    "name": "ShadowMemoryStore > logs the shadow error through the injected sink when the shadow read throws",
    "file": "/home/bogdan/workspace/lore/shared/dist/shadow-memory-store.test.js"
  },
  {
    "name": "ShadowMemoryStore > emits no divergence metric when primary and shadow agree",
    "file": "/home/bogdan/workspace/lore/shared/dist/shadow-memory-store.test.js"
  },
  {
    "name": "ShadowMemoryStore > emits no divergence metric when the shadow read throws (a throw is not a divergence)",
    "file": "/home/bogdan/workspace/lore/shared/dist/shadow-memory-store.test.js"
  },
  {
    "name": "specFeatureSlug > returns the feature directory under specs/",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "specFeatureSlug > falls back to the parent directory when there is no specs/ segment",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "specFeatureSlug > returns null for a bare filename",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "hasDirectoryAffinity > returns true when the test path shares a majority of slug tokens",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "hasDirectoryAffinity > returns false when the test path shares no slug tokens",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "hasDirectoryAffinity > returns false when the slug has no significant tokens",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "cosineSimilarity > returns 1 for identical vectors",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "cosineSimilarity > returns 0 for orthogonal vectors",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "cosineSimilarity > returns 0 for empty or length-mismatched vectors",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "cosineSimilarity > returns 0 when either vector has zero magnitude",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "matchedAssertion > returns the assertion name the content references, case-insensitively",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "matchedAssertion > skips assertion names shorter than three characters",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "matchedAssertion > returns null when no assertion is referenced",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "deriveTestName > joins parent_symbol and symbol_name into a normalized name",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "deriveTestName > falls back to the describe key when parent_symbol is absent",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "deriveTestName > returns null for null metadata or a missing symbol name",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "parseEmbedding > returns the array unchanged when already an array",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "parseEmbedding > parses a pgvector string representation",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "parseEmbedding > returns null for malformed, empty, or non-string input",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "selectCandidates > classifies an assertion-overlap candidate as kind 'assertion'",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "selectCandidates > falls back to directory affinity then embedding proximity",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "selectCandidates > skips non-test files and chunks with no test name",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "selectCandidates > dedups by test, keeping the strongest signal",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "selectCandidates > caps at maxCandidates and flags truncation",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "argmaxByTest > keeps the highest-scoring judgment per test",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "argmaxByTest > drops non-matches and sub-threshold scores",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "staleLinkKeys > returns existing links no longer confirmed this run",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "staleStatementOrdinals > returns ordinals no longer present in the current run",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "hashSpecContent > returns a stable 64-char sha-256 hex digest",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "hashSpecContent > returns a different digest for different content",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-judge.test.js"
  },
  {
    "name": "parseTestLinksInStatement > returns an empty array when the statement has no trailing parenthetical",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "parseTestLinksInStatement > returns an empty array when the trailing paren contains no markdown links",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "parseTestLinksInStatement > parses a single test-link parenthetical at end of statement",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "parseTestLinksInStatement > parses multiple comma-separated test links inside one paren",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "parseTestLinksInStatement > ignores non-test links inside the trailing paren (ADR / docs / external)",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "parseTestLinksInStatement > returns an empty array when the trailing paren contains ONLY non-test links",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "parseTestLinksInStatement > parses a link with no #Lline anchor (line is null)",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "parseTestLinksInStatement > strips a leading slash on the href so paths normalize repo-relative",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "parseTestLinksInStatement > recognizes the Go test path convention",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "parseTestLinksInStatement > ignores links inside the body of the statement (only trailing paren matters)",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "parseTestLinksInStatement > handles a trailing period after the closing parenthesis",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "parseTestLinksInStatement > collapses internal whitespace in the label",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "parseCodeLinksInStatement > parses a single non-test code link into one code-link ref",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "parseCodeLinksInStatement > excludes a markdown doc link so an ADR ref is not a code link",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "parseCodeLinksInStatement > keeps a non-test source path in another language as a code link",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "linksForStatements > pairs each segmented statement with its parsed test links",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "findMisplacedCoverageLinks > flags a coverage link buried in a non-trailing parenthetical",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "findMisplacedCoverageLinks > does not flag a link that is correctly in the trailing parenthetical",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "findMisplacedCoverageLinks > ignores a non-trailing prose doc link",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-link-parser.test.js"
  },
  {
    "name": "parseSpecTitle > returns the first H1 stripped of the hash",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-summary.test.js"
  },
  {
    "name": "parseSpecTitle > strips a 'Feature Specification:' prefix from the H1",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-summary.test.js"
  },
  {
    "name": "parseSpecTitle > falls back to the feature directory name when there is no H1",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-summary.test.js"
  },
  {
    "name": "parseSpecTitle > falls back to the file path when there is no H1 and no feature dir",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-summary.test.js"
  },
  {
    "name": "extractSummary > returns the first non-heading, non-table paragraph",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-summary.test.js"
  },
  {
    "name": "extractSummary > collapses internal whitespace and joins wrapped lines",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-summary.test.js"
  },
  {
    "name": "extractSummary > truncates to the max length with an ellipsis",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-summary.test.js"
  },
  {
    "name": "extractSummary > returns an empty string when there is no paragraph",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-summary.test.js"
  },
  {
    "name": "extractSummary > skips a leading blockquote note and returns the first prose paragraph",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-summary.test.js"
  },
  {
    "name": "reassembleSpec > joins chunk contents in order",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-summary.test.js"
  },
  {
    "name": "reassembleSpec > deduplicates identical chunk contents",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-summary.test.js"
  },
  {
    "name": "segmentStatements > splits prose paragraphs into sentences",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "segmentStatements > treats each list item as its own statement",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "segmentStatements > joins multi-line list-item continuations into one statement",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "segmentStatements > excludes headings, fenced code, and tables",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "segmentStatements > guards against splitting on abbreviations (e.g., i.e., etc.)",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "segmentStatements > guards against single-letter initials in caps",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "segmentStatements > does not split when the next non-space char is lowercase",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "segmentStatements > tracks the enclosing heading per statement",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "segmentStatements > produces deterministic ordinals across re-runs",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "segmentStatements > returns an empty array for content with no statements",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "buildIntroOrdinals > marks statements under the document's first heading as intro",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "buildIntroOrdinals > treats statements with no enclosing heading as intro",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "classifyByHeuristic > marks intro-ordinal statements untestable as 'intro'",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "classifyByHeuristic > classifies Problem Statement as background",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "classifyByHeuristic > classifies Vision as vision",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "classifyByHeuristic > classifies Clarifications as clarification",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "classifyByHeuristic > classifies Open Questions as open-question",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "classifyByHeuristic > classifies Limitations as limitation",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "classifyByHeuristic > classifies Rationale as rationale",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "classifyByHeuristic > returns testable + matchedBySection=false for unrecognised headings",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-segment.test.js"
  },
  {
    "name": "parseTestCommandManifest > normalizes a minimal valid manifest into a one-element list with defaults",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-command-manifest.test.js"
  },
  {
    "name": "parseTestCommandManifest > throws when the run command is missing",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-command-manifest.test.js"
  },
  {
    "name": "parseTestCommandManifest > throws when the run command omits the {selector} placeholder",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-command-manifest.test.js"
  },
  {
    "name": "parseTestCommandManifest > throws on an unknown coverage_format",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-command-manifest.test.js"
  },
  {
    "name": "parseTestCommandManifest > normalizes a polyglot array into one entry per manifest",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-command-manifest.test.js"
  },
  {
    "name": "parseTestCommandManifest > preserves a provided cwd and path_prefix_strip",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-command-manifest.test.js"
  },
  {
    "name": "resolveTestCommandManifest > returns null when neither settings nor file declare a manifest",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-command-manifest.test.js"
  },
  {
    "name": "resolveTestCommandManifest > prefers settings over the file when both are present",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-command-manifest.test.js"
  },
  {
    "name": "resolveTestCommandManifest > falls back to the file when settings are absent",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-command-manifest.test.js"
  },
  {
    "name": "decideTestInterfaceCheck > scaffolds both files when no manifest is declared",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-command-manifest.test.js"
  },
  {
    "name": "decideTestInterfaceCheck > reports configured when the .lore/test-commands.yml file is declared",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-command-manifest.test.js"
  },
  {
    "name": "decideTestInterfaceCheck > reports configured when settings declare test_commands without a file",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-command-manifest.test.js"
  },
  {
    "name": "isManifestDeclared > returns false when neither a file nor settings declare a manifest",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-command-manifest.test.js"
  },
  {
    "name": "substituteSelector > replaces every {selector} placeholder with the runner-native id",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-command-manifest.test.js"
  },
  {
    "name": "parseTestDescriptors > parses a descriptor carrying every field",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-report.test.js"
  },
  {
    "name": "parseTestDescriptors > carries the suite chain outermost to innermost",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-report.test.js"
  },
  {
    "name": "parseTestDescriptors > omits a suite array holding a non-string element",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-report.test.js"
  },
  {
    "name": "parseTestDescriptors > omits optional fields a descriptor does not declare",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-report.test.js"
  },
  {
    "name": "parseTestDescriptors > throws when the required id is missing",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-report.test.js"
  },
  {
    "name": "parseTestDescriptors > throws when the required name is missing",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-report.test.js"
  },
  {
    "name": "parseTestDescriptors > throws when the required file is missing",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-report.test.js"
  },
  {
    "name": "parseRunResult > parses passed + a list of covered chunks",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-report.test.js"
  },
  {
    "name": "parseRunResult > throws when a covered chunk is missing its line bounds",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-report.test.js"
  },
  {
    "name": "isTestFile > recognizes test-path conventions across languages and rejects production paths",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-paths.test.js"
  },
  {
    "name": "normalizeTestName > lowercases, collapses whitespace and joins with a wedge",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-paths.test.js"
  },
  {
    "name": "normalizeTestName > omits an empty describe segment",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-paths.test.js"
  },
  {
    "name": "normalizeTestName > returns identical keys for the same test described with differing whitespace",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-paths.test.js"
  },
  {
    "name": "TEST_COMMAND_SETUP_PROMPT > is a non-empty string",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-command-setup-prompt.test.js"
  },
  {
    "name": "TEST_COMMAND_SETUP_PROMPT > names no concrete language or test runner",
    "file": "/home/bogdan/workspace/lore/shared/dist/test-command-setup-prompt.test.js"
  },
  {
    "name": "resolveAgentId > returns the explicit agent id over all other sources",
    "file": "/home/bogdan/workspace/lore/shared/src/agent-id.test.ts"
  },
  {
    "name": "resolveAgentId > returns LORE_AGENT_ID when no explicit id is given",
    "file": "/home/bogdan/workspace/lore/shared/src/agent-id.test.ts"
  },
  {
    "name": "resolveAgentId > reads ~/.lore/agent-id when no explicit id or env var",
    "file": "/home/bogdan/workspace/lore/shared/src/agent-id.test.ts"
  },
  {
    "name": "resolveAgentId > generates a uuid and persists it when no source is set",
    "file": "/home/bogdan/workspace/lore/shared/src/agent-id.test.ts"
  },
  {
    "name": "jaccard > returns 1 for two identical result sets",
    "file": "/home/bogdan/workspace/lore/shared/src/backfill-parity.test.ts"
  },
  {
    "name": "jaccard > returns 0.5 for {a,b,c} vs {a,b,d} (2 shared of 4 total)",
    "file": "/home/bogdan/workspace/lore/shared/src/backfill-parity.test.ts"
  },
  {
    "name": "jaccard > returns 0 for disjoint result sets",
    "file": "/home/bogdan/workspace/lore/shared/src/backfill-parity.test.ts"
  },
  {
    "name": "jaccard > returns 1 for two empty sets (vacuously identical)",
    "file": "/home/bogdan/workspace/lore/shared/src/backfill-parity.test.ts"
  },
  {
    "name": "jaccard > treats inputs as sets, deduping repeats",
    "file": "/home/bogdan/workspace/lore/shared/src/backfill-parity.test.ts"
  },
  {
    "name": "meanTopkJaccard > returns 0.7 for [1, 0.5, 0.6] (sum 2.1 over 3)",
    "file": "/home/bogdan/workspace/lore/shared/src/backfill-parity.test.ts"
  },
  {
    "name": "meanTopkJaccard > returns 0 (not NaN) for an empty sample so the retrieval gate fails loudly",
    "file": "/home/bogdan/workspace/lore/shared/src/backfill-parity.test.ts"
  },
  {
    "name": "evaluateParityGates > passes with exit 0 when every table count matches and mean jaccard is 0.87",
    "file": "/home/bogdan/workspace/lore/shared/src/backfill-parity.test.ts"
  },
  {
    "name": "evaluateParityGates > fails with non-zero exit naming the table when facts count mismatches",
    "file": "/home/bogdan/workspace/lore/shared/src/backfill-parity.test.ts"
  },
  {
    "name": "evaluateParityGates > fails with non-zero exit naming the jaccard gate when tables match but mean jaccard is 0.5",
    "file": "/home/bogdan/workspace/lore/shared/src/backfill-parity.test.ts"
  },
  {
    "name": "evaluateParityGates > passes when mean jaccard is exactly the threshold 0.8 (gate is >=)",
    "file": "/home/bogdan/workspace/lore/shared/src/backfill-parity.test.ts"
  },
  {
    "name": "evaluateParityGates > accumulates both a table-mismatch and a jaccard failure when both gates fail",
    "file": "/home/bogdan/workspace/lore/shared/src/backfill-parity.test.ts"
  },
  {
    "name": "evaluateParityGates > fails a jaccard of 0.9 against a stricter custom threshold of 0.95",
    "file": "/home/bogdan/workspace/lore/shared/src/backfill-parity.test.ts"
  },
  {
    "name": "chunkFile > stamps content_hash equal to sha256 of the chunk's own content",
    "file": "/home/bogdan/workspace/lore/shared/src/chunker.test.ts"
  },
  {
    "name": "buildIngestedChunkMetadata > carries content_hash, file_path, and ingested_by from an api ingest",
    "file": "/home/bogdan/workspace/lore/shared/src/chunker.test.ts"
  },
  {
    "name": "buildIngestedChunkMetadata > omits commit when not provided for a reindex-job ingest",
    "file": "/home/bogdan/workspace/lore/shared/src/chunker.test.ts"
  },
  {
    "name": "createDgraphClient > returns a client exposing newTxn when LORE_DGRAPH_HTTP is set",
    "file": "/home/bogdan/workspace/lore/shared/src/dgraph-client.test.ts"
  },
  {
    "name": "auditDgraphAcl > returns no violations for no documents",
    "file": "/home/bogdan/workspace/lore/shared/src/dgraph-acl-policy.test.ts"
  },
  {
    "name": "auditDgraphAcl > flags a container env that hardcodes a credential value",
    "file": "/home/bogdan/workspace/lore/shared/src/dgraph-acl-policy.test.ts"
  },
  {
    "name": "auditDgraphAcl > flags a dgraph alpha workload whose args do not enable --acl",
    "file": "/home/bogdan/workspace/lore/shared/src/dgraph-acl-policy.test.ts"
  },
  {
    "name": "auditDgraphAcl > flags a runtime StatefulSet that references the guardian credential",
    "file": "/home/bogdan/workspace/lore/shared/src/dgraph-acl-policy.test.ts"
  },
  {
    "name": "auditDgraphAcl > flags a ServiceAccount missing the Workload Identity annotation",
    "file": "/home/bogdan/workspace/lore/shared/src/dgraph-acl-policy.test.ts"
  },
  {
    "name": "auditDgraphAcl > returns no violations for a fully compliant Dgraph deployment set",
    "file": "/home/bogdan/workspace/lore/shared/src/dgraph-acl-policy.test.ts"
  },
  {
    "name": "auditDgraphAcl > does not flag a secretKeyRef env (no literal value) as a hardcoded credential",
    "file": "/home/bogdan/workspace/lore/shared/src/dgraph-acl-policy.test.ts"
  },
  {
    "name": "auditDgraphAcl > does not flag the pre-install bootstrap Job for using the guardian credential",
    "file": "/home/bogdan/workspace/lore/shared/src/dgraph-acl-policy.test.ts"
  },
  {
    "name": "classifyFile > classifies CLAUDE.md / AGENTS.md / CODEOWNERS as doc",
    "file": "/home/bogdan/workspace/lore/shared/src/content-classify.test.ts"
  },
  {
    "name": "classifyFile > classifies top-level adrs/specs markdown as adr/spec",
    "file": "/home/bogdan/workspace/lore/shared/src/content-classify.test.ts"
  },
  {
    "name": "classifyFile > classifies source files as code by extension",
    "file": "/home/bogdan/workspace/lore/shared/src/content-classify.test.ts"
  },
  {
    "name": "classifyFile > classifies a .tsx/.jsx source file under a nested specs/ dir as code, not spec",
    "file": "/home/bogdan/workspace/lore/shared/src/content-classify.test.ts"
  },
  {
    "name": "classifyFile > classifies a source file under a nested adrs/ or runbooks/ dir as code",
    "file": "/home/bogdan/workspace/lore/shared/src/content-classify.test.ts"
  },
  {
    "name": "classifyFile > still classifies a real markdown spec under a nested specs/ dir as spec",
    "file": "/home/bogdan/workspace/lore/shared/src/content-classify.test.ts"
  },
  {
    "name": "classifyFile > returns code for the new tsx/jsx/mjs/cjs extensions",
    "file": "/home/bogdan/workspace/lore/shared/src/content-classify.test.ts"
  },
  {
    "name": "classifyFile > classifies other markdown / yaml as doc and skips binaries/unknowns",
    "file": "/home/bogdan/workspace/lore/shared/src/content-classify.test.ts"
  },
  {
    "name": "public barrel (index.ts) > re-exports every non-test module in src/",
    "file": "/home/bogdan/workspace/lore/shared/src/index.test.ts"
  },
  {
    "name": "formatTrailers > formats minimal trailer block",
    "file": "/home/bogdan/workspace/lore/shared/src/commit-trailers.test.ts"
  },
  {
    "name": "formatTrailers > appends extras after required keys",
    "file": "/home/bogdan/workspace/lore/shared/src/commit-trailers.test.ts"
  },
  {
    "name": "parseTrailers > round-trips a minimal trailer block",
    "file": "/home/bogdan/workspace/lore/shared/src/commit-trailers.test.ts"
  },
  {
    "name": "parseTrailers > round-trips with extras",
    "file": "/home/bogdan/workspace/lore/shared/src/commit-trailers.test.ts"
  },
  {
    "name": "parseTrailers > parses trailer block at end of multi-paragraph commit",
    "file": "/home/bogdan/workspace/lore/shared/src/commit-trailers.test.ts"
  },
  {
    "name": "parseTrailers > returns null when no trailers present",
    "file": "/home/bogdan/workspace/lore/shared/src/commit-trailers.test.ts"
  },
  {
    "name": "parseTrailers > returns null when required key is missing",
    "file": "/home/bogdan/workspace/lore/shared/src/commit-trailers.test.ts"
  },
  {
    "name": "parseTrailers > returns null when iteration is not a number",
    "file": "/home/bogdan/workspace/lore/shared/src/commit-trailers.test.ts"
  },
  {
    "name": "parseTrailers > returns null when last paragraph mixes trailer and non-trailer lines",
    "file": "/home/bogdan/workspace/lore/shared/src/commit-trailers.test.ts"
  },
  {
    "name": "parseTrailers > returns null for empty input",
    "file": "/home/bogdan/workspace/lore/shared/src/commit-trailers.test.ts"
  },
  {
    "name": "parseTrailers > preserves arbitrary extras",
    "file": "/home/bogdan/workspace/lore/shared/src/commit-trailers.test.ts"
  },
  {
    "name": "parseTrailers > handles CRLF line endings",
    "file": "/home/bogdan/workspace/lore/shared/src/commit-trailers.test.ts"
  },
  {
    "name": "parseTrailers > strips trailing whitespace before parsing",
    "file": "/home/bogdan/workspace/lore/shared/src/commit-trailers.test.ts"
  },
  {
    "name": "parseTrailers > omits extras when only required keys are present",
    "file": "/home/bogdan/workspace/lore/shared/src/commit-trailers.test.ts"
  },
  {
    "name": "parseValidatesTrailers > returns one ref with numeric ordinal for a single Lore-Validates line",
    "file": "/home/bogdan/workspace/lore/shared/src/commit-trailers.test.ts"
  },
  {
    "name": "formatValidatesTrailer > renders specs/foo/spec.md#7 -> test/x.test.ts and round-trips through parseValidatesTrailers",
    "file": "/home/bogdan/workspace/lore/shared/src/commit-trailers.test.ts"
  },
  {
    "name": "LORE_INGEST_WORKFLOW_CONTENT > targets the workflows path",
    "file": "/home/bogdan/workspace/lore/shared/src/ingest-workflow.test.ts"
  },
  {
    "name": "LORE_INGEST_WORKFLOW_CONTENT > carries the current version marker on the first line",
    "file": "/home/bogdan/workspace/lore/shared/src/ingest-workflow.test.ts"
  },
  {
    "name": "LORE_INGEST_WORKFLOW_CONTENT > exposes FILES as a step-level env var, not inside the run block",
    "file": "/home/bogdan/workspace/lore/shared/src/ingest-workflow.test.ts"
  },
  {
    "name": "LORE_INGEST_WORKFLOW_CONTENT > sends a literal-escaped JSON body referencing the FILES env var",
    "file": "/home/bogdan/workspace/lore/shared/src/ingest-workflow.test.ts"
  },
  {
    "name": "LORE_INGEST_WORKFLOW_CONTENT > posts to the ingest endpoint without a self-referential url fallback",
    "file": "/home/bogdan/workspace/lore/shared/src/ingest-workflow.test.ts"
  },
  {
    "name": "LORE_INGEST_WORKFLOW_CONTENT > keeps the secret and token wiring",
    "file": "/home/bogdan/workspace/lore/shared/src/ingest-workflow.test.ts"
  },
  {
    "name": "parseIngestWorkflowVersion > reads the version from the marker line",
    "file": "/home/bogdan/workspace/lore/shared/src/ingest-workflow.test.ts"
  },
  {
    "name": "parseIngestWorkflowVersion > returns null when no marker is present",
    "file": "/home/bogdan/workspace/lore/shared/src/ingest-workflow.test.ts"
  },
  {
    "name": "ingestWorkflowStatus > returns missing when the file is absent",
    "file": "/home/bogdan/workspace/lore/shared/src/ingest-workflow.test.ts"
  },
  {
    "name": "ingestWorkflowStatus > returns stale when the file has no version marker (legacy broken install)",
    "file": "/home/bogdan/workspace/lore/shared/src/ingest-workflow.test.ts"
  },
  {
    "name": "ingestWorkflowStatus > returns stale when the marker version is older than current",
    "file": "/home/bogdan/workspace/lore/shared/src/ingest-workflow.test.ts"
  },
  {
    "name": "ingestWorkflowStatus > returns aligned for the canonical content",
    "file": "/home/bogdan/workspace/lore/shared/src/ingest-workflow.test.ts"
  },
  {
    "name": "ingestWorkflowStatus > returns aligned when the marker version is newer than current",
    "file": "/home/bogdan/workspace/lore/shared/src/ingest-workflow.test.ts"
  },
  {
    "name": "lore-test-commands skill > carries the canonical TEST_COMMAND_SETUP_PROMPT verbatim",
    "file": "/home/bogdan/workspace/lore/shared/src/lore-test-commands-skill.test.ts"
  },
  {
    "name": "LORE_TESTS_INSTRUCTION > is a non-empty string",
    "file": "/home/bogdan/workspace/lore/shared/src/lore-tests-instruction.test.ts"
  },
  {
    "name": "LORE_TESTS_INSTRUCTION > names no concrete language or test runner",
    "file": "/home/bogdan/workspace/lore/shared/src/lore-tests-instruction.test.ts"
  },
  {
    "name": "LORE_TESTS_INSTRUCTION > instructs running on both push and pull_request",
    "file": "/home/bogdan/workspace/lore/shared/src/lore-tests-instruction.test.ts"
  },
  {
    "name": "LORE_TESTS_INSTRUCTION > instructs posting to the test-report ingest route",
    "file": "/home/bogdan/workspace/lore/shared/src/lore-tests-instruction.test.ts"
  },
  {
    "name": "LORE_TESTS_INSTRUCTION > instructs running the .lore/test-commands.yml commands",
    "file": "/home/bogdan/workspace/lore/shared/src/lore-tests-instruction.test.ts"
  },
  {
    "name": "LORE_TESTS_INSTRUCTION > instructs one subdir-scoped job per detected toolchain for monorepos",
    "file": "/home/bogdan/workspace/lore/shared/src/lore-tests-instruction.test.ts"
  },
  {
    "name": "LORE_TESTS_INSTRUCTION > names the LORE_INGEST_TOKEN secret and LORE_INGEST_URL var",
    "file": "/home/bogdan/workspace/lore/shared/src/lore-tests-instruction.test.ts"
  },
  {
    "name": "memoryStore > throws when no store has been set",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-store.test.ts"
  },
  {
    "name": "memoryStore > returns the store registered via setMemoryStore",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-store.test.ts"
  },
  {
    "name": "selectMemoryStore > returns a postgres store when LORE_MEMORY_BACKEND is unset",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-store.test.ts"
  },
  {
    "name": "selectMemoryStore > throws when postgres backend is selected without a pgPool",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-store.test.ts"
  },
  {
    "name": "selectMemoryStore > throws when dgraph backend is selected without a dgraph client",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-store.test.ts"
  },
  {
    "name": "selectMemoryStore > returns a dgraph store when dgraph backend is selected with a client",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-store.test.ts"
  },
  {
    "name": "selectMemoryStore > rolls back to postgres on the single value LORE_MEMORY_BACKEND=postgres",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-store.test.ts"
  },
  {
    "name": "selectMemoryStore > flips the served backend with only the LORE_MEMORY_BACKEND value (cutover and rollback)",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-store.test.ts"
  },
  {
    "name": "selectMemoryStore > throws on an unrecognized LORE_MEMORY_BACKEND value instead of silently serving postgres",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-store.test.ts"
  },
  {
    "name": "rrfMerge > carries confidence from the candidate onto the fused result",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "computeTransferScore > returns 0.5 for neutral text with no portable or local keywords",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "computeTransferScore > adds 0.15 per portable keyword above the base",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "computeTransferScore > subtracts 0.15 per local keyword below the base",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "computeTransferScore > clamps to 1 when many portable keywords stack",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "computeTransferScore > clamps to 0 when many local keywords stack",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "diversify > keeps only the 3 highest-scoring from one agent_id::source over the cap",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "diversify > caps each distinct agent_id::source independently",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "diversify > slices the total output to limit across all sources",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "diversify > keeps all items when each source is under the cap",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "scoreImportance > returns 10 for a fresh memory with no score adjustments",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "scoreImportance > decays to score 5 when effective age equals one half-life",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "scoreImportance > subtracts 2 for a value shorter than 50 chars",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "scoreImportance > adds 2 for a key containing gotcha",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "scoreImportance > subtracts 1 for stale confidence",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "scoreImportance > uses last_retrieved_at over created_at for effective age",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "scoreImportance > clamps to 0 when decay and penalties push below zero",
    "file": "/home/bogdan/workspace/lore/shared/src/memory-ranking.test.ts"
  },
  {
    "name": "redactSecrets > redacts ghp_ tokens",
    "file": "/home/bogdan/workspace/lore/shared/src/redact.test.ts"
  },
  {
    "name": "redactSecrets > redacts sk- tokens",
    "file": "/home/bogdan/workspace/lore/shared/src/redact.test.ts"
  },
  {
    "name": "redactSecrets > redacts AWS access keys",
    "file": "/home/bogdan/workspace/lore/shared/src/redact.test.ts"
  },
  {
    "name": "redactSecrets > redacts JWTs",
    "file": "/home/bogdan/workspace/lore/shared/src/redact.test.ts"
  },
  {
    "name": "redactSecrets > redacts PEM private keys",
    "file": "/home/bogdan/workspace/lore/shared/src/redact.test.ts"
  },
  {
    "name": "redactSecrets > redacts postgres connection strings",
    "file": "/home/bogdan/workspace/lore/shared/src/redact.test.ts"
  },
  {
    "name": "redactSecrets > redacts Bearer tokens",
    "file": "/home/bogdan/workspace/lore/shared/src/redact.test.ts"
  },
  {
    "name": "redactSecrets > redacts x-access-token clone URLs",
    "file": "/home/bogdan/workspace/lore/shared/src/redact.test.ts"
  },
  {
    "name": "redactSecrets > redacts long base64 blobs",
    "file": "/home/bogdan/workspace/lore/shared/src/redact.test.ts"
  },
  {
    "name": "redactSecrets > redacts multiple secrets in one string",
    "file": "/home/bogdan/workspace/lore/shared/src/redact.test.ts"
  },
  {
    "name": "redactSecrets > leaves normal text untouched",
    "file": "/home/bogdan/workspace/lore/shared/src/redact.test.ts"
  },
  {
    "name": "redactSecrets > leaves short token-like strings untouched",
    "file": "/home/bogdan/workspace/lore/shared/src/redact.test.ts"
  },
  {
    "name": "linkifyMarkdown > links a file path to the GitHub blob url on the given branch",
    "file": "/home/bogdan/workspace/lore/shared/src/references.test.ts"
  },
  {
    "name": "linkifyMarkdown > defaults to the main branch when none is given",
    "file": "/home/bogdan/workspace/lore/shared/src/references.test.ts"
  },
  {
    "name": "linkifyMarkdown > links an issue reference to the issues url",
    "file": "/home/bogdan/workspace/lore/shared/src/references.test.ts"
  },
  {
    "name": "linkifyMarkdown > links a task uuid to the web-ui pipeline page when uiUrl is set",
    "file": "/home/bogdan/workspace/lore/shared/src/references.test.ts"
  },
  {
    "name": "linkifyMarkdown > leaves a uuid untouched when no uiUrl is configured",
    "file": "/home/bogdan/workspace/lore/shared/src/references.test.ts"
  },
  {
    "name": "linkifyMarkdown > does not linkify inside inline code",
    "file": "/home/bogdan/workspace/lore/shared/src/references.test.ts"
  },
  {
    "name": "linkifyMarkdown > does not touch an existing markdown link",
    "file": "/home/bogdan/workspace/lore/shared/src/references.test.ts"
  },
  {
    "name": "linkifyMarkdown > does not linkify a path inside a bare url",
    "file": "/home/bogdan/workspace/lore/shared/src/references.test.ts"
  },
  {
    "name": "linkifyMarkdown > links multiple references in one string",
    "file": "/home/bogdan/workspace/lore/shared/src/references.test.ts"
  },
  {
    "name": "linkifyMarkdown > strips a leading ./ from the linked path",
    "file": "/home/bogdan/workspace/lore/shared/src/references.test.ts"
  },
  {
    "name": "linkifyMarkdown > leaves plain prose with no references unchanged",
    "file": "/home/bogdan/workspace/lore/shared/src/references.test.ts"
  },
  {
    "name": "linkifyMarkdown > does not treat a version number as a file path",
    "file": "/home/bogdan/workspace/lore/shared/src/references.test.ts"
  },
  {
    "name": "parseReferences > returns text and link segments in order",
    "file": "/home/bogdan/workspace/lore/shared/src/references.test.ts"
  },
  {
    "name": "parseReferences > returns a single text segment for plain prose",
    "file": "/home/bogdan/workspace/lore/shared/src/references.test.ts"
  },
  {
    "name": "ShadowMemoryStore > serves readMemory from the primary, not the shadow",
    "file": "/home/bogdan/workspace/lore/shared/src/shadow-memory-store.test.ts"
  },
  {
    "name": "ShadowMemoryStore > emits lore.memory.shadow_divergence when primary and shadow differ",
    "file": "/home/bogdan/workspace/lore/shared/src/shadow-memory-store.test.ts"
  },
  {
    "name": "ShadowMemoryStore > serves the primary result when the shadow read throws",
    "file": "/home/bogdan/workspace/lore/shared/src/shadow-memory-store.test.ts"
  },
  {
    "name": "ShadowMemoryStore > logs the shadow error through the injected sink when the shadow read throws",
    "file": "/home/bogdan/workspace/lore/shared/src/shadow-memory-store.test.ts"
  },
  {
    "name": "ShadowMemoryStore > emits no divergence metric when primary and shadow agree",
    "file": "/home/bogdan/workspace/lore/shared/src/shadow-memory-store.test.ts"
  },
  {
    "name": "ShadowMemoryStore > emits no divergence metric when the shadow read throws (a throw is not a divergence)",
    "file": "/home/bogdan/workspace/lore/shared/src/shadow-memory-store.test.ts"
  },
  {
    "name": "segmentBlocks / reassembleBlocks > round-trips a single-paragraph source verbatim",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-blocks.test.ts"
  },
  {
    "name": "segmentBlocks / reassembleBlocks > segments two blank-separated paragraphs into paragraph, blank, paragraph",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-blocks.test.ts"
  },
  {
    "name": "segmentBlocks / reassembleBlocks > splits an ATX heading into a level-2 heading block before the following paragraph",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-blocks.test.ts"
  },
  {
    "name": "segmentBlocks / reassembleBlocks > keeps a fenced code block with an internal blank and # line as one verbatim code block",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-blocks.test.ts"
  },
  {
    "name": "segmentBlocks / reassembleBlocks > groups header, separator, and data rows into one table block",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-blocks.test.ts"
  },
  {
    "name": "segmentBlocks / reassembleBlocks > splits two bullet lines into two separate list-item blocks",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-blocks.test.ts"
  },
  {
    "name": "parseTestLinksInStatement > returns an empty array when the statement has no trailing parenthetical",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "parseTestLinksInStatement > returns an empty array when the trailing paren contains no markdown links",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "parseTestLinksInStatement > parses a single test-link parenthetical at end of statement",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "parseTestLinksInStatement > parses multiple comma-separated test links inside one paren",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "parseTestLinksInStatement > ignores non-test links inside the trailing paren (ADR / docs / external)",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "parseTestLinksInStatement > returns an empty array when the trailing paren contains ONLY non-test links",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "parseTestLinksInStatement > parses a link with no #Lline anchor (line is null)",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "parseTestLinksInStatement > strips a leading slash on the href so paths normalize repo-relative",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "parseTestLinksInStatement > recognizes the Go test path convention",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "parseTestLinksInStatement > ignores links inside the body of the statement (only trailing paren matters)",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "parseTestLinksInStatement > handles a trailing period after the closing parenthesis",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "parseTestLinksInStatement > collapses internal whitespace in the label",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "parseCodeLinksInStatement > parses a single non-test code link into one code-link ref",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "parseCodeLinksInStatement > excludes a markdown doc link so an ADR ref is not a code link",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "parseCodeLinksInStatement > keeps a non-test source path in another language as a code link",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "linksForStatements > pairs each segmented statement with its parsed test links",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "findMisplacedCoverageLinks > flags a coverage link buried in a non-trailing parenthetical",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "findMisplacedCoverageLinks > does not flag a link that is correctly in the trailing parenthetical",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "findMisplacedCoverageLinks > ignores a non-trailing prose doc link",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-link-parser.test.ts"
  },
  {
    "name": "segmentStatements > splits prose paragraphs into sentences",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "segmentStatements > treats each list item as its own statement",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "segmentStatements > joins multi-line list-item continuations into one statement",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "segmentStatements > excludes headings, fenced code, and tables",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "segmentStatements > guards against splitting on abbreviations (e.g., i.e., etc.)",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "segmentStatements > guards against single-letter initials in caps",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "segmentStatements > does not split when the next non-space char is lowercase",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "segmentStatements > tracks the enclosing heading per statement",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "segmentStatements > produces deterministic ordinals across re-runs",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "segmentStatements > returns an empty array for content with no statements",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "buildIntroOrdinals > marks statements under the document's first heading as intro",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "buildIntroOrdinals > treats statements with no enclosing heading as intro",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "classifyByHeuristic > marks intro-ordinal statements untestable as 'intro'",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "classifyByHeuristic > classifies Problem Statement as background",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "classifyByHeuristic > classifies Vision as vision",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "classifyByHeuristic > classifies Clarifications as clarification",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "classifyByHeuristic > classifies Open Questions as open-question",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "classifyByHeuristic > classifies Limitations as limitation",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "classifyByHeuristic > classifies Rationale as rationale",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "classifyByHeuristic > returns testable + matchedBySection=false for unrecognised headings",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-segment.test.ts"
  },
  {
    "name": "specFeatureSlug > returns the feature directory under specs/",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "specFeatureSlug > falls back to the parent directory when there is no specs/ segment",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "specFeatureSlug > returns null for a bare filename",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "hasDirectoryAffinity > returns true when the test path shares a majority of slug tokens",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "hasDirectoryAffinity > returns false when the test path shares no slug tokens",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "hasDirectoryAffinity > returns false when the slug has no significant tokens",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "cosineSimilarity > returns 1 for identical vectors",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "cosineSimilarity > returns 0 for orthogonal vectors",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "cosineSimilarity > returns 0 for empty or length-mismatched vectors",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "cosineSimilarity > returns 0 when either vector has zero magnitude",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "matchedAssertion > returns the assertion name the content references, case-insensitively",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "matchedAssertion > skips assertion names shorter than three characters",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "matchedAssertion > returns null when no assertion is referenced",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "deriveTestName > joins parent_symbol and symbol_name into a normalized name",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "deriveTestName > falls back to the describe key when parent_symbol is absent",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "deriveTestName > returns null for null metadata or a missing symbol name",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "parseEmbedding > returns the array unchanged when already an array",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "parseEmbedding > parses a pgvector string representation",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "parseEmbedding > returns null for malformed, empty, or non-string input",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "selectCandidates > classifies an assertion-overlap candidate as kind 'assertion'",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "selectCandidates > falls back to directory affinity then embedding proximity",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "selectCandidates > skips non-test files and chunks with no test name",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "selectCandidates > dedups by test, keeping the strongest signal",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "selectCandidates > caps at maxCandidates and flags truncation",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "argmaxByTest > keeps the highest-scoring judgment per test",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "argmaxByTest > drops non-matches and sub-threshold scores",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "staleLinkKeys > returns existing links no longer confirmed this run",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "staleStatementOrdinals > returns ordinals no longer present in the current run",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "hashSpecContent > returns a stable 64-char sha-256 hex digest",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "hashSpecContent > returns a different digest for different content",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-judge.test.ts"
  },
  {
    "name": "parseSpecTitle > returns the first H1 stripped of the hash",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-summary.test.ts"
  },
  {
    "name": "parseSpecTitle > strips a 'Feature Specification:' prefix from the H1",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-summary.test.ts"
  },
  {
    "name": "parseSpecTitle > falls back to the feature directory name when there is no H1",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-summary.test.ts"
  },
  {
    "name": "parseSpecTitle > falls back to the file path when there is no H1 and no feature dir",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-summary.test.ts"
  },
  {
    "name": "extractSummary > returns the first non-heading, non-table paragraph",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-summary.test.ts"
  },
  {
    "name": "extractSummary > collapses internal whitespace and joins wrapped lines",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-summary.test.ts"
  },
  {
    "name": "extractSummary > truncates to the max length with an ellipsis",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-summary.test.ts"
  },
  {
    "name": "extractSummary > returns an empty string when there is no paragraph",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-summary.test.ts"
  },
  {
    "name": "extractSummary > skips a leading blockquote note and returns the first prose paragraph",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-summary.test.ts"
  },
  {
    "name": "reassembleSpec > joins chunk contents in order",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-summary.test.ts"
  },
  {
    "name": "reassembleSpec > deduplicates identical chunk contents",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-summary.test.ts"
  },
  {
    "name": "parseTestCommandManifest > normalizes a minimal valid manifest into a one-element list with defaults",
    "file": "/home/bogdan/workspace/lore/shared/src/test-command-manifest.test.ts"
  },
  {
    "name": "parseTestCommandManifest > throws when the run command is missing",
    "file": "/home/bogdan/workspace/lore/shared/src/test-command-manifest.test.ts"
  },
  {
    "name": "parseTestCommandManifest > throws when the run command omits the {selector} placeholder",
    "file": "/home/bogdan/workspace/lore/shared/src/test-command-manifest.test.ts"
  },
  {
    "name": "parseTestCommandManifest > throws on an unknown coverage_format",
    "file": "/home/bogdan/workspace/lore/shared/src/test-command-manifest.test.ts"
  },
  {
    "name": "parseTestCommandManifest > normalizes a polyglot array into one entry per manifest",
    "file": "/home/bogdan/workspace/lore/shared/src/test-command-manifest.test.ts"
  },
  {
    "name": "parseTestCommandManifest > preserves a provided cwd and path_prefix_strip",
    "file": "/home/bogdan/workspace/lore/shared/src/test-command-manifest.test.ts"
  },
  {
    "name": "resolveTestCommandManifest > returns null when neither settings nor file declare a manifest",
    "file": "/home/bogdan/workspace/lore/shared/src/test-command-manifest.test.ts"
  },
  {
    "name": "resolveTestCommandManifest > prefers settings over the file when both are present",
    "file": "/home/bogdan/workspace/lore/shared/src/test-command-manifest.test.ts"
  },
  {
    "name": "resolveTestCommandManifest > falls back to the file when settings are absent",
    "file": "/home/bogdan/workspace/lore/shared/src/test-command-manifest.test.ts"
  },
  {
    "name": "decideTestInterfaceCheck > scaffolds both files when no manifest is declared",
    "file": "/home/bogdan/workspace/lore/shared/src/test-command-manifest.test.ts"
  },
  {
    "name": "decideTestInterfaceCheck > reports configured when the .lore/test-commands.yml file is declared",
    "file": "/home/bogdan/workspace/lore/shared/src/test-command-manifest.test.ts"
  },
  {
    "name": "decideTestInterfaceCheck > reports configured when settings declare test_commands without a file",
    "file": "/home/bogdan/workspace/lore/shared/src/test-command-manifest.test.ts"
  },
  {
    "name": "isManifestDeclared > returns false when neither a file nor settings declare a manifest",
    "file": "/home/bogdan/workspace/lore/shared/src/test-command-manifest.test.ts"
  },
  {
    "name": "substituteSelector > replaces every {selector} placeholder with the runner-native id",
    "file": "/home/bogdan/workspace/lore/shared/src/test-command-manifest.test.ts"
  },
  {
    "name": "TEST_COMMAND_SETUP_PROMPT > is a non-empty string",
    "file": "/home/bogdan/workspace/lore/shared/src/test-command-setup-prompt.test.ts"
  },
  {
    "name": "TEST_COMMAND_SETUP_PROMPT > names no concrete language or test runner",
    "file": "/home/bogdan/workspace/lore/shared/src/test-command-setup-prompt.test.ts"
  },
  {
    "name": "isTestFile > recognizes test-path conventions across languages and rejects production paths",
    "file": "/home/bogdan/workspace/lore/shared/src/test-paths.test.ts"
  },
  {
    "name": "normalizeTestName > lowercases, collapses whitespace and joins with a wedge",
    "file": "/home/bogdan/workspace/lore/shared/src/test-paths.test.ts"
  },
  {
    "name": "normalizeTestName > omits an empty describe segment",
    "file": "/home/bogdan/workspace/lore/shared/src/test-paths.test.ts"
  },
  {
    "name": "normalizeTestName > returns identical keys for the same test described with differing whitespace",
    "file": "/home/bogdan/workspace/lore/shared/src/test-paths.test.ts"
  },
  {
    "name": "PostgresMemoryStore.writeMemory (live Postgres) > returns version 1 for a brand-new key",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/postgres-memory-store.test.js"
  },
  {
    "name": "PostgresMemoryStore.deleteMemory (live Postgres) > soft-deletes so readMemory returns nothing",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/postgres-memory-store.test.js"
  },
  {
    "name": "PostgresMemoryStore.listMemories (live Postgres) > returns total 2 and the two live keys, excluding the soft-deleted one",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/postgres-memory-store.test.js"
  },
  {
    "name": "PostgresMemoryStore.readMemory (live Postgres) > returns the latest stored value with version 1 for a single write",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/postgres-memory-store.test.js"
  },
  {
    "name": "backfillMemoryToDgraph (live Postgres + Dgraph) > creates a Memory node whose Memory.xid equals the Postgres memories row id",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/backfill-memory.test.js"
  },
  {
    "name": "backfillMemoryToDgraph (live Postgres + Dgraph) > points Fact.memory at the Memory node carrying the facts.memory_id xid",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/backfill-memory.test.js"
  },
  {
    "name": "backfillMemoryToDgraph (live Postgres + Dgraph) > creates exactly one Memory node per xid after running twice",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/backfill-memory.test.js"
  },
  {
    "name": "backfillMemoryToDgraph (live Postgres + Dgraph) > preserves the 768-dim embedding so cosine(original, stored) is 1.0",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/backfill-memory.test.js"
  },
  {
    "name": "parseTestDescriptors > parses a descriptor carrying every field",
    "file": "/home/bogdan/workspace/lore/shared/src/test-report.test.ts"
  },
  {
    "name": "parseTestDescriptors > carries the suite chain outermost to innermost",
    "file": "/home/bogdan/workspace/lore/shared/src/test-report.test.ts"
  },
  {
    "name": "parseTestDescriptors > omits a suite array holding a non-string element",
    "file": "/home/bogdan/workspace/lore/shared/src/test-report.test.ts"
  },
  {
    "name": "parseTestDescriptors > omits optional fields a descriptor does not declare",
    "file": "/home/bogdan/workspace/lore/shared/src/test-report.test.ts"
  },
  {
    "name": "parseTestDescriptors > throws when the required id is missing",
    "file": "/home/bogdan/workspace/lore/shared/src/test-report.test.ts"
  },
  {
    "name": "parseTestDescriptors > throws when the required name is missing",
    "file": "/home/bogdan/workspace/lore/shared/src/test-report.test.ts"
  },
  {
    "name": "parseTestDescriptors > throws when the required file is missing",
    "file": "/home/bogdan/workspace/lore/shared/src/test-report.test.ts"
  },
  {
    "name": "parseRunResult > parses passed + a list of covered chunks",
    "file": "/home/bogdan/workspace/lore/shared/src/test-report.test.ts"
  },
  {
    "name": "parseRunResult > throws when a covered chunk is missing its line bounds",
    "file": "/home/bogdan/workspace/lore/shared/src/test-report.test.ts"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > persistFact writes an active Fact node retrievable for the agent",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/dgraph-memory-store.test.js"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > invalidates the prior fact and records a FactConflict for a near-duplicate embedding",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/dgraph-memory-store.test.js"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > returns the stored value at version 1 after writeMemory then readMemory of a new key",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/dgraph-memory-store.test.js"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > returns version 2 and the latest value after writing the same key twice",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/dgraph-memory-store.test.js"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > excludes a memory whose expires_at is in the past",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/dgraph-memory-store.test.js"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > soft-deletes so readMemory returns nothing",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/dgraph-memory-store.test.js"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > returns total 2 and the two live keys, excluding the soft-deleted one",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/dgraph-memory-store.test.js"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > searchMemories returns the memory whose value matches the keyword query",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/dgraph-memory-store.test.js"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > searchMemories returns the vector-nearest memory when the keyword query matches nothing",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/dgraph-memory-store.test.js"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > writeEpisode of identical content twice creates exactly one Episode node",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/dgraph-memory-store.test.js"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > upsertEdge creates an active GraphRel of the given relation_type from source to target",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/dgraph-memory-store.test.js"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > invalidates the prior edge when a same-source same-relation edge points at a different target",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/dgraph-memory-store.test.js"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > queryGraph returns the 1-hop outgoing neighbour as a hop at depth 1",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/dgraph-memory-store.test.js"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > traverses two hops so A--uses-->B--hosts-->C yields the depth-2 hop B--hosts-->C",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/dgraph-memory-store.test.js"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > excludes an invalidated (active=false) edge from traversal by default",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/dgraph-memory-store.test.js"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > terminates on a cycle A--links-->B--links-->A without infinite recursion",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/dgraph-memory-store.test.js"
  },
  {
    "name": "setup-spec-trace-schema applier (live Dgraph) > declares the Statement xid upsert index and the Statement embedding HNSW vector index",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/setup-spec-trace-schema.test.js"
  },
  {
    "name": "setup-spec-trace-schema applier (live Dgraph) > declares every traceability node type's xid as a hash upsert index",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/setup-spec-trace-schema.test.js"
  },
  {
    "name": "setup-spec-trace-schema applier (live Dgraph) > declares every embedding predicate as a float32vector HNSW index",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/setup-spec-trace-schema.test.js"
  },
  {
    "name": "setup-spec-trace-schema applier (live Dgraph) > declares the relationship edge predicates as uid lists",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/setup-spec-trace-schema.test.js"
  },
  {
    "name": "setup-spec-trace-schema applier (live Dgraph) > lists Statement.violated and Statement.violation_reason in the Statement type",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/setup-spec-trace-schema.test.js"
  },
  {
    "name": "setup-spec-trace-schema applier (live Dgraph) > lists AcceptanceCriterion.violated and AcceptanceCriterion.violation_reason in the type",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/setup-spec-trace-schema.test.js"
  },
  {
    "name": "setup-spec-trace-schema applier (live Dgraph) > is idempotent — a second apply leaves the predicate schema unchanged",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/setup-spec-trace-schema.test.js"
  },
  {
    "name": "setup-spec-trace-schema applier (live Dgraph) > coexists with the memory schema — Memory.xid stays intact on the shared cluster",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/setup-spec-trace-schema.test.js"
  },
  {
    "name": "setup-memory-dgraph-schema applier (live Dgraph) > declares the HNSW vector index and the xid upsert index",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/setup-memory-dgraph-schema.test.js"
  },
  {
    "name": "setup-memory-dgraph-schema applier (live Dgraph) > is idempotent — a second apply leaves the predicate schema unchanged",
    "file": "/home/bogdan/workspace/lore/shared/dist/__tests__/setup-memory-dgraph-schema.test.js"
  },
  {
    "name": "planTraceUnits (pure) > routes a specs/ markdown path to a spec projection unit",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/trace-units.test.js"
  },
  {
    "name": "planTraceUnits (pure) > routes an adrs/ markdown path to an adr projection unit",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/trace-units.test.js"
  },
  {
    "name": "planTraceUnits (pure) > excludes a source file outside the doc seed prefixes",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/trace-units.test.js"
  },
  {
    "name": "planTraceUnits (pure) > excludes a non-markdown file under a seed prefix",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/trace-units.test.js"
  },
  {
    "name": "runTraceUnits (isolation) > runs siblings and records the failure when one unit's projection throws",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/trace-units.test.js"
  },
  {
    "name": "buildVertexUrl > interpolates project and region into the predict endpoint",
    "file": "/home/bogdan/workspace/lore/shared/dist/embeddings/embedding-service.test.js"
  },
  {
    "name": "buildVertexUrl > yields a projects// double slash when project is empty",
    "file": "/home/bogdan/workspace/lore/shared/dist/embeddings/embedding-service.test.js"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > persistFact writes an active Fact node retrievable for the agent",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/dgraph-memory-store.test.ts"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > invalidates the prior fact and records a FactConflict for a near-duplicate embedding",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/dgraph-memory-store.test.ts"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > returns the stored value at version 1 after writeMemory then readMemory of a new key",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/dgraph-memory-store.test.ts"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > returns version 2 and the latest value after writing the same key twice",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/dgraph-memory-store.test.ts"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > excludes a memory whose expires_at is in the past",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/dgraph-memory-store.test.ts"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > soft-deletes so readMemory returns nothing",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/dgraph-memory-store.test.ts"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > returns total 2 and the two live keys, excluding the soft-deleted one",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/dgraph-memory-store.test.ts"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > searchMemories returns the memory whose value matches the keyword query",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/dgraph-memory-store.test.ts"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > searchMemories returns the vector-nearest memory when the keyword query matches nothing",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/dgraph-memory-store.test.ts"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > writeEpisode of identical content twice creates exactly one Episode node",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/dgraph-memory-store.test.ts"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > upsertEdge creates an active GraphRel of the given relation_type from source to target",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/dgraph-memory-store.test.ts"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > invalidates the prior edge when a same-source same-relation edge points at a different target",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/dgraph-memory-store.test.ts"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > queryGraph returns the 1-hop outgoing neighbour as a hop at depth 1",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/dgraph-memory-store.test.ts"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > traverses two hops so A--uses-->B--hosts-->C yields the depth-2 hop B--hosts-->C",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/dgraph-memory-store.test.ts"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > excludes an invalidated (active=false) edge from traversal by default",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/dgraph-memory-store.test.ts"
  },
  {
    "name": "DgraphMemoryStore (live Dgraph) > terminates on a cycle A--links-->B--links-->A without infinite recursion",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/dgraph-memory-store.test.ts"
  },
  {
    "name": "PostgresMemoryStore.writeMemory (live Postgres) > returns version 1 for a brand-new key",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/postgres-memory-store.test.ts"
  },
  {
    "name": "PostgresMemoryStore.deleteMemory (live Postgres) > soft-deletes so readMemory returns nothing",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/postgres-memory-store.test.ts"
  },
  {
    "name": "PostgresMemoryStore.listMemories (live Postgres) > returns total 2 and the two live keys, excluding the soft-deleted one",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/postgres-memory-store.test.ts"
  },
  {
    "name": "PostgresMemoryStore.readMemory (live Postgres) > returns the latest stored value with version 1 for a single write",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/postgres-memory-store.test.ts"
  },
  {
    "name": "backfillMemoryToDgraph (live Postgres + Dgraph) > creates a Memory node whose Memory.xid equals the Postgres memories row id",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/backfill-memory.test.ts"
  },
  {
    "name": "backfillMemoryToDgraph (live Postgres + Dgraph) > points Fact.memory at the Memory node carrying the facts.memory_id xid",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/backfill-memory.test.ts"
  },
  {
    "name": "backfillMemoryToDgraph (live Postgres + Dgraph) > creates exactly one Memory node per xid after running twice",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/backfill-memory.test.ts"
  },
  {
    "name": "backfillMemoryToDgraph (live Postgres + Dgraph) > preserves the 768-dim embedding so cosine(original, stored) is 1.0",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/backfill-memory.test.ts"
  },
  {
    "name": "setup-memory-dgraph-schema applier (live Dgraph) > declares the HNSW vector index and the xid upsert index",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/setup-memory-dgraph-schema.test.ts"
  },
  {
    "name": "setup-memory-dgraph-schema applier (live Dgraph) > is idempotent — a second apply leaves the predicate schema unchanged",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/setup-memory-dgraph-schema.test.ts"
  },
  {
    "name": "setup-spec-trace-schema applier (live Dgraph) > declares the Statement xid upsert index and the Statement embedding HNSW vector index",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/setup-spec-trace-schema.test.ts"
  },
  {
    "name": "setup-spec-trace-schema applier (live Dgraph) > declares every traceability node type's xid as a hash upsert index",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/setup-spec-trace-schema.test.ts"
  },
  {
    "name": "setup-spec-trace-schema applier (live Dgraph) > declares every embedding predicate as a float32vector HNSW index",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/setup-spec-trace-schema.test.ts"
  },
  {
    "name": "setup-spec-trace-schema applier (live Dgraph) > declares the relationship edge predicates as uid lists",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/setup-spec-trace-schema.test.ts"
  },
  {
    "name": "setup-spec-trace-schema applier (live Dgraph) > lists Statement.violated and Statement.violation_reason in the Statement type",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/setup-spec-trace-schema.test.ts"
  },
  {
    "name": "setup-spec-trace-schema applier (live Dgraph) > lists AcceptanceCriterion.violated and AcceptanceCriterion.violation_reason in the type",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/setup-spec-trace-schema.test.ts"
  },
  {
    "name": "setup-spec-trace-schema applier (live Dgraph) > is idempotent — a second apply leaves the predicate schema unchanged",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/setup-spec-trace-schema.test.ts"
  },
  {
    "name": "setup-spec-trace-schema applier (live Dgraph) > coexists with the memory schema — Memory.xid stays intact on the shared cluster",
    "file": "/home/bogdan/workspace/lore/shared/src/__tests__/setup-spec-trace-schema.test.ts"
  },
  {
    "name": "planTraceUnits (pure) > routes a specs/ markdown path to a spec projection unit",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/trace-units.test.ts"
  },
  {
    "name": "planTraceUnits (pure) > routes an adrs/ markdown path to an adr projection unit",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/trace-units.test.ts"
  },
  {
    "name": "planTraceUnits (pure) > excludes a source file outside the doc seed prefixes",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/trace-units.test.ts"
  },
  {
    "name": "planTraceUnits (pure) > excludes a non-markdown file under a seed prefix",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/trace-units.test.ts"
  },
  {
    "name": "runTraceUnits (isolation) > runs siblings and records the failure when one unit's projection throws",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/trace-units.test.ts"
  },
  {
    "name": "buildVertexUrl > interpolates project and region into the predict endpoint",
    "file": "/home/bogdan/workspace/lore/shared/src/embeddings/embedding-service.test.ts"
  },
  {
    "name": "buildVertexUrl > yields a projects// double slash when project is empty",
    "file": "/home/bogdan/workspace/lore/shared/src/embeddings/embedding-service.test.ts"
  },
  {
    "name": "AgentRunnerLocal (live spawn) > reports started when the agent CLI exits cleanly",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/agents/agent-runner-local.test.js"
  },
  {
    "name": "AgentRunnerLocal (live spawn) > reports not-started when the agent CLI exits non-zero",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/agents/agent-runner-local.test.js"
  },
  {
    "name": "AgentRunnerLocal (live spawn) > defers cluster mode to the pending adapter",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/agents/agent-runner-local.test.js"
  },
  {
    "name": "AgentRunner > local mode spawns the agent CLI and reports started",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/agents/agent-runner.test.js"
  },
  {
    "name": "AgentRunner > cluster mode creates a LoreTask CR via the injected K8sPort",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/agents/agent-runner.test.js"
  },
  {
    "name": "AgentRunner > direct mode calls the injected LlmPort",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/agents/agent-runner.test.js"
  },
  {
    "name": "AgentRunner > throws when cluster mode has no K8sPort provider",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/agents/agent-runner.test.js"
  },
  {
    "name": "Agents trust gate > refuses LOCAL execution on the shared server (LORE_DB_HOST set)",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/agents/agents.test.js"
  },
  {
    "name": "Agents trust gate > allows cluster mode even with LORE_DB_HOST set (the agent creates CRs on the cluster)",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/agents/agents.test.js"
  },
  {
    "name": "Agents trust gate > routes to the requested mode in a sandbox",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/agents/agents.test.js"
  },
  {
    "name": "IssueCollection > returns the GitHubPort issues for the project's repo",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/issues/issues.test.js"
  },
  {
    "name": "IssueCollection > creates an issue bound to the repo",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/issues/issues.test.js"
  },
  {
    "name": "IssueCollection > comments, closes, and labels by number bound to the repo",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/issues/issues.test.js"
  },
  {
    "name": "decideNotify > fires for any level when channels include all",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/notify/notify-decision.test.js"
  },
  {
    "name": "decideNotify > always fires escalation regardless of channels",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/notify/notify-decision.test.js"
  },
  {
    "name": "decideNotify > fires watched only when the watched channel is listed",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/notify/notify-decision.test.js"
  },
  {
    "name": "decideNotify > suppresses pr_open unless all is listed",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/notify/notify-decision.test.js"
  },
  {
    "name": "NotifySlack > fires an escalation using the repo's resolved channels",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/notify/notify-slack.test.js"
  },
  {
    "name": "NotifySlack > suppresses a pr_open when the repo's channels do not include all",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/notify/notify-slack.test.js"
  },
  {
    "name": "Notify > delivers an escalation bound to the repo",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/notify/notify.test.js"
  },
  {
    "name": "Notify > does not deliver a pr_open when the repo's channels do not authorize it",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/notify/notify.test.js"
  },
  {
    "name": "escapeXmlAttr > escapes quotes, ampersands, and angle brackets",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/knowledge/context-assembly-format.test.js"
  },
  {
    "name": "dedupeItems > keeps one item per source_path, retaining the higher score",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/knowledge/context-assembly-format.test.js"
  },
  {
    "name": "dedupeItems > keeps items without a source_path untouched",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/knowledge/context-assembly-format.test.js"
  },
  {
    "name": "serializeDocument > renders provenance as attributes and contains markdown without heading collision",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/knowledge/context-assembly-format.test.js"
  },
  {
    "name": "serializeDocument > marks a truncated document with a truncated attribute",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/knowledge/context-assembly-format.test.js"
  },
  {
    "name": "serializeContext > wraps sections and documents in nested context/section/document tags",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/knowledge/context-assembly-format.test.js"
  },
  {
    "name": "PgKnowledge > queries the live graph bound to the repo and maps to GraphEdge",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/knowledge/knowledge-pg.test.js"
  },
  {
    "name": "PgKnowledge > resolves the team schema then lists specs from its chunks",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/knowledge/knowledge-pg.test.js"
  },
  {
    "name": "PgKnowledge > falls back to org_shared when the team is not a valid schema",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/knowledge/knowledge-pg.test.js"
  },
  {
    "name": "PgKnowledge > assembles repo context through the relocated engine, bound to the repo",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/knowledge/knowledge-pg.test.js"
  },
  {
    "name": "MemoryStoreBridge > writes through the seam and returns key + version",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/memory/memory-store-bridge.test.js"
  },
  {
    "name": "MemoryStoreBridge > lists only the repo's memories from the seam",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/memory/memory-store-bridge.test.js"
  },
  {
    "name": "KnowledgeView > assembles context scoped to the repo",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/knowledge/knowledge.test.js"
  },
  {
    "name": "KnowledgeView > lists the repo's specs",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/knowledge/knowledge.test.js"
  },
  {
    "name": "Project (live Postgres) > resolves settings, queries tasks, and reads the graph through a real connection",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/lib/project.integration.test.js"
  },
  {
    "name": "Memory > writes then reads back the value for the repo",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/memory/memory.test.js"
  },
  {
    "name": "Memory > isolates memories of a different repo",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/memory/memory.test.js"
  },
  {
    "name": "PlatformGitHub auth > throws a clear config error when neither App creds nor a token are set",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/lib/platform-github.test.js"
  },
  {
    "name": "PlatformGitHub auth > exposes the github port name",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/lib/platform-github.test.js"
  },
  {
    "name": "Project wiring > builds the tasks port from the pg connection and queries bound to the repo",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/lib/project.test.js"
  },
  {
    "name": "Project wiring > resolves settings through the wired pg settings port",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/lib/project.test.js"
  },
  {
    "name": "Project wiring > throws a clear error when a port was not provided in the map",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/lib/project.test.js"
  },
  {
    "name": "TaskList > returns pending Tasks for the repo as typed wrappers",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/tasks/task-list.test.js"
  },
  {
    "name": "TaskList > reflects the new status after cancel()",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/tasks/task-list.test.js"
  },
  {
    "name": "RepoFiles > reads a file from the repo at the given ref",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/repo/repo-files.test.js"
  },
  {
    "name": "RepoFiles > returns null for a file the repo does not have",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/repo/repo-files.test.js"
  },
  {
    "name": "RepoFiles > creates a branch and commits a file via the API, repo bound",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/repo/repo-files.test.js"
  },
  {
    "name": "PgTaskStore > queries pending statuses bound to the repo",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/tasks/task-store-pg.test.js"
  },
  {
    "name": "PgTaskStore > transitions a cancel to the cancelled status",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/tasks/task-store-pg.test.js"
  },
  {
    "name": "PgTaskStore > setStatus writes status + updated_at + only allowlisted extra columns",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/tasks/task-store-pg.test.js"
  },
  {
    "name": "PgTaskStore > updateStatus reads the old status, sets the new one, then records the event",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/tasks/task-store-pg.test.js"
  },
  {
    "name": "Settings > resolves the repo's settings via the real resolver",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/settings/settings.test.js"
  },
  {
    "name": "Settings > binds the repo when setting a GitHub variable",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/settings/settings.test.js"
  },
  {
    "name": "PullRequests > lists only the repo's pull requests",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/pulls/pull-requests.test.js"
  },
  {
    "name": "PullRequests > merges by number with the requested method bound to the repo",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/pulls/pull-requests.test.js"
  },
  {
    "name": "PullRequests > exposes PR reads bound to the repo and number",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/pulls/pull-requests.test.js"
  },
  {
    "name": "TestSuite trust gate > refuses to list tests on the shared server (LORE_DB_HOST set)",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/test-runner/test-suite.test.js"
  },
  {
    "name": "TestSuite trust gate > lists tests in a trusted sandbox (no LORE_DB_HOST)",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/test-runner/test-suite.test.js"
  },
  {
    "name": "PgSettings > resolves the repo's dark_factory settings from the JSONB row",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/settings/settings-pg.test.js"
  },
  {
    "name": "PgSettings > falls back to defaults when the repo has no settings row",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/settings/settings-pg.test.js"
  },
  {
    "name": "PgSettings > resolveOrNull returns null when the repo is not onboarded",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/settings/settings-pg.test.js"
  },
  {
    "name": "PgSettings > resolveOrNull resolves the settings when the repo row exists",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/settings/settings-pg.test.js"
  },
  {
    "name": "PgSettings > delegates a variable write to the repo-config writer",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/settings/settings-pg.test.js"
  },
  {
    "name": "ExecTestRunner (live shell) > lists the descriptors emitted by the manifest list command",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/test-runner/test-runner-exec.test.js"
  },
  {
    "name": "ExecTestRunner (live shell) > runs a single test and aggregates the report",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/test-runner/test-runner-exec.test.js"
  },
  {
    "name": "GitCli (live git) > clones the remote and reads a seeded file",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/workspace/git-cli.test.js"
  },
  {
    "name": "GitCli (live git) > writes, commits on a new branch, and pushes to the remote",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/workspace/git-cli.test.js"
  },
  {
    "name": "GitCli (live git) > commits with the Lore Agent identity when the environment provides none",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/workspace/git-cli.test.js"
  },
  {
    "name": "GitCli (live git) > ensureClone clones when absent, then reuses the cache (fetch, not re-clone) on the second call",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/workspace/git-cli.test.js"
  },
  {
    "name": "GitCli (live git) > ensureCheckout pins the working tree to a branch",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/workspace/git-cli.test.js"
  },
  {
    "name": "GitCli (live git) > ensureCheckout refuses to switch a dirty working tree",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/workspace/git-cli.test.js"
  },
  {
    "name": "parseAdrRefs > extracts distinct ADR numbers, normalizing zero-padding",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/adr-refs.test.js"
  },
  {
    "name": "parseAdrRefs > returns nothing when no ADR is cited",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/adr-refs.test.js"
  },
  {
    "name": "parseAdrRefs > matches an ADR cited with a slug suffix",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/adr-refs.test.js"
  },
  {
    "name": "adrNumberFromPath > extracts the number from an ADR filename",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/adr-refs.test.js"
  },
  {
    "name": "adrNumberFromPath > returns null for a non-ADR path",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/adr-refs.test.js"
  },
  {
    "name": "Workspace > writes then reads back a file and commits through the GitPort",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/workspace/workspace.test.js"
  },
  {
    "name": "Workspace > pushes the branch then opens the PR via the pulls port",
    "file": "/home/bogdan/workspace/lore/shared/dist/project/workspace/workspace.test.js"
  },
  {
    "name": "assembleTraceDocument > orders statements by ordinal and derives state + coverage counts from the graph",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/assemble-trace-document.test.js"
  },
  {
    "name": "assembleTraceDocument > returns ordered sections and each statement's section ref, links, and drift/violation metadata",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/assemble-trace-document.test.js"
  },
  {
    "name": "assembleTraceDocument > sets title to the ordinal-first section heading 'Goals'",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/assemble-trace-document.test.js"
  },
  {
    "name": "assembleTraceDocument > sets description to the ordinal-first statement's text 'First sentence.'",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/assemble-trace-document.test.js"
  },
  {
    "name": "assembleTraceDocument > falls back title to the file basename 'spec.md' when the spec has no sections",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/assemble-trace-document.test.js"
  },
  {
    "name": "determinism: delete + re-run units reproduces the graph exactly (T281) > reproduces the identical subgraph after deleting it and re-running the units",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/determinism.test.js"
  },
  {
    "name": "driftCheckFile (live Dgraph) > flips the Statement drifted with reason code-content-changed (render) and updates the CodeChunk hash to NEWHASH when the implementing chunk's content_hash changed",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/drift-check-file.test.js"
  },
  {
    "name": "driftCheckFile (live Dgraph) > drifts a statement connected only through the coverage chain when the covered code changes",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/drift-check-file.test.js"
  },
  {
    "name": "driftCheckFile (live Dgraph) > marks the covering Coverage node stale when the covered code changes",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/drift-check-file.test.js"
  },
  {
    "name": "driftCheckFile (live Dgraph) > returns the drifted statement as a DriftedStatement with specPath ordinal text and reason",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/drift-check-file.test.js"
  },
  {
    "name": "driftCheckFile (live Dgraph) > drifts an AcceptanceCriterion implemented by a changed chunk",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/drift-check-file.test.js"
  },
  {
    "name": "driftCheckFile (live Dgraph) > baselines a first-sight chunk with no stored hash instead of drifting it",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/drift-check-file.test.js"
  },
  {
    "name": "driftCheckFile (live Dgraph) > drifts a statement with reason file-missing when the implementing file has no chunks",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/drift-check-file.test.js"
  },
  {
    "name": "driftCheckFile (live Dgraph) > sets drift_severity to the cosine distance between the new chunk and statement embeddings",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/drift-check-file.test.js"
  },
  {
    "name": "driftCheckFile (live Dgraph) > drifts a statement with reason line-out-of-range when the chunk lines overlap no remaining chunk",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/drift-check-file.test.js"
  },
  {
    "name": "driftCheckFile (live Dgraph) > falls back to the file path in drift_reason when the changed chunk has no symbol_name",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/drift-check-file.test.js"
  },
  {
    "name": "selectIngestFiles > selects specs/ and .specify/ markdown for the specs kind",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-graph-task.test.js"
  },
  {
    "name": "selectIngestFiles > selects only adrs/ markdown for the adrs kind",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-graph-task.test.js"
  },
  {
    "name": "selectIngestFiles > selects source .ts for the code kind, excluding tests and declarations",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-graph-task.test.js"
  },
  {
    "name": "selectIngestFiles > returns nothing for an unknown kind",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-graph-task.test.js"
  },
  {
    "name": "summarizeIngest > reports completed when everything projected",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-graph-task.test.js"
  },
  {
    "name": "summarizeIngest > reports completed when everything was an unchanged skip",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-graph-task.test.js"
  },
  {
    "name": "summarizeIngest > reports failed only when every attempted file failed",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-graph-task.test.js"
  },
  {
    "name": "summarizeIngest > stays completed on a partial failure",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-graph-task.test.js"
  },
  {
    "name": "runIngestGraph > short-circuits to skipped when no dgraph client is configured",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-graph-task.test.js"
  },
  {
    "name": "runIngestGraph > projects then skips identical content on a second run (idempotent)",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-graph-task.test.js"
  },
  {
    "name": "runIngestGraph > self-skips the tests kind when no buildTestReport port is provided (cluster)",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-graph-task.test.js"
  },
  {
    "name": "formatSpecDriftReport > returns an empty string for no drift findings",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/format-drift-report.test.js"
  },
  {
    "name": "formatSpecDriftReport > includes the spec path, statement text, and reason for a single drift finding",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/format-drift-report.test.js"
  },
  {
    "name": "ingestCoverageReport (live Dgraph) > writes one Coverage node keyed by repo|testFile|testName with repo/tool/commit for a record with no covered ranges",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-coverage.test.js"
  },
  {
    "name": "ingestCoverageReport (live Dgraph) > adds one COVERS edge to the CodeChunk when covered 5-10 overlaps the chunk 1-20",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-coverage.test.js"
  },
  {
    "name": "ingestCoverageReport (live Dgraph) > counts 6 unmatched lines for covered 5-10 overlapping no CodeChunk",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-coverage.test.js"
  },
  {
    "name": "ingestCoverageReport (live Dgraph) > re-ingest with a new commit replaces COVERS so only ccB remains, not ccA",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-coverage.test.js"
  },
  {
    "name": "ingestCoverageReport (live Dgraph) > links the matching TestChunk to the Coverage node via HAS_COVERAGE",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-coverage.test.js"
  },
  {
    "name": "ingestSpecTrace (unknown kind) > rejects with an error naming the kind for an unrecognized kind",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-spec-trace-unknown-kind.test.js"
  },
  {
    "name": "ingestSpecTrace (live Dgraph) > writes a TestChunk via ingestTestReport when kind is test-report",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-spec-trace.test.js"
  },
  {
    "name": "ingestSpecTrace (live Dgraph) > writes Coverage with a COVERS edge via ingestCoverageReport when kind is coverage",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-spec-trace.test.js"
  },
  {
    "name": "repoRelativeLinkTarget > returns a repo-relative target unchanged",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/link-target-path.test.js"
  },
  {
    "name": "repoRelativeLinkTarget > resolves a ../-relative target against the spec's directory",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/link-target-path.test.js"
  },
  {
    "name": "repoRelativeLinkTarget > resolves a ./-relative target against the spec's directory",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/link-target-path.test.js"
  },
  {
    "name": "repoRelativeLinkTarget > drops a bare anchor target",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/link-target-path.test.js"
  },
  {
    "name": "repoRelativeLinkTarget > drops an empty target",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/link-target-path.test.js"
  },
  {
    "name": "repoRelativeLinkTarget > drops a target that escapes the repo root",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/link-target-path.test.js"
  },
  {
    "name": "repoRelativeLinkTarget > strips a fragment from an otherwise valid target",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/link-target-path.test.js"
  },
  {
    "name": "ingestTestReport (live Dgraph) > links a statement via validated_by when a descriptor name sentence-matches its spec (no anchor)",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-test-report.test.js"
  },
  {
    "name": "ingestTestReport (live Dgraph) > writes one TestChunk keyed repo|t1 with test_name/file_path/start_line/end_line for a single descriptor",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-test-report.test.js"
  },
  {
    "name": "ingestTestReport (live Dgraph) > links the spec Statement to TestChunk repo|t1 via validated_by for a descriptor with spec anchor specs/foo/spec.md#7",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-test-report.test.js"
  },
  {
    "name": "ingestTestReport (live Dgraph) > marks the spec Statement violated with a reason naming failing test renders when its result passed is false",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-test-report.test.js"
  },
  {
    "name": "ingestTestReport (live Dgraph) > keeps the spec Statement violated when one of two validating tests fails and the other passes",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-test-report.test.js"
  },
  {
    "name": "ingestTestReport (live Dgraph) > clears the spec Statement violated to false when a re-ingest reports the validating test passed",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-test-report.test.js"
  },
  {
    "name": "ingestTestReport (live Dgraph) > clears the spec Statement violation_reason when a re-ingest reports the validating test passed",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-test-report.test.js"
  },
  {
    "name": "ingestTestReport (live Dgraph) > covers CodeChunk repo|ccX from result t1's range 5-10 overlapping the chunk's 1-20 span",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-test-report.test.js"
  },
  {
    "name": "ingestTestReport (live Dgraph) > links TestChunk repo|t1 to the innermost TestSuite Overview for a descriptor with suite [Overview]",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-test-report.test.js"
  },
  {
    "name": "ingestTestReport (live Dgraph) > nests TestSuites parent-linked outer to inner with TestChunk pointing at the innermost",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/ingest-test-report.test.js"
  },
  {
    "name": "language-agnostic e2e: no tree-sitter grammar (Ruby) > projects a Ruby-linked spec to file+line nodes, covers by line overlap, and drifts on a code change",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/language-agnostic-e2e.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > writes a Spec node keyed by repo|filePath with content_hash = sha256(content)",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > stores the spec's H1 heading as Spec.title for sentence-link spec resolution",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > projects two Statement nodes linked to the Spec with verbatim text and sha256 text_hash",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > stores Statement and AcceptanceCriterion embeddings from the injected embedder",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > links the Statement to a TestChunk via validated_by for an inline test link",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > keys a validated_by TestChunk by repo|filePath so two links to one file collapse to the runner's node",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > links the Statement to a CodeChunk via implemented_by for an inline code link",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > returns projected true on first call and projected false on an unchanged second call",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > re-projects changed content and updates the reworded statement's text_hash",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > carries classifier kind/testability/category on an untestable Background statement",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > groups both statements under one Section keyed by repo|filePath|0 reachable via Spec.sections",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > prunes the orphaned second Statement when re-projecting content with only the first",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > prunes an orphaned Section and its Spec.sections edge when a heading is removed on re-projection",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > prunes an orphaned AcceptanceCriterion and its Spec.acceptance_criteria edge when an item is removed",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > projects ordered Block nodes reconstructing heading, blank, and paragraph source off the Spec",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > projects Acceptance Criteria items as AcceptanceCriterion nodes off the Spec and not as Statements",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > recomputes the exact source of a multi-kind document from its projected Blocks",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > recomputes the shorter source when re-projecting fewer blocks prunes the orphaned Blocks",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > replaces a surviving statement's validated_by link when its inline test link changes on re-projection",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > deletes a TestChunk that no surviving statement links after re-projection",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > keeps a TestChunk that another statement still links after one statement drops it",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > keeps a coverage-bearing TestChunk when the only linking statement drops its link",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > links a statement to a cited ADR via decided_by",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-spec-file.test.js"
  },
  {
    "name": "parseCodeChunks > returns one chunk per top-level function with 1-based line range and symbol_type",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/parse-code-chunks.test.js"
  },
  {
    "name": "parseCodeChunks > describes class, interface, type, enum, and const declarations across the file",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/parse-code-chunks.test.js"
  },
  {
    "name": "parseCodeChunks > skips imports and bare expressions, hashing only the symbol body",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/parse-code-chunks.test.js"
  },
  {
    "name": "projectCodeFile (live Dgraph) > upserts one CodeChunk per top-level symbol with line range and content hash",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-code-file.test.js"
  },
  {
    "name": "projectAdrFile (live Dgraph) > recomputes the exact ADR source after projecting it through the graph",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-adr-file.test.js"
  },
  {
    "name": "projectAdrFile (live Dgraph) > returns projected true then false on an unchanged re-projection (content_hash gate)",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-adr-file.test.js"
  },
  {
    "name": "projectAdrFile (live Dgraph) > recomputes the shorter source after re-projecting a SHORTER ADR over a longer one",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/project-adr-file.test.js"
  },
  {
    "name": "parseValidatesAnnotations > returns one ref with numeric ordinal and the file path as target for a single lore:validates line",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/provenance.test.js"
  },
  {
    "name": "parseValidatesAnnotations > returns one ref splitting on the ordinal # for a #-comment lore:validates line",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/provenance.test.js"
  },
  {
    "name": "resolveProvenance > returns one ref when the same triple appears in two sources",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/provenance.test.js"
  },
  {
    "name": "resolveProvenance > keeps only the annotation ref when annotation and inline conflict on the same specPath and ordinal",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/provenance.test.js"
  },
  {
    "name": "detectProvenanceConflicts > returns one conflict listing both distinct targets in inline-then-annotation order when inline and annotation disagree on the same specPath and ordinal",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/provenance.test.js"
  },
  {
    "name": "detectProvenanceConflicts > returns no conflict when the same triple appears in two sources with identical target",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/provenance.test.js"
  },
  {
    "name": "sourceFromBlockRows (pure) > returns null for zero rows (a never-projected document)",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/recompute-spec-file.test.js"
  },
  {
    "name": "sourceFromBlockRows (pure) > returns empty string for a single blank block (a genuinely empty document)",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/recompute-spec-file.test.js"
  },
  {
    "name": "sourceFromBlockRows (pure) > defaults an omitted Block.text to empty string (Dgraph omits stored empty scalars)",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/recompute-spec-file.test.js"
  },
  {
    "name": "sourceFromBlockRows (pure) > reassembles rows in ordinal order regardless of query order",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/recompute-spec-file.test.js"
  },
  {
    "name": "recomputeFile (live Dgraph) > returns null for a never-projected file with no Block nodes",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/recompute-spec-file.test.js"
  },
  {
    "name": "flattenSpecRing > counts per-section coverage and tags each statement tested by validated_by",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/spec-graph.test.js"
  },
  {
    "name": "flattenSpecRing > returns empty rings for empty input",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/spec-graph.test.js"
  },
  {
    "name": "specLabel > derives '<dir> (<doc>)' from a spec path",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/spec-graph.test.js"
  },
  {
    "name": "specLabel > falls back to the doc name when there is no directory",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/spec-graph.test.js"
  },
  {
    "name": "flattenSpecGraph > flattens specs + linked statements into nodes with clean labels + popover metadata",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/spec-graph.test.js"
  },
  {
    "name": "flattenSpecGraph > links a TestChunk to the CodeChunks its coverage covers",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/spec-graph.test.js"
  },
  {
    "name": "flattenSpecGraph > de-duplicates a CodeChunk covered by two TestChunks",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/spec-graph.test.js"
  },
  {
    "name": "flattenSpecGraph > de-duplicates a TestChunk shared by two statements",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/spec-graph.test.js"
  },
  {
    "name": "flattenSpecGraph > returns an empty graph for empty input",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/spec-graph.test.js"
  },
  {
    "name": "resolveSentenceLink (live Dgraph) > resolves a spec-title + statement-sentence test name to the statement uid",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/resolve-sentence-link.test.js"
  },
  {
    "name": "resolveSentenceLink (live Dgraph) > returns an empty array when the sentence matches no statement",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/resolve-sentence-link.test.js"
  },
  {
    "name": "normalizeForMatch > lowercases and removes all whitespace",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/sentence-link.test.js"
  },
  {
    "name": "normalizeForMatch > collapses a multi-line sentence with ragged indentation",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/sentence-link.test.js"
  },
  {
    "name": "normalizeForMatch > strips a trailing inline link parenthetical",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/sentence-link.test.js"
  },
  {
    "name": "parseSentenceLink > splits a spec | sentence | label test name",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/sentence-link.test.js"
  },
  {
    "name": "parseSentenceLink > keeps later pipes as part of the label",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/sentence-link.test.js"
  },
  {
    "name": "parseSentenceLink > returns null when there are fewer than three segments",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/sentence-link.test.js"
  },
  {
    "name": "matchesNormalized > matches a spec segment as a substring of the H1 title, ignoring case and spaces",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/sentence-link.test.js"
  },
  {
    "name": "matchesNormalized > matches a sentence inside a statement that carries an inline link",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/sentence-link.test.js"
  },
  {
    "name": "matchesNormalized > does not match an unrelated needle",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/sentence-link.test.js"
  },
  {
    "name": "deriveStatementStatus (live Dgraph) > returns untested for a Statement with no trace links",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/statement-status.test.js"
  },
  {
    "name": "deriveStatementStatus (live Dgraph) > returns claimed for a statement whose only trace link is human-linked",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/statement-status.test.js"
  },
  {
    "name": "deriveStatementStatus (live Dgraph) > returns verified-implemented for a statement with an execution-verified trace link",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/statement-status.test.js"
  },
  {
    "name": "suggestCandidates (live Dgraph) > returns the same-embedding CodeChunk as the single nearest candidate",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/suggest-links.test.js"
  },
  {
    "name": "suggestCandidates (live Dgraph) > returns the same-embedding TestChunk as a test candidate",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/suggest-links.test.js"
  },
  {
    "name": "suggestCandidates (live Dgraph) > excludes an identical-embedding CodeChunk from a different repo",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/suggest-links.test.js"
  },
  {
    "name": "suggestCandidates (live Dgraph) > returns empty when the only matching CodeChunk is already implemented_by the statement",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/suggest-links.test.js"
  },
  {
    "name": "summarizeMarkdown > returns the first heading text as title, stripping marker and whitespace",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/summarize-markdown.test.js"
  },
  {
    "name": "summarizeMarkdown > returns the first non-heading, non-blank line as description",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/summarize-markdown.test.js"
  },
  {
    "name": "evidence tier ladder > ranks execution-verified highest down to llm-suggested and picks the highest from a list",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/trace-link-rank.test.js"
  },
  {
    "name": "upsertTraceLink (live Dgraph) > links the Statement to a reified TraceLink carrying kind validated_by, evidence human-linked, and target TestChunk repo|t1",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/trace-link.test.js"
  },
  {
    "name": "upsertTraceLink (live Dgraph) > derives one human-linked validated_by TraceLink from a Statement.validated_by edge to a TestChunk",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/trace-link.test.js"
  },
  {
    "name": "upsertTraceLink (live Dgraph) > tags the validated_by TraceLink execution-verified when the coverage chain proves it",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/trace-link.test.js"
  },
  {
    "name": "upsertTraceLink (live Dgraph) > keeps a generated-provenance TraceLink and does not downgrade it to human-linked on re-derivation",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/trace-link.test.js"
  },
  {
    "name": "projectSpecFile (live Dgraph) > writes a Spec node keyed by repo|filePath with content_hash = sha256(content)",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > stores the spec's H1 heading as Spec.title for sentence-link spec resolution",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > projects two Statement nodes linked to the Spec with verbatim text and sha256 text_hash",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > stores Statement and AcceptanceCriterion embeddings from the injected embedder",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > links the Statement to a TestChunk via validated_by for an inline test link",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > keys a validated_by TestChunk by repo|filePath so two links to one file collapse to the runner's node",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > links the Statement to a CodeChunk via implemented_by for an inline code link",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > returns projected true on first call and projected false on an unchanged second call",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > re-projects changed content and updates the reworded statement's text_hash",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > carries classifier kind/testability/category on an untestable Background statement",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > groups both statements under one Section keyed by repo|filePath|0 reachable via Spec.sections",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > prunes the orphaned second Statement when re-projecting content with only the first",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > prunes an orphaned Section and its Spec.sections edge when a heading is removed on re-projection",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > prunes an orphaned AcceptanceCriterion and its Spec.acceptance_criteria edge when an item is removed",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > projects ordered Block nodes reconstructing heading, blank, and paragraph source off the Spec",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > projects Acceptance Criteria items as AcceptanceCriterion nodes off the Spec and not as Statements",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > recomputes the exact source of a multi-kind document from its projected Blocks",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > recomputes the shorter source when re-projecting fewer blocks prunes the orphaned Blocks",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > replaces a surviving statement's validated_by link when its inline test link changes on re-projection",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > deletes a TestChunk that no surviving statement links after re-projection",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > keeps a TestChunk that another statement still links after one statement drops it",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > keeps a coverage-bearing TestChunk when the only linking statement drops its link",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "projectSpecFile (live Dgraph) > links a statement to a cited ADR via decided_by",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-spec-file.test.ts"
  },
  {
    "name": "verifyCoverageLink (live Dgraph) > returns execution-verified when the validating test covers code the statement implements",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/verify-coverage.test.js"
  },
  {
    "name": "verifyCoverageLink (live Dgraph) > returns untested when the statement has no validated_by test",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/verify-coverage.test.js"
  },
  {
    "name": "verifyCoverageLink (live Dgraph) > returns link-unproven when a validating test exists but covers nothing the statement implements",
    "file": "/home/bogdan/workspace/lore/shared/dist/spec-trace/__tests__/verify-coverage.test.js"
  },
  {
    "name": "Project (live Postgres) > resolves settings, queries tasks, and reads the graph through a real connection",
    "file": "/home/bogdan/workspace/lore/shared/src/project/lib/project.integration.test.ts"
  },
  {
    "name": "Project wiring > builds the tasks port from the pg connection and queries bound to the repo",
    "file": "/home/bogdan/workspace/lore/shared/src/project/lib/project.test.ts"
  },
  {
    "name": "Project wiring > resolves settings through the wired pg settings port",
    "file": "/home/bogdan/workspace/lore/shared/src/project/lib/project.test.ts"
  },
  {
    "name": "Project wiring > throws a clear error when a port was not provided in the map",
    "file": "/home/bogdan/workspace/lore/shared/src/project/lib/project.test.ts"
  },
  {
    "name": "ingestTestReport (live Dgraph) > links a statement via validated_by when a descriptor name sentence-matches its spec (no anchor)",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-test-report.test.ts"
  },
  {
    "name": "ingestTestReport (live Dgraph) > writes one TestChunk keyed repo|t1 with test_name/file_path/start_line/end_line for a single descriptor",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-test-report.test.ts"
  },
  {
    "name": "ingestTestReport (live Dgraph) > links the spec Statement to TestChunk repo|t1 via validated_by for a descriptor with spec anchor specs/foo/spec.md#7",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-test-report.test.ts"
  },
  {
    "name": "ingestTestReport (live Dgraph) > marks the spec Statement violated with a reason naming failing test renders when its result passed is false",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-test-report.test.ts"
  },
  {
    "name": "ingestTestReport (live Dgraph) > keeps the spec Statement violated when one of two validating tests fails and the other passes",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-test-report.test.ts"
  },
  {
    "name": "ingestTestReport (live Dgraph) > clears the spec Statement violated to false when a re-ingest reports the validating test passed",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-test-report.test.ts"
  },
  {
    "name": "ingestTestReport (live Dgraph) > clears the spec Statement violation_reason when a re-ingest reports the validating test passed",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-test-report.test.ts"
  },
  {
    "name": "ingestTestReport (live Dgraph) > covers CodeChunk repo|ccX from result t1's range 5-10 overlapping the chunk's 1-20 span",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-test-report.test.ts"
  },
  {
    "name": "ingestTestReport (live Dgraph) > links TestChunk repo|t1 to the innermost TestSuite Overview for a descriptor with suite [Overview]",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-test-report.test.ts"
  },
  {
    "name": "ingestTestReport (live Dgraph) > nests TestSuites parent-linked outer to inner with TestChunk pointing at the innermost",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-test-report.test.ts"
  },
  {
    "name": "determinism: delete + re-run units reproduces the graph exactly (T281) > reproduces the identical subgraph after deleting it and re-running the units",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/determinism.test.ts"
  },
  {
    "name": "driftCheckFile (live Dgraph) > flips the Statement drifted with reason code-content-changed (render) and updates the CodeChunk hash to NEWHASH when the implementing chunk's content_hash changed",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/drift-check-file.test.ts"
  },
  {
    "name": "driftCheckFile (live Dgraph) > drifts a statement connected only through the coverage chain when the covered code changes",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/drift-check-file.test.ts"
  },
  {
    "name": "driftCheckFile (live Dgraph) > marks the covering Coverage node stale when the covered code changes",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/drift-check-file.test.ts"
  },
  {
    "name": "driftCheckFile (live Dgraph) > returns the drifted statement as a DriftedStatement with specPath ordinal text and reason",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/drift-check-file.test.ts"
  },
  {
    "name": "driftCheckFile (live Dgraph) > drifts an AcceptanceCriterion implemented by a changed chunk",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/drift-check-file.test.ts"
  },
  {
    "name": "driftCheckFile (live Dgraph) > baselines a first-sight chunk with no stored hash instead of drifting it",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/drift-check-file.test.ts"
  },
  {
    "name": "driftCheckFile (live Dgraph) > drifts a statement with reason file-missing when the implementing file has no chunks",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/drift-check-file.test.ts"
  },
  {
    "name": "driftCheckFile (live Dgraph) > sets drift_severity to the cosine distance between the new chunk and statement embeddings",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/drift-check-file.test.ts"
  },
  {
    "name": "driftCheckFile (live Dgraph) > drifts a statement with reason line-out-of-range when the chunk lines overlap no remaining chunk",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/drift-check-file.test.ts"
  },
  {
    "name": "driftCheckFile (live Dgraph) > falls back to the file path in drift_reason when the changed chunk has no symbol_name",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/drift-check-file.test.ts"
  },
  {
    "name": "projectAdrFile (live Dgraph) > recomputes the exact ADR source after projecting it through the graph",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-adr-file.test.ts"
  },
  {
    "name": "projectAdrFile (live Dgraph) > returns projected true then false on an unchanged re-projection (content_hash gate)",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-adr-file.test.ts"
  },
  {
    "name": "projectAdrFile (live Dgraph) > recomputes the shorter source after re-projecting a SHORTER ADR over a longer one",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-adr-file.test.ts"
  },
  {
    "name": "resolveSentenceLink (live Dgraph) > resolves a spec-title + statement-sentence test name to the statement uid",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/resolve-sentence-link.test.ts"
  },
  {
    "name": "resolveSentenceLink (live Dgraph) > returns an empty array when the sentence matches no statement",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/resolve-sentence-link.test.ts"
  },
  {
    "name": "language-agnostic e2e: no tree-sitter grammar (Ruby) > projects a Ruby-linked spec to file+line nodes, covers by line overlap, and drifts on a code change",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/language-agnostic-e2e.test.ts"
  },
  {
    "name": "upsertTraceLink (live Dgraph) > links the Statement to a reified TraceLink carrying kind validated_by, evidence human-linked, and target TestChunk repo|t1",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/trace-link.test.ts"
  },
  {
    "name": "upsertTraceLink (live Dgraph) > derives one human-linked validated_by TraceLink from a Statement.validated_by edge to a TestChunk",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/trace-link.test.ts"
  },
  {
    "name": "upsertTraceLink (live Dgraph) > tags the validated_by TraceLink execution-verified when the coverage chain proves it",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/trace-link.test.ts"
  },
  {
    "name": "upsertTraceLink (live Dgraph) > keeps a generated-provenance TraceLink and does not downgrade it to human-linked on re-derivation",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/trace-link.test.ts"
  },
  {
    "name": "deriveStatementStatus (live Dgraph) > returns untested for a Statement with no trace links",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/statement-status.test.ts"
  },
  {
    "name": "deriveStatementStatus (live Dgraph) > returns claimed for a statement whose only trace link is human-linked",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/statement-status.test.ts"
  },
  {
    "name": "deriveStatementStatus (live Dgraph) > returns verified-implemented for a statement with an execution-verified trace link",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/statement-status.test.ts"
  },
  {
    "name": "ingestCoverageReport (live Dgraph) > writes one Coverage node keyed by repo|testFile|testName with repo/tool/commit for a record with no covered ranges",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-coverage.test.ts"
  },
  {
    "name": "ingestCoverageReport (live Dgraph) > adds one COVERS edge to the CodeChunk when covered 5-10 overlaps the chunk 1-20",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-coverage.test.ts"
  },
  {
    "name": "ingestCoverageReport (live Dgraph) > counts 6 unmatched lines for covered 5-10 overlapping no CodeChunk",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-coverage.test.ts"
  },
  {
    "name": "ingestCoverageReport (live Dgraph) > re-ingest with a new commit replaces COVERS so only ccB remains, not ccA",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-coverage.test.ts"
  },
  {
    "name": "ingestCoverageReport (live Dgraph) > links the matching TestChunk to the Coverage node via HAS_COVERAGE",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-coverage.test.ts"
  },
  {
    "name": "GitCli (live git) > clones the remote and reads a seeded file",
    "file": "/home/bogdan/workspace/lore/shared/src/project/workspace/git-cli.test.ts"
  },
  {
    "name": "GitCli (live git) > writes, commits on a new branch, and pushes to the remote",
    "file": "/home/bogdan/workspace/lore/shared/src/project/workspace/git-cli.test.ts"
  },
  {
    "name": "GitCli (live git) > commits with the Lore Agent identity when the environment provides none",
    "file": "/home/bogdan/workspace/lore/shared/src/project/workspace/git-cli.test.ts"
  },
  {
    "name": "GitCli (live git) > ensureClone clones when absent, then reuses the cache (fetch, not re-clone) on the second call",
    "file": "/home/bogdan/workspace/lore/shared/src/project/workspace/git-cli.test.ts"
  },
  {
    "name": "GitCli (live git) > ensureCheckout pins the working tree to a branch",
    "file": "/home/bogdan/workspace/lore/shared/src/project/workspace/git-cli.test.ts"
  },
  {
    "name": "GitCli (live git) > ensureCheckout refuses to switch a dirty working tree",
    "file": "/home/bogdan/workspace/lore/shared/src/project/workspace/git-cli.test.ts"
  },
  {
    "name": "suggestCandidates (live Dgraph) > returns the same-embedding CodeChunk as the single nearest candidate",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/suggest-links.test.ts"
  },
  {
    "name": "suggestCandidates (live Dgraph) > returns the same-embedding TestChunk as a test candidate",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/suggest-links.test.ts"
  },
  {
    "name": "suggestCandidates (live Dgraph) > excludes an identical-embedding CodeChunk from a different repo",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/suggest-links.test.ts"
  },
  {
    "name": "suggestCandidates (live Dgraph) > returns empty when the only matching CodeChunk is already implemented_by the statement",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/suggest-links.test.ts"
  },
  {
    "name": "ingestSpecTrace (live Dgraph) > writes a TestChunk via ingestTestReport when kind is test-report",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-spec-trace.test.ts"
  },
  {
    "name": "ingestSpecTrace (live Dgraph) > writes Coverage with a COVERS edge via ingestCoverageReport when kind is coverage",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-spec-trace.test.ts"
  },
  {
    "name": "verifyCoverageLink (live Dgraph) > returns execution-verified when the validating test covers code the statement implements",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/verify-coverage.test.ts"
  },
  {
    "name": "verifyCoverageLink (live Dgraph) > returns untested when the statement has no validated_by test",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/verify-coverage.test.ts"
  },
  {
    "name": "verifyCoverageLink (live Dgraph) > returns link-unproven when a validating test exists but covers nothing the statement implements",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/verify-coverage.test.ts"
  },
  {
    "name": "projectCodeFile (live Dgraph) > upserts one CodeChunk per top-level symbol with line range and content hash",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/project-code-file.test.ts"
  },
  {
    "name": "sourceFromBlockRows (pure) > returns null for zero rows (a never-projected document)",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/recompute-spec-file.test.ts"
  },
  {
    "name": "sourceFromBlockRows (pure) > returns empty string for a single blank block (a genuinely empty document)",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/recompute-spec-file.test.ts"
  },
  {
    "name": "sourceFromBlockRows (pure) > defaults an omitted Block.text to empty string (Dgraph omits stored empty scalars)",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/recompute-spec-file.test.ts"
  },
  {
    "name": "sourceFromBlockRows (pure) > reassembles rows in ordinal order regardless of query order",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/recompute-spec-file.test.ts"
  },
  {
    "name": "recomputeFile (live Dgraph) > returns null for a never-projected file with no Block nodes",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/recompute-spec-file.test.ts"
  },
  {
    "name": "ExecTestRunner (live shell) > lists the descriptors emitted by the manifest list command",
    "file": "/home/bogdan/workspace/lore/shared/src/project/test-runner/test-runner-exec.test.ts"
  },
  {
    "name": "ExecTestRunner (live shell) > runs a single test and aggregates the report",
    "file": "/home/bogdan/workspace/lore/shared/src/project/test-runner/test-runner-exec.test.ts"
  },
  {
    "name": "PlatformGitHub auth > throws a clear config error when neither App creds nor a token are set",
    "file": "/home/bogdan/workspace/lore/shared/src/project/lib/platform-github.test.ts"
  },
  {
    "name": "PlatformGitHub auth > exposes the github port name",
    "file": "/home/bogdan/workspace/lore/shared/src/project/lib/platform-github.test.ts"
  },
  {
    "name": "PgKnowledge > queries the live graph bound to the repo and maps to GraphEdge",
    "file": "/home/bogdan/workspace/lore/shared/src/project/knowledge/knowledge-pg.test.ts"
  },
  {
    "name": "PgKnowledge > resolves the team schema then lists specs from its chunks",
    "file": "/home/bogdan/workspace/lore/shared/src/project/knowledge/knowledge-pg.test.ts"
  },
  {
    "name": "PgKnowledge > falls back to org_shared when the team is not a valid schema",
    "file": "/home/bogdan/workspace/lore/shared/src/project/knowledge/knowledge-pg.test.ts"
  },
  {
    "name": "PgKnowledge > assembles repo context through the relocated engine, bound to the repo",
    "file": "/home/bogdan/workspace/lore/shared/src/project/knowledge/knowledge-pg.test.ts"
  },
  {
    "name": "AgentRunner > local mode spawns the agent CLI and reports started",
    "file": "/home/bogdan/workspace/lore/shared/src/project/agents/agent-runner.test.ts"
  },
  {
    "name": "AgentRunner > cluster mode creates a LoreTask CR via the injected K8sPort",
    "file": "/home/bogdan/workspace/lore/shared/src/project/agents/agent-runner.test.ts"
  },
  {
    "name": "AgentRunner > direct mode calls the injected LlmPort",
    "file": "/home/bogdan/workspace/lore/shared/src/project/agents/agent-runner.test.ts"
  },
  {
    "name": "AgentRunner > throws when cluster mode has no K8sPort provider",
    "file": "/home/bogdan/workspace/lore/shared/src/project/agents/agent-runner.test.ts"
  },
  {
    "name": "flattenSpecRing > counts per-section coverage and tags each statement tested by validated_by",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/spec-graph.test.ts"
  },
  {
    "name": "flattenSpecRing > returns empty rings for empty input",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/spec-graph.test.ts"
  },
  {
    "name": "specLabel > derives '<dir> (<doc>)' from a spec path",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/spec-graph.test.ts"
  },
  {
    "name": "specLabel > falls back to the doc name when there is no directory",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/spec-graph.test.ts"
  },
  {
    "name": "flattenSpecGraph > flattens specs + linked statements into nodes with clean labels + popover metadata",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/spec-graph.test.ts"
  },
  {
    "name": "flattenSpecGraph > links a TestChunk to the CodeChunks its coverage covers",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/spec-graph.test.ts"
  },
  {
    "name": "flattenSpecGraph > de-duplicates a CodeChunk covered by two TestChunks",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/spec-graph.test.ts"
  },
  {
    "name": "flattenSpecGraph > de-duplicates a TestChunk shared by two statements",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/spec-graph.test.ts"
  },
  {
    "name": "flattenSpecGraph > returns an empty graph for empty input",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/spec-graph.test.ts"
  },
  {
    "name": "parseCodeChunks > returns one chunk per top-level function with 1-based line range and symbol_type",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/parse-code-chunks.test.ts"
  },
  {
    "name": "parseCodeChunks > describes class, interface, type, enum, and const declarations across the file",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/parse-code-chunks.test.ts"
  },
  {
    "name": "parseCodeChunks > skips imports and bare expressions, hashing only the symbol body",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/parse-code-chunks.test.ts"
  },
  {
    "name": "selectIngestFiles > selects specs/ and .specify/ markdown for the specs kind",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-graph-task.test.ts"
  },
  {
    "name": "selectIngestFiles > selects only adrs/ markdown for the adrs kind",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-graph-task.test.ts"
  },
  {
    "name": "selectIngestFiles > selects source .ts for the code kind, excluding tests and declarations",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-graph-task.test.ts"
  },
  {
    "name": "selectIngestFiles > returns nothing for an unknown kind",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-graph-task.test.ts"
  },
  {
    "name": "summarizeIngest > reports completed when everything projected",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-graph-task.test.ts"
  },
  {
    "name": "summarizeIngest > reports completed when everything was an unchanged skip",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-graph-task.test.ts"
  },
  {
    "name": "summarizeIngest > reports failed only when every attempted file failed",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-graph-task.test.ts"
  },
  {
    "name": "summarizeIngest > stays completed on a partial failure",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-graph-task.test.ts"
  },
  {
    "name": "runIngestGraph > short-circuits to skipped when no dgraph client is configured",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-graph-task.test.ts"
  },
  {
    "name": "runIngestGraph > projects then skips identical content on a second run (idempotent)",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-graph-task.test.ts"
  },
  {
    "name": "runIngestGraph > self-skips the tests kind when no buildTestReport port is provided (cluster)",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-graph-task.test.ts"
  },
  {
    "name": "escapeXmlAttr > escapes quotes, ampersands, and angle brackets",
    "file": "/home/bogdan/workspace/lore/shared/src/project/knowledge/context-assembly-format.test.ts"
  },
  {
    "name": "dedupeItems > keeps one item per source_path, retaining the higher score",
    "file": "/home/bogdan/workspace/lore/shared/src/project/knowledge/context-assembly-format.test.ts"
  },
  {
    "name": "dedupeItems > keeps items without a source_path untouched",
    "file": "/home/bogdan/workspace/lore/shared/src/project/knowledge/context-assembly-format.test.ts"
  },
  {
    "name": "serializeDocument > renders provenance as attributes and contains markdown without heading collision",
    "file": "/home/bogdan/workspace/lore/shared/src/project/knowledge/context-assembly-format.test.ts"
  },
  {
    "name": "serializeDocument > marks a truncated document with a truncated attribute",
    "file": "/home/bogdan/workspace/lore/shared/src/project/knowledge/context-assembly-format.test.ts"
  },
  {
    "name": "serializeContext > wraps sections and documents in nested context/section/document tags",
    "file": "/home/bogdan/workspace/lore/shared/src/project/knowledge/context-assembly-format.test.ts"
  },
  {
    "name": "normalizeForMatch > lowercases and removes all whitespace",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/sentence-link.test.ts"
  },
  {
    "name": "normalizeForMatch > collapses a multi-line sentence with ragged indentation",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/sentence-link.test.ts"
  },
  {
    "name": "normalizeForMatch > strips a trailing inline link parenthetical",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/sentence-link.test.ts"
  },
  {
    "name": "parseSentenceLink > splits a spec | sentence | label test name",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/sentence-link.test.ts"
  },
  {
    "name": "parseSentenceLink > keeps later pipes as part of the label",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/sentence-link.test.ts"
  },
  {
    "name": "parseSentenceLink > returns null when there are fewer than three segments",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/sentence-link.test.ts"
  },
  {
    "name": "matchesNormalized > matches a spec segment as a substring of the H1 title, ignoring case and spaces",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/sentence-link.test.ts"
  },
  {
    "name": "matchesNormalized > matches a sentence inside a statement that carries an inline link",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/sentence-link.test.ts"
  },
  {
    "name": "matchesNormalized > does not match an unrelated needle",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/sentence-link.test.ts"
  },
  {
    "name": "assembleTraceDocument > orders statements by ordinal and derives state + coverage counts from the graph",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/assemble-trace-document.test.ts"
  },
  {
    "name": "assembleTraceDocument > returns ordered sections and each statement's section ref, links, and drift/violation metadata",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/assemble-trace-document.test.ts"
  },
  {
    "name": "assembleTraceDocument > sets title to the ordinal-first section heading 'Goals'",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/assemble-trace-document.test.ts"
  },
  {
    "name": "assembleTraceDocument > sets description to the ordinal-first statement's text 'First sentence.'",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/assemble-trace-document.test.ts"
  },
  {
    "name": "assembleTraceDocument > falls back title to the file basename 'spec.md' when the spec has no sections",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/assemble-trace-document.test.ts"
  },
  {
    "name": "PgTaskStore > queries pending statuses bound to the repo",
    "file": "/home/bogdan/workspace/lore/shared/src/project/tasks/task-store-pg.test.ts"
  },
  {
    "name": "PgTaskStore > transitions a cancel to the cancelled status",
    "file": "/home/bogdan/workspace/lore/shared/src/project/tasks/task-store-pg.test.ts"
  },
  {
    "name": "PgTaskStore > setStatus writes status + updated_at + only allowlisted extra columns",
    "file": "/home/bogdan/workspace/lore/shared/src/project/tasks/task-store-pg.test.ts"
  },
  {
    "name": "PgTaskStore > updateStatus reads the old status, sets the new one, then records the event",
    "file": "/home/bogdan/workspace/lore/shared/src/project/tasks/task-store-pg.test.ts"
  },
  {
    "name": "parseValidatesAnnotations > returns one ref with numeric ordinal and the file path as target for a single lore:validates line",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/provenance.test.ts"
  },
  {
    "name": "parseValidatesAnnotations > returns one ref splitting on the ordinal # for a #-comment lore:validates line",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/provenance.test.ts"
  },
  {
    "name": "resolveProvenance > returns one ref when the same triple appears in two sources",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/provenance.test.ts"
  },
  {
    "name": "resolveProvenance > keeps only the annotation ref when annotation and inline conflict on the same specPath and ordinal",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/provenance.test.ts"
  },
  {
    "name": "detectProvenanceConflicts > returns one conflict listing both distinct targets in inline-then-annotation order when inline and annotation disagree on the same specPath and ordinal",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/provenance.test.ts"
  },
  {
    "name": "detectProvenanceConflicts > returns no conflict when the same triple appears in two sources with identical target",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/provenance.test.ts"
  },
  {
    "name": "PgSettings > resolves the repo's dark_factory settings from the JSONB row",
    "file": "/home/bogdan/workspace/lore/shared/src/project/settings/settings-pg.test.ts"
  },
  {
    "name": "PgSettings > falls back to defaults when the repo has no settings row",
    "file": "/home/bogdan/workspace/lore/shared/src/project/settings/settings-pg.test.ts"
  },
  {
    "name": "PgSettings > resolveOrNull returns null when the repo is not onboarded",
    "file": "/home/bogdan/workspace/lore/shared/src/project/settings/settings-pg.test.ts"
  },
  {
    "name": "PgSettings > resolveOrNull resolves the settings when the repo row exists",
    "file": "/home/bogdan/workspace/lore/shared/src/project/settings/settings-pg.test.ts"
  },
  {
    "name": "PgSettings > delegates a variable write to the repo-config writer",
    "file": "/home/bogdan/workspace/lore/shared/src/project/settings/settings-pg.test.ts"
  },
  {
    "name": "parseAdrRefs > extracts distinct ADR numbers, normalizing zero-padding",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/adr-refs.test.ts"
  },
  {
    "name": "parseAdrRefs > returns nothing when no ADR is cited",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/adr-refs.test.ts"
  },
  {
    "name": "parseAdrRefs > matches an ADR cited with a slug suffix",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/adr-refs.test.ts"
  },
  {
    "name": "adrNumberFromPath > extracts the number from an ADR filename",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/adr-refs.test.ts"
  },
  {
    "name": "adrNumberFromPath > returns null for a non-ADR path",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/adr-refs.test.ts"
  },
  {
    "name": "Agents trust gate > refuses LOCAL execution on the shared server (LORE_DB_HOST set)",
    "file": "/home/bogdan/workspace/lore/shared/src/project/agents/agents.test.ts"
  },
  {
    "name": "Agents trust gate > allows cluster mode even with LORE_DB_HOST set (the agent creates CRs on the cluster)",
    "file": "/home/bogdan/workspace/lore/shared/src/project/agents/agents.test.ts"
  },
  {
    "name": "Agents trust gate > routes to the requested mode in a sandbox",
    "file": "/home/bogdan/workspace/lore/shared/src/project/agents/agents.test.ts"
  },
  {
    "name": "IssueCollection > returns the GitHubPort issues for the project's repo",
    "file": "/home/bogdan/workspace/lore/shared/src/project/issues/issues.test.ts"
  },
  {
    "name": "IssueCollection > creates an issue bound to the repo",
    "file": "/home/bogdan/workspace/lore/shared/src/project/issues/issues.test.ts"
  },
  {
    "name": "IssueCollection > comments, closes, and labels by number bound to the repo",
    "file": "/home/bogdan/workspace/lore/shared/src/project/issues/issues.test.ts"
  },
  {
    "name": "TestSuite trust gate > refuses to list tests on the shared server (LORE_DB_HOST set)",
    "file": "/home/bogdan/workspace/lore/shared/src/project/test-runner/test-suite.test.ts"
  },
  {
    "name": "TestSuite trust gate > lists tests in a trusted sandbox (no LORE_DB_HOST)",
    "file": "/home/bogdan/workspace/lore/shared/src/project/test-runner/test-suite.test.ts"
  },
  {
    "name": "TaskList > returns pending Tasks for the repo as typed wrappers",
    "file": "/home/bogdan/workspace/lore/shared/src/project/tasks/task-list.test.ts"
  },
  {
    "name": "TaskList > reflects the new status after cancel()",
    "file": "/home/bogdan/workspace/lore/shared/src/project/tasks/task-list.test.ts"
  },
  {
    "name": "PullRequests > lists only the repo's pull requests",
    "file": "/home/bogdan/workspace/lore/shared/src/project/pulls/pull-requests.test.ts"
  },
  {
    "name": "PullRequests > merges by number with the requested method bound to the repo",
    "file": "/home/bogdan/workspace/lore/shared/src/project/pulls/pull-requests.test.ts"
  },
  {
    "name": "PullRequests > exposes PR reads bound to the repo and number",
    "file": "/home/bogdan/workspace/lore/shared/src/project/pulls/pull-requests.test.ts"
  },
  {
    "name": "decideNotify > fires for any level when channels include all",
    "file": "/home/bogdan/workspace/lore/shared/src/project/notify/notify-decision.test.ts"
  },
  {
    "name": "decideNotify > always fires escalation regardless of channels",
    "file": "/home/bogdan/workspace/lore/shared/src/project/notify/notify-decision.test.ts"
  },
  {
    "name": "decideNotify > fires watched only when the watched channel is listed",
    "file": "/home/bogdan/workspace/lore/shared/src/project/notify/notify-decision.test.ts"
  },
  {
    "name": "decideNotify > suppresses pr_open unless all is listed",
    "file": "/home/bogdan/workspace/lore/shared/src/project/notify/notify-decision.test.ts"
  },
  {
    "name": "repoRelativeLinkTarget > returns a repo-relative target unchanged",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/link-target-path.test.ts"
  },
  {
    "name": "repoRelativeLinkTarget > resolves a ../-relative target against the spec's directory",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/link-target-path.test.ts"
  },
  {
    "name": "repoRelativeLinkTarget > resolves a ./-relative target against the spec's directory",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/link-target-path.test.ts"
  },
  {
    "name": "repoRelativeLinkTarget > drops a bare anchor target",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/link-target-path.test.ts"
  },
  {
    "name": "repoRelativeLinkTarget > drops an empty target",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/link-target-path.test.ts"
  },
  {
    "name": "repoRelativeLinkTarget > drops a target that escapes the repo root",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/link-target-path.test.ts"
  },
  {
    "name": "repoRelativeLinkTarget > strips a fragment from an otherwise valid target",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/link-target-path.test.ts"
  },
  {
    "name": "Settings > resolves the repo's settings via the real resolver",
    "file": "/home/bogdan/workspace/lore/shared/src/project/settings/settings.test.ts"
  },
  {
    "name": "Settings > binds the repo when setting a GitHub variable",
    "file": "/home/bogdan/workspace/lore/shared/src/project/settings/settings.test.ts"
  },
  {
    "name": "RepoFiles > reads a file from the repo at the given ref",
    "file": "/home/bogdan/workspace/lore/shared/src/project/repo/repo-files.test.ts"
  },
  {
    "name": "RepoFiles > returns null for a file the repo does not have",
    "file": "/home/bogdan/workspace/lore/shared/src/project/repo/repo-files.test.ts"
  },
  {
    "name": "RepoFiles > creates a branch and commits a file via the API, repo bound",
    "file": "/home/bogdan/workspace/lore/shared/src/project/repo/repo-files.test.ts"
  },
  {
    "name": "ingestSpecTrace (unknown kind) > rejects with an error naming the kind for an unrecognized kind",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/ingest-spec-trace-unknown-kind.test.ts"
  },
  {
    "name": "MemoryStoreBridge > writes through the seam and returns key + version",
    "file": "/home/bogdan/workspace/lore/shared/src/project/memory/memory-store-bridge.test.ts"
  },
  {
    "name": "MemoryStoreBridge > lists only the repo's memories from the seam",
    "file": "/home/bogdan/workspace/lore/shared/src/project/memory/memory-store-bridge.test.ts"
  },
  {
    "name": "Notify > delivers an escalation bound to the repo",
    "file": "/home/bogdan/workspace/lore/shared/src/project/notify/notify.test.ts"
  },
  {
    "name": "Notify > does not deliver a pr_open when the repo's channels do not authorize it",
    "file": "/home/bogdan/workspace/lore/shared/src/project/notify/notify.test.ts"
  },
  {
    "name": "Workspace > writes then reads back a file and commits through the GitPort",
    "file": "/home/bogdan/workspace/lore/shared/src/project/workspace/workspace.test.ts"
  },
  {
    "name": "Workspace > pushes the branch then opens the PR via the pulls port",
    "file": "/home/bogdan/workspace/lore/shared/src/project/workspace/workspace.test.ts"
  },
  {
    "name": "KnowledgeView > assembles context scoped to the repo",
    "file": "/home/bogdan/workspace/lore/shared/src/project/knowledge/knowledge.test.ts"
  },
  {
    "name": "KnowledgeView > lists the repo's specs",
    "file": "/home/bogdan/workspace/lore/shared/src/project/knowledge/knowledge.test.ts"
  },
  {
    "name": "NotifySlack > fires an escalation using the repo's resolved channels",
    "file": "/home/bogdan/workspace/lore/shared/src/project/notify/notify-slack.test.ts"
  },
  {
    "name": "NotifySlack > suppresses a pr_open when the repo's channels do not include all",
    "file": "/home/bogdan/workspace/lore/shared/src/project/notify/notify-slack.test.ts"
  },
  {
    "name": "Memory > writes then reads back the value for the repo",
    "file": "/home/bogdan/workspace/lore/shared/src/project/memory/memory.test.ts"
  },
  {
    "name": "Memory > isolates memories of a different repo",
    "file": "/home/bogdan/workspace/lore/shared/src/project/memory/memory.test.ts"
  },
  {
    "name": "formatSpecDriftReport > returns an empty string for no drift findings",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/format-drift-report.test.ts"
  },
  {
    "name": "formatSpecDriftReport > includes the spec path, statement text, and reason for a single drift finding",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/format-drift-report.test.ts"
  },
  {
    "name": "summarizeMarkdown > returns the first heading text as title, stripping marker and whitespace",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/summarize-markdown.test.ts"
  },
  {
    "name": "summarizeMarkdown > returns the first non-heading, non-blank line as description",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/summarize-markdown.test.ts"
  },
  {
    "name": "evidence tier ladder > ranks execution-verified highest down to llm-suggested and picks the highest from a list",
    "file": "/home/bogdan/workspace/lore/shared/src/spec-trace/__tests__/trace-link-rank.test.ts"
  }
]
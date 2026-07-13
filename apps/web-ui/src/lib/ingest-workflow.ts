/**
 * In-sync mirror of `shared/src/ingest-workflow.ts`. web-ui is not a
 * workspace member, so it can't import from `@re-cinq/lore-shared`
 * directly. Keep both copies in step — the byte content here is what the
 * "fix" button commits to repos and must match what the agent installs.
 * See web-ui/CLAUDE.md and `lib/test-paths.ts` for the mirror pattern.
 */

export const LORE_INGEST_WORKFLOW_PATH = ".github/workflows/lore-ingest.yml";

export const LORE_INGEST_WORKFLOW_VERSION = 3;

export const LORE_INGEST_WORKFLOW_CONTENT = `# lore-ingest-version: 3
name: Lore Context Ingest

on:
  push:
    branches: [main]
    paths:
      - 'CLAUDE.md'
      - 'AGENTS.md'
      - 'adrs/**'
      - 'runbooks/**'
      - 'specs/**'
      - 'teams/**'
      - '.specify/**'

jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - name: Get changed files
        id: changes
        run: |
          FILES=$(git diff --name-only HEAD~1 HEAD | jq -R -s -c 'split("\\n") | map(select(. != ""))')
          echo "files=\${FILES}" >> "$GITHUB_OUTPUT"

      - name: Notify Lore to ingest
        if: steps.changes.outputs.files != '[]'
        env:
          LORE_INGEST_TOKEN: \${{ secrets.LORE_INGEST_TOKEN }}
          LORE_INGEST_URL: \${{ vars.LORE_INGEST_URL }}
          FILES: \${{ steps.changes.outputs.files }}
        run: |
          curl -sf -X POST \\
            -H "Authorization: Bearer \${LORE_INGEST_TOKEN}" \\
            -H "Content-Type: application/json" \\
            -d "{
              \\"files\\": \${FILES},
              \\"repo\\": \\"\${{ github.repository }}\\",
              \\"commit\\": \\"\${{ github.sha }}\\"
            }" \\
            "\${LORE_INGEST_URL}/api/ingest" \\
            || echo "::warning::Could not reach Lore ingest endpoint"

  graph:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        kind: [specs, adrs]
    steps:
      - name: Project \${{ matrix.kind }} into the graph
        env:
          LORE_INGEST_TOKEN: \${{ secrets.LORE_INGEST_TOKEN }}
          LORE_INGEST_URL: \${{ vars.LORE_INGEST_URL }}
        run: |
          curl -sf -X POST \\
            -H "Authorization: Bearer \${LORE_INGEST_TOKEN}" \\
            -H "Content-Type: application/json" \\
            -d "{\\"kinds\\":[\\"\${{ matrix.kind }}\\"],\\"commit\\":\\"\${{ github.sha }}\\"}" \\
            "\${LORE_INGEST_URL}/api/repos/\${{ github.repository }}/ingest-graph" \\
            || echo "::warning::Could not reach Lore ingest-graph endpoint for \${{ matrix.kind }}"
`;

export type IngestWorkflowStatus = "missing" | "stale" | "aligned";

/** Read the `# lore-ingest-version: N` marker, or null when absent. */
export function parseIngestWorkflowVersion(content: string): number | null {
  const match = content.match(/^#\s*lore-ingest-version:\s*(\d+)/m);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Classify a repo's installed workflow against the canonical version.
 * `null` content means the file is absent. A missing or older marker is
 * `stale` (legacy installs predate the marker and carry the broken body).
 */
export function ingestWorkflowStatus(
  content: string | null,
): IngestWorkflowStatus {
  if (content === null) return "missing";
  const version = parseIngestWorkflowVersion(content);
  return version !== null && version >= LORE_INGEST_WORKFLOW_VERSION
    ? "aligned"
    : "stale";
}

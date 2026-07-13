/**
 * Canonical source of truth for the `lore-trace-impact.yml` GitHub Actions
 * workflow that every onboarded repo installs. On each pull_request it sends the
 * diff (changed file + line ranges) to the Lore `/impact` endpoint and renders
 * the returned annotations + sticky summary comment — the deterministic,
 * advisory pre-merge spec-breakage check. The agent's onboard handler commits
 * {@link TRACE_IMPACT_WORKFLOW_CONTENT}; drift is surfaced via
 * {@link traceImpactWorkflowStatus} (mirrors lore-ingest.yml).
 *
 * Bump {@link TRACE_IMPACT_WORKFLOW_VERSION} (and the first-line marker) on any
 * change. The check is ALWAYS advisory (neutral conclusion) and fails soft when
 * the backend reports the graph is unavailable — it never red-Xes a PR.
 */

export const TRACE_IMPACT_WORKFLOW_PATH =
  ".github/workflows/lore-trace-impact.yml";

export const TRACE_IMPACT_WORKFLOW_VERSION = 1;

export const TRACE_IMPACT_WORKFLOW_CONTENT = `# lore-trace-impact-version: 1
name: Lore Spec Impact

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  checks: write
  pull-requests: write

jobs:
  impact:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Compute changed ranges
        id: diff
        env:
          BASE_SHA: \${{ github.event.pull_request.base.sha }}
          HEAD_SHA: \${{ github.event.pull_request.head.sha }}
        run: |
          git diff --unified=0 "$BASE_SHA" "$HEAD_SHA" | node -e '
            const lines = require("fs").readFileSync(0, "utf8").split("\\n");
            const files = []; let cur = null;
            for (const line of lines) {
              const f = line.match(/^\\+\\+\\+ b\\/(.+)$/);
              if (f) { cur = { path: f[1], ranges: [], deleted: [] }; files.push(cur); continue; }
              const h = line.match(/^@@ -(\\d+)(?:,(\\d+))? \\+(\\d+)(?:,(\\d+))? @@/);
              if (h && cur) {
                const oldStart = +h[1], oldLen = h[2] === undefined ? 1 : +h[2];
                const newStart = +h[3], newLen = h[4] === undefined ? 1 : +h[4];
                if (newLen > 0) cur.ranges.push([newStart, newStart + newLen - 1]);
                if (oldLen > 0) cur.deleted.push([oldStart, oldStart + oldLen - 1]);
              }
            }
            require("fs").writeFileSync("impact-diff.json", JSON.stringify({ files }));
          '

      - name: Query Lore impact
        id: query
        env:
          LORE_INGEST_TOKEN: \${{ secrets.LORE_INGEST_TOKEN }}
          LORE_INGEST_URL: \${{ vars.LORE_INGEST_URL }}
          COMMIT: \${{ github.event.pull_request.head.sha }}
        run: |
          BODY=$(node -e 'const d=require("./impact-diff.json"); d.commit=process.env.COMMIT; process.stdout.write(JSON.stringify(d))')
          curl -sf -X POST \\
            -H "Authorization: Bearer \${LORE_INGEST_TOKEN}" \\
            -H "Content-Type: application/json" \\
            -d "$BODY" \\
            "\${LORE_INGEST_URL}/api/repos/\${{ github.repository }}/impact" \\
            -o impact.json \\
            || echo '{"status":"unavailable","statements":[],"orphaned":[],"annotations":[],"comment":"## 🔍 Lore Spec Impact\\n\\nGraph not available — skipping.\\n\\n<!-- lore-trace-impact -->"}' > impact.json

      - name: Render annotations + sticky comment
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const MARKER = '<!-- lore-trace-impact -->';
            let report;
            try { report = JSON.parse(fs.readFileSync('impact.json', 'utf8')); }
            catch { report = { status: 'unavailable', annotations: [], comment: '## 🔍 Lore Spec Impact\\n\\nGraph not available — skipping.\\n\\n' + MARKER }; }

            const annotations = (report.annotations || []).slice(0, 50);
            await github.rest.checks.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              name: 'Lore Spec Impact',
              head_sha: context.payload.pull_request.head.sha,
              status: 'completed',
              conclusion: 'neutral',
              output: {
                title: 'Lore Spec Impact (advisory)',
                summary: report.comment || 'No spec impact.',
                annotations,
              },
            });

            const body = report.comment || ('## 🔍 Lore Spec Impact\\n\\nNo spec impact.\\n\\n' + MARKER);
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.payload.pull_request.number,
            });
            const existing = comments.find((c) => c.body && c.body.includes(MARKER));
            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner, repo: context.repo.repo, comment_id: existing.id, body,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner, repo: context.repo.repo, issue_number: context.payload.pull_request.number, body,
              });
            }
`;

export type TraceImpactWorkflowStatus = "missing" | "stale" | "aligned";

/** Read the `# lore-trace-impact-version: N` marker, or null when absent. */
export function parseTraceImpactWorkflowVersion(
  content: string,
): number | null {
  const match = content.match(/^#\s*lore-trace-impact-version:\s*(\d+)/m);
  return match ? parseInt(match[1], 10) : null;
}

/** Classify a repo's installed workflow against the canonical version. */
export function traceImpactWorkflowStatus(
  content: string | null,
): TraceImpactWorkflowStatus {
  if (content === null) return "missing";
  const version = parseTraceImpactWorkflowVersion(content);
  return version !== null && version >= TRACE_IMPACT_WORKFLOW_VERSION
    ? "aligned"
    : "stale";
}

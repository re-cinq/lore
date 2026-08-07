/**
 * Canonical source of truth for the `lore-trace-impact.yml` GitHub Actions
 * workflow that every onboarded repo installs. On each pull_request it sends the
 * diff (changed file + line ranges) plus the head text of any changed spec/ADR
 * to the Lore `/impact` endpoint, and renders the returned annotations + sticky
 * summary comment — the deterministic, advisory pre-merge spec-impact check.
 * The agent's onboard handler commits {@link TRACE_IMPACT_WORKFLOW_CONTENT};
 * drift is surfaced via {@link traceImpactWorkflowStatus} (mirrors lore-ingest.yml).
 *
 * This constant is the ORIGINAL; `.github/workflows/lore-trace-impact.yml` in
 * this repo is its dogfood installation, held byte-identical by
 * `trace-impact-workflow.parity.test.ts`. The two silently diverged at v1 (the
 * installed copy grew the comment-before-check ordering and a different vars
 * name) while both still claimed version 1, so the drift detector reported
 * "aligned" for a workflow that was not.
 *
 * Bump {@link TRACE_IMPACT_WORKFLOW_VERSION} (and the first-line marker) on any
 * change. The check is ALWAYS advisory (neutral conclusion) and fails soft when
 * the backend reports the graph is unavailable — it never red-Xes a PR.
 */

export const TRACE_IMPACT_WORKFLOW_PATH =
  ".github/workflows/lore-trace-impact.yml";

export const TRACE_IMPACT_WORKFLOW_VERSION = 2;

export const TRACE_IMPACT_WORKFLOW_CONTENT = `# lore-trace-impact-version: 2
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
          # Diff against the MERGE BASE, not the base branch tip. base.sha is
          # whatever main pointed at when the event fired, so a two-dot diff
          # reports every commit merged to main since the branch point as a
          # reversed change of this PR - which is how a PR touching none of them
          # got 31 statements blamed on task-queue-pg.ts and friends.
          MERGE_BASE=$(git merge-base "$BASE_SHA" "$HEAD_SHA")
          echo "diffing $MERGE_BASE..$HEAD_SHA"
          git diff --unified=0 "$MERGE_BASE" "$HEAD_SHA" | node -e '
            const fs = require("fs");
            const lines = fs.readFileSync(0, "utf8").split("\\n");
            const unquote = (s) => s.trim().replace(/^"|"$/g, "");
            const files = []; let cur = null; let oldPath = null;
            for (const line of lines) {
              if (line.startsWith("--- ")) {
                const from = unquote(line.slice(4));
                oldPath = from === "/dev/null" ? null : from.replace(/^a\\//, "");
                continue;
              }
              if (line.startsWith("+++ ")) {
                const target = unquote(line.slice(4));
                // A deleted file is "+++ /dev/null". Its hunks used to be charged
                // to the previously seen file; key them on the "--- a/" path
                // instead, so deleting a test still reports the coverage it took
                // with it rather than corrupting an unrelated file.
                const path = target === "/dev/null" ? oldPath : target.replace(/^b\\//, "");
                if (!path) { cur = null; continue; }
                cur = { path, ranges: [], deleted: [] };
                files.push(cur);
                continue;
              }
              const h = line.match(/^@@ -(\\d+)(?:,(\\d+))? \\+(\\d+)(?:,(\\d+))? @@/);
              if (h && cur) {
                const oldStart = +h[1], oldLen = h[2] === undefined ? 1 : +h[2];
                const newStart = +h[3], newLen = h[4] === undefined ? 1 : +h[4];
                if (newLen > 0) cur.ranges.push([newStart, newStart + newLen - 1]);
                if (oldLen > 0) cur.deleted.push([oldStart, oldStart + oldLen - 1]);
              }
            }
            // Statements carry no line position in the graph, so a changed spec
            // is coupled by content identity instead. Send the head text; the
            // server segments and hashes it. A deleted doc simply is not there.
            const DOC = /^(specs|adrs)\\/.*\\.md$/;
            const LIMIT = 1024 * 1024;
            const docs = []; let budget = LIMIT;
            for (const f of files) {
              if (!DOC.test(f.path)) continue;
              let content;
              try { content = fs.readFileSync(f.path, "utf8"); } catch { continue; }
              if (content.length > budget) continue;
              budget -= content.length;
              docs.push({ path: f.path, content });
            }
            fs.writeFileSync("impact-diff.json", JSON.stringify({ files, docs }));
            console.error("changed files: " + files.length + ", docs sent: " + docs.length);
          '

      - name: Query Lore impact
        id: query
        env:
          LORE_INGEST_TOKEN: \${{ secrets.LORE_INGEST_TOKEN }}
          LORE_INGEST_URL: \${{ vars.LORE_INGEST_URL || vars.LORE_API_URL }}
          COMMIT: \${{ github.event.pull_request.head.sha }}
        run: |
          BODY=$(node -e 'const d=require("./impact-diff.json"); d.commit=process.env.COMMIT; process.stdout.write(JSON.stringify(d))')
          # Capture the status separately. \`curl -sf || echo unavailable\` used to
          # render a bad token, a 404 and a real outage as the same cheerful
          # "no action needed" - a check that looks identical when broken and
          # when clean is a check nobody reads.
          CODE=$(curl -s -o impact.json -w '%{http_code}' -X POST \\
            -H "Authorization: Bearer \${LORE_INGEST_TOKEN}" \\
            -H "Content-Type: application/json" \\
            -d "$BODY" \\
            "\${LORE_INGEST_URL}/api/repos/\${{ github.repository }}/impact" || echo 000)
          echo "impact endpoint returned $CODE"
          case "$CODE" in
            2*) ;;
            401|403) REASON="Lore rejected the request ($CODE) - the LORE_INGEST_TOKEN secret is missing, expired, or lacks the write scope." ;;
            404) REASON="Lore has no impact endpoint for this repo ($CODE) - it may not be onboarded yet." ;;
            *)   REASON="Lore API unreachable (HTTP $CODE). This check could not run." ;;
          esac
          if [ -n "\${REASON:-}" ]; then
            node -e '
              const fs = require("fs");
              const reason = process.argv[1];
              fs.writeFileSync("impact.json", JSON.stringify({
                status: "unavailable", statements: [], orphaned: [], annotations: [],
                comment: "## Lore Spec Impact\\n\\n" + reason + "\\n\\n<!-- lore-trace-impact -->",
              }));
            ' "$REASON"
          fi

      - name: Render annotations + sticky comment
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const MARKER = '<!-- lore-trace-impact -->';
            let report;
            try { report = JSON.parse(fs.readFileSync('impact.json', 'utf8')); }
            catch { report = { status: 'unavailable', annotations: [], comment: '## Lore Spec Impact\\n\\nThis check produced no readable result.\\n\\n' + MARKER }; }

            const body = report.comment || ('## Lore Spec Impact\\n\\nNo spec impact.\\n\\n' + MARKER);

            // The sticky comment is the deliverable — post it first so a denied
            // checks:write scope (GITHUB_TOKEN read-only) can never suppress it.
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

            // The annotated check-run is a nice-to-have; best-effort so a 401/403
            // on checks:write logs a warning instead of failing the whole job.
            try {
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
            } catch (err) {
              core.warning('checks.create failed (' + err.status + '): grant GITHUB_TOKEN checks:write to enable inline annotations. Sticky comment was still posted.');
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
  if (content === null) {
    return "missing";
  }
  const version = parseTraceImpactWorkflowVersion(content);

  return version !== null && version >= TRACE_IMPACT_WORKFLOW_VERSION
    ? "aligned"
    : "stale";
}

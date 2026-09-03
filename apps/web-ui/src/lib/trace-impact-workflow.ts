// Mirror of libs/shared/src/trace-impact-workflow.ts (edit source first; byte-compared by parity test).
/** `lore-trace-impact.yml` workflow (sends PR diff + spec text to /impact endpoint; fails soft). */

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

      - name: Read graph baseline
        id: baseline
        env:
          LORE_INGEST_TOKEN: \${{ secrets.LORE_INGEST_TOKEN }}
          LORE_INGEST_URL: \${{ vars.LORE_INGEST_URL || vars.LORE_API_URL }}
        run: |
          # Which commit the graph's line ranges belong to. Needed BEFORE the
          # diff, because it decides which files can be compared line-for-line.
          GRAPH_COMMIT=$(curl -s -H "Authorization: Bearer \${LORE_INGEST_TOKEN}" \\
            "\${LORE_INGEST_URL}/api/repos/\${{ github.repository }}/impact/base" \\
            | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(b).graphCommit||""))}catch{process.stdout.write("")}})' || echo "")
          echo "graph_commit=$GRAPH_COMMIT" >> "$GITHUB_OUTPUT"
          echo "graph baseline: \${GRAPH_COMMIT:-<none>}"

      - name: Compute changed ranges
        id: diff
        env:
          BASE_SHA: \${{ github.event.pull_request.base.sha }}
          HEAD_SHA: \${{ github.event.pull_request.head.sha }}
          GRAPH_COMMIT: \${{ steps.baseline.outputs.graph_commit }}
        run: |
          # Diff against the MERGE BASE, not the base branch tip. base.sha is
          # whatever main pointed at when the event fired, so a two-dot diff
          # reports every commit merged to main since the branch point as a
          # reversed change of this PR - which is how a PR touching none of them
          # got 31 statements blamed on task-queue-pg.ts and friends.
          MERGE_BASE=$(git merge-base "$BASE_SHA" "$HEAD_SHA")
          export MERGE_BASE
          echo "diffing $MERGE_BASE..$HEAD_SHA"
          git diff --unified=0 "$MERGE_BASE" "$HEAD_SHA" | node -e '
            const fs = require("fs");
            const { execFileSync } = require("child_process");
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
                cur = { path, ranges: [], deleted: [], baseRanges: [] };
                files.push(cur);
                continue;
              }
              const h = line.match(/^@@ -(\\d+)(?:,(\\d+))? \\+(\\d+)(?:,(\\d+))? @@/);
              if (h && cur) {
                const oldStart = +h[1], oldLen = h[2] === undefined ? 1 : +h[2];
                const newStart = +h[3], newLen = h[4] === undefined ? 1 : +h[4];
                if (newLen > 0) cur.ranges.push([newStart, newStart + newLen - 1]);
                if (oldLen > 0) cur.deleted.push([oldStart, oldStart + oldLen - 1]);
                // baseRanges is what the graph is queried with: the OLD side of
                // EVERY hunk, including pure insertions (@@ -100,0 +101,5 @@),
                // which git reports as zero-width. Inserting inside a covered
                // region is a coupling, so straddle the insertion point.
                cur.baseRanges.push(oldLen > 0
                  ? [oldStart, oldStart + oldLen - 1]
                  : [Math.max(1, oldStart), oldStart + 1]);
              }
            }
            // A file is comparable line-for-line only if it is byte-identical at
            // the graph baseline and at the diff base. Same blob => the diff old
            // side IS graph coordinates, exactly. Different => the file moved
            // since the graph saw it and no arithmetic can honestly line them up.
            const graph = process.env.GRAPH_COMMIT || "";
            const mergeBase = process.env.MERGE_BASE || "";
            let graphUsable = false;
            if (graph) {
              // fetch-depth 0 fetches all refs, but the baseline can still be
              // unreachable (force-pushed base, fork PR). Degrade, do not error.
              try { execFileSync("git", ["cat-file", "-e", graph + "^{commit}"], { stdio: "ignore" }); graphUsable = true; }
              catch { console.error("graph baseline " + graph + " not reachable in this checkout"); }
            }
            const oidsAt = (rev) => {
              const out = {};
              if (!graphUsable || !files.length) return out;
              try {
                const raw = execFileSync("git", ["ls-tree", "-z", rev, "--"].concat(files.map((f) => f.path)), { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
                for (const entry of raw.split("\\0")) {
                  const m = entry.match(/^\\d+ \\w+ ([0-9a-f]+)\\t(.+)$/);
                  if (m) out[m[2]] = m[1];
                }
              } catch (e) { console.error("ls-tree failed for " + rev + ": " + e.message); }
              return out;
            };
            const atGraph = oidsAt(graph);
            const atBase = oidsAt(mergeBase);
            for (const f of files) {
              f.aligned = graphUsable && (atGraph[f.path] || null) === (atBase[f.path] || null);
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
          GRAPH_COMMIT: \${{ steps.baseline.outputs.graph_commit }}
        run: |
          # protocol 2 declares that this diff is merge-base-relative and carries
          # baseRanges + per-file alignment. Without it the server suppresses the
          # findings, because a protocol-1 diff cannot be trusted.
          # Write the body to a file rather than passing it as an argument.
          # docs[] carries whole spec files, and Linux caps a SINGLE argument at
          # MAX_ARG_STRLEN (128KB) regardless of the much larger total ARG_MAX —
          # three changed specs was enough for "curl: Argument list too long".
          node -e 'const fs=require("fs"); const d=require("./impact-diff.json"); d.protocol=2; d.commit=process.env.COMMIT; d.graphCommit=process.env.GRAPH_COMMIT||null; fs.writeFileSync("impact-body.json", JSON.stringify(d))'
          # Capture the status separately. \`curl -sf || echo unavailable\` used to
          # render a bad token, a 404 and a real outage as the same cheerful
          # "no action needed" - a check that looks identical when broken and
          # when clean is a check nobody reads.
          CODE=$(curl -s -o impact.json -w '%{http_code}' -X POST \\
            -H "Authorization: Bearer \${LORE_INGEST_TOKEN}" \\
            -H "Content-Type: application/json" \\
            --data-binary @impact-body.json \\
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

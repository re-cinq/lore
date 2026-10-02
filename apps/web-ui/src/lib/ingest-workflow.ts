// In-sync mirror of shared/src/ingest-workflow.ts; byte-content-identical mirror pattern.

export const LORE_INGEST_WORKFLOW_PATH = ".github/workflows/lore-ingest.yml";

export const LORE_INGEST_WORKFLOW_VERSION = 6;

// v4 (#1545): fail loudly on misconfig/4xx, warn on 5xx/network; v5: `--no-renames`, so a moved file's old path is posted as a delete and its chunks do not outlive it. v6 (#2327): the graph job posts changed specs and ADRs as a delta through `lore-code-trace docs --post` instead of asking `ingest-graph` for a pod that clones the repo.
export const LORE_INGEST_WORKFLOW_CONTENT = `# lore-ingest-version: 6
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
          # --no-renames: a moved file must arrive as its old path (a delete)
          # plus its new path, or the old path's chunks outlive the file.
          FILES=$(git diff --name-only --no-renames HEAD~1 HEAD | jq -R -s -c 'split("\\n") | map(select(. != ""))')
          echo "files=\${FILES}" >> "$GITHUB_OUTPUT"

      - name: Notify Lore to ingest
        if: steps.changes.outputs.files != '[]'
        env:
          LORE_INGEST_TOKEN: \${{ secrets.LORE_INGEST_TOKEN }}
          LORE_INGEST_URL: \${{ secrets.LORE_INGEST_URL || vars.LORE_INGEST_URL || vars.LORE_API_URL }}
          FILES: \${{ steps.changes.outputs.files }}
        run: |
          # Misconfiguration (unset URL) is a hard error - a missing var must
          # never silently fall back and report success.
          if [ -z "\${LORE_INGEST_URL}" ]; then
            echo "::error::LORE_INGEST_URL repository variable or secret is not set - context was NOT ingested"
            exit 1
          fi
          # Same class of misconfiguration: an unset token means every POST is
          # rejected with 401, which must never pass as a green run.
          if [ -z "\${LORE_INGEST_TOKEN}" ]; then
            echo "::error::LORE_INGEST_TOKEN repository secret is not set - context was NOT ingested"
            exit 1
          fi
          # The Authorization header rides in a file so the token never
          # appears on the curl command line (readable in the process table
          # for the request duration; the env var stays readable to same-uid
          # processes, so this narrows the exposure, not eliminates it).
          AUTH_FILE="$(mktemp)"
          BODY_FILE="$(mktemp)"
          trap 'rm -f "\${AUTH_FILE}" "\${BODY_FILE}"' EXIT
          printf 'Authorization: Bearer %s\\n' "\${LORE_INGEST_TOKEN}" > "\${AUTH_FILE}"
          # Capture the HTTP status instead of curl -f: a blanket warning once
          # masked a permanent 401 (unset token) as transient for a repo's
          # entire history. curl exits non-zero here only when no HTTP
          # response arrived, where -w prints 000.
          CURL_EXIT=0
          HTTP_STATUS=$(curl -s -o "\${BODY_FILE}" -w "%{http_code}" -X POST \\
            -H @"\${AUTH_FILE}" \\
            -H "Content-Type: application/json" \\
            -d "{
              \\"files\\": \${FILES},
              \\"repo\\": \\"\${{ github.repository }}\\",
              \\"commit\\": \\"\${{ github.sha }}\\"
            }" \\
            "\${LORE_INGEST_URL}/api/ingest") || CURL_EXIT=$?
          echo "Lore ingest endpoint returned HTTP \${HTTP_STATUS:-000} (curl exit \${CURL_EXIT})"
          # Prefix each body line with '| ': the runner strips leading
          # whitespace before parsing ::workflow-commands::, so only a
          # non-whitespace prefix stops a response body from forging one. The
          # echo keeps the annotations below on a fresh line even when the
          # body has no trailing newline.
          head -c 4096 "\${BODY_FILE}" | sed 's/^/| /'
          echo
          # A URL that cannot be parsed (exit 3) or resolved (exit 6) is a
          # misconfigured LORE_INGEST_URL, not a transient blip - hard-fail
          # like the unset checks above. TLS failures (exit 35/51/60) stay in
          # the warn arm below: cert rotation windows are genuinely transient.
          if [ "\${CURL_EXIT}" = "3" ] || [ "\${CURL_EXIT}" = "6" ]; then
            echo "::error::curl could not reach \${LORE_INGEST_URL} (exit \${CURL_EXIT}) - context was NOT ingested"
            exit 1
          fi
          case "\${HTTP_STATUS}" in
            2??)
              ;;
            5??|408|429|000|"")
              # Server-side trouble, throttling, or a network blip is
              # plausibly transient - warn and rely on the next doc push to
              # retry. This workflow runs on push to main and never blocks a
              # merge.
              echo "::warning::Lore ingest endpoint returned HTTP \${HTTP_STATUS:-000} (transient - next doc push retries)"
              ;;
            *)
              # Anything else (4xx auth/config, unexpected redirects) is
              # permanent - a retry will not fix it, so fail the run.
              echo "::error::Lore ingest endpoint returned HTTP \${HTTP_STATUS} - context was NOT ingested"
              exit 1
              ;;
          esac

  graph:
    runs-on: ubuntu-latest
    steps:
      # Full history: the delta is a diff against the last commit Lore
      # ingested, which a shallow clone cannot reach.
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false

      - name: Fetch lore-code-trace
        env:
          LORE_INGEST_TOKEN: \${{ secrets.LORE_INGEST_TOKEN }}
          LORE_INGEST_URL: \${{ secrets.LORE_INGEST_URL || vars.LORE_INGEST_URL || vars.LORE_API_URL }}
        run: |
          # Misconfiguration (unset URL) is a hard error - a missing var must
          # never silently fall back and report success.
          if [ -z "\${LORE_INGEST_URL}" ]; then
            echo "::error::LORE_INGEST_URL repository variable or secret is not set - specs and ADRs were NOT projected"
            exit 1
          fi
          # Same class of misconfiguration: an unset token means every POST is
          # rejected with 401, which must never pass as a green run.
          if [ -z "\${LORE_INGEST_TOKEN}" ]; then
            echo "::error::LORE_INGEST_TOKEN repository secret is not set - specs and ADRs were NOT projected"
            exit 1
          fi
          # The binary that posts the delta is served by Lore itself, so it
          # always matches the server's ingest contract. A fetch that fails is
          # plausibly transient - warn and rely on the next doc push, which
          # diffs from the last commit Lore ingested and so catches up.
          for artifact in linux-amd64 checksums.txt; do
            if ! curl -fsSL "\${LORE_INGEST_URL}/dist/lore-code-trace/\${artifact}" -o "\${artifact}"; then
              echo "::warning::lore-code-trace (\${artifact}) could not be fetched from Lore - specs and ADRs were NOT projected (transient - next doc push retries)"
              rm -f linux-amd64 checksums.txt
              exit 0
            fi
          done
          # A binary that does not match its checksum is never run, and that
          # is a failure, not a skip.
          echo "$(awk '/ linux-amd64$/{print $1}' checksums.txt)  linux-amd64" | sha256sum -c -
          mv linux-amd64 lore-code-trace
          chmod +x lore-code-trace

      # lore-code-trace posts the changed specs and ADRs, content inline, to
      # Lore, which projects them in-process: no pod clones this repository.
      - name: Project specs and ADRs into the graph
        if: hashFiles('lore-code-trace') != ''
        env:
          LORE_INGEST_TOKEN: \${{ secrets.LORE_INGEST_TOKEN }}
          LORE_API_URL: \${{ secrets.LORE_INGEST_URL || vars.LORE_INGEST_URL || vars.LORE_API_URL }}
        run: |
          # A binary older than the docs subcommand ignores the argument and
          # runs the repository's tests instead. Printing the selection proves
          # the subcommand exists before anything is posted.
          if ! ./lore-code-trace docs | grep -q '"specs"'; then
            echo "::error::the lore-code-trace Lore serves has no docs subcommand - specs and ADRs were NOT projected"
            exit 1
          fi
          ./lore-code-trace docs --post
`;

export type IngestWorkflowStatus = "missing" | "stale" | "aligned";

/** Read the `# lore-ingest-version: N` marker, or null when absent. */
export function parseIngestWorkflowVersion(content: string): number | null {
  const match = content.match(/^#\s*lore-ingest-version:\s*(\d+)/m);

  return match ? parseInt(match[1], 10) : null;
}

/** Classify installed workflow status: missing/stale/aligned. */
export function ingestWorkflowStatus(
  content: string | null,
): IngestWorkflowStatus {
  if (content === null) {
    return "missing";
  }
  const version = parseIngestWorkflowVersion(content);

  return version !== null && version >= LORE_INGEST_WORKFLOW_VERSION
    ? "aligned"
    : "stale";
}

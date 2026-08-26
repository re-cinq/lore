/**
 * Canonical source of truth for the `lore-ingest.yml` GitHub Actions
 * workflow that every onboarded repo installs. The agent's onboard
 * handler commits {@link LORE_INGEST_WORKFLOW_CONTENT}, and the web-ui
 * dashboard compares each repo's installed copy against it via
 * {@link ingestWorkflowStatus} to surface drift.
 *
 * Bump {@link LORE_INGEST_WORKFLOW_VERSION} (and the matching marker on
 * the first line of the content) whenever the workflow changes; installs
 * carrying an older marker — or none at all — report as `stale`.
 */

export const LORE_INGEST_WORKFLOW_PATH = ".github/workflows/lore-ingest.yml";

export const LORE_INGEST_WORKFLOW_VERSION = 4;

// v4 hardening (issue #1545, pattern ported from re-cinq/bowman-ui PR #37):
// the v3 curl steps ended in `|| echo ::warning`, which kept every run green
// while an unset LORE_INGEST_TOKEN 401-rejected every POST for a repo's
// entire history. v4 fails loudly on misconfiguration and 4xx, warns only on
// plausibly-transient 5xx/network trouble, and never puts the token on the
// curl command line.
export const LORE_INGEST_WORKFLOW_CONTENT = `# lore-ingest-version: 4
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
          LORE_INGEST_URL: \${{ vars.LORE_INGEST_URL || vars.LORE_API_URL }}
          FILES: \${{ steps.changes.outputs.files }}
        run: |
          # Misconfiguration (unset URL) is a hard error - a missing var must
          # never silently fall back and report success.
          if [ -z "\${LORE_INGEST_URL}" ]; then
            echo "::error::LORE_INGEST_URL repository variable is not set - context was NOT ingested"
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
              # Server-side trouble, throttling, or a network blip is plausibly
              # transient - warn,
              # and rely on the next doc push to retry. This workflow runs on
              # push to main and never blocks a merge.
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
    strategy:
      fail-fast: false
      matrix:
        kind: [specs, adrs]
    steps:
      - name: Project \${{ matrix.kind }} into the graph
        env:
          LORE_INGEST_TOKEN: \${{ secrets.LORE_INGEST_TOKEN }}
          LORE_INGEST_URL: \${{ vars.LORE_INGEST_URL || vars.LORE_API_URL }}
        run: |
          # Misconfiguration (unset URL) is a hard error - a missing var must
          # never silently fall back and report success.
          if [ -z "\${LORE_INGEST_URL}" ]; then
            echo "::error::LORE_INGEST_URL repository variable is not set - \${{ matrix.kind }} were NOT projected"
            exit 1
          fi
          # Same class of misconfiguration: an unset token means every POST is
          # rejected with 401, which must never pass as a green run.
          if [ -z "\${LORE_INGEST_TOKEN}" ]; then
            echo "::error::LORE_INGEST_TOKEN repository secret is not set - \${{ matrix.kind }} were NOT projected"
            exit 1
          fi
          # The Authorization header rides in a file so the token never
          # appears on the curl command line.
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
            -d "{\\"kinds\\":[\\"\${{ matrix.kind }}\\"],\\"commit\\":\\"\${{ github.sha }}\\"}" \\
            "\${LORE_INGEST_URL}/api/repos/\${{ github.repository }}/ingest-graph") || CURL_EXIT=$?
          echo "Lore ingest-graph endpoint returned HTTP \${HTTP_STATUS:-000} (curl exit \${CURL_EXIT})"
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
            echo "::error::curl could not reach \${LORE_INGEST_URL} (exit \${CURL_EXIT}) - \${{ matrix.kind }} were NOT projected"
            exit 1
          fi
          case "\${HTTP_STATUS}" in
            2??)
              ;;
            5??|408|429|000|"")
              # Server-side trouble, throttling, or a network blip is plausibly
              # transient - warn,
              # and rely on the next doc push to retry. This workflow runs on
              # push to main and never blocks a merge.
              echo "::warning::Lore ingest-graph endpoint returned HTTP \${HTTP_STATUS:-000} for \${{ matrix.kind }} (transient - next doc push retries)"
              ;;
            *)
              # Anything else (4xx auth/config, unexpected redirects) is
              # permanent - a retry will not fix it, so fail the run.
              echo "::error::Lore ingest-graph endpoint returned HTTP \${HTTP_STATUS} - \${{ matrix.kind }} were NOT projected"
              exit 1
              ;;
          esac
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
  if (content === null) {
    return "missing";
  }
  const version = parseIngestWorkflowVersion(content);

  return version !== null && version >= LORE_INGEST_WORKFLOW_VERSION
    ? "aligned"
    : "stale";
}

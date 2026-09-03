// Command lore-code-trace is the portable CI test-ingestion orchestrator: it reads
// a repo's .lore/test-commands.yml, runs the list + per-file run commands, and
// (with --post) sends the report to Lore's Floor ci-tests hook. It is a faithful
// port of the TS buildTestReport/run-tests CLI so any onboarded repo runs one
// blessed binary instead of drifting inlined bash.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Each chunk is POSTed separately, and every POST becomes one event, one
// assembly run and one Kubernetes pod. At 512 KB this repo's suite packed into
// 72 chunks per push to main — 72 pods and ~2,500 pod-hours a month to deliver
// a report that fits comfortably in a single request. The Floor's ingress
// accepts 25 MB bodies, so 4 MB keeps a wide margin (and stays a reasonable
// jsonb event payload) while cutting the fan-out roughly eight-fold.
//
// This is the cheap lever, not the destination: the incremental sink added in
// #1742 (POST /api/repos/{owner}/{repo}/ingest, after a GET of the repo's
// ingest-state) projects in-process with no event, no pod and no clone. Its
// client side was never wired up; until it is, this constant bounds the cost.
const (
	manifestRelPath = ".lore/test-commands.yml"
	maxChunkBytes   = 4_000_000
	runConcurrency  = 4
)

func main() {
	post := false
	for _, a := range os.Args[1:] {
		if a == "--post" {
			post = true
		}
	}
	wd, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(os.Stderr, "lore-code-trace:", err)
		os.Exit(1)
	}
	if err := run(wd, post, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "lore-code-trace:", err)
		os.Exit(1)
	}
}

func run(startDir string, post bool, stdout io.Writer) error {
	// Trust-boundary parity with the TS runner: never execute repo commands on the
	// shared server (it sets LORE_DB_HOST); only CI / local sandboxes do.
	if os.Getenv("LORE_DB_HOST") != "" {
		return fmt.Errorf("refusing to run: test commands execute only in a trusted sandbox (CI/local), not the shared server")
	}

	root, err := gitOutput(startDir, "rev-parse", "--show-toplevel")
	if err != nil {
		return fmt.Errorf("not inside a git repo: %w", err)
	}
	data, err := os.ReadFile(filepath.Join(root, manifestRelPath))
	if err != nil {
		return fmt.Errorf("reading %s: %w", manifestRelPath, err)
	}
	m, err := parseManifest(data)
	if err != nil {
		return err
	}
	commit, branch, repo, err := gitMeta(root)
	if err != nil {
		return err
	}

	ctx := context.Background()
	report, err := buildReport(ctx, m, root, reportMeta{Commit: commit, Branch: branch}, runConcurrency, os.Stderr)
	if err != nil {
		return err
	}

	if !post {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(report)
	}

	token := os.Getenv("LORE_INGEST_TOKEN")
	if token == "" {
		return fmt.Errorf("--post requires LORE_INGEST_TOKEN")
	}
	client := &http.Client{Timeout: 60 * time.Second}

	// The incremental handshake (FR5) is the primary path: lore-api projects the
	// delta in-process, so a push costs a couple of HTTP calls and no pod. Only a
	// lore-api that does not serve the route yet falls through to the chunked
	// webhook below, which fans out one pod per chunk.
	if apiBase := strings.TrimRight(os.Getenv("LORE_API_URL"), "/"); apiBase != "" {
		err := runDeltaFlow(ctx, deltaDeps{
			fetchState: func(ctx context.Context) (*string, error) {
				return fetchIngestState(ctx, apiBase, token, repo, client)
			},
			reachable:    func(sha string) bool { return commitReachable(root, sha) },
			changedSince: func(base string) ([]string, []string, error) { return changedSince(root, base) },
			post: func(ctx context.Context, d ingestDelta) error {
				return postIngestDelta(ctx, apiBase, token, repo, d, client)
			},
		}, report)
		if err == nil {
			fmt.Fprintf(os.Stderr, "lore-code-trace: posted incremental test report for %s@%s\n",
				repo, shortSHA(commit))
			return nil
		}
		if !errors.Is(err, errIngestRouteAbsent) {
			return err
		}
		fmt.Fprintln(os.Stderr, "lore-code-trace: lore-api does not serve incremental ingest yet; falling back to the chunked webhook")
	}

	base := strings.TrimRight(os.Getenv("LORE_WEBHOOK_URL"), "/")
	if base == "" {
		return fmt.Errorf("--post requires LORE_API_URL (incremental) or LORE_WEBHOOK_URL (chunked fallback)")
	}
	chunks := chunkReport(report, maxChunkBytes)
	if err := postReport(ctx, base+"/api/webhook/ci-tests", token, repo, chunks, client); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "lore-code-trace: posted %d test(s) in %d chunk(s) for %s@%s\n",
		len(report.Tests), len(chunks), repo, shortSHA(commit))
	return nil
}

func shortSHA(s string) string {
	if len(s) > 7 {
		return s[:7]
	}
	return s
}

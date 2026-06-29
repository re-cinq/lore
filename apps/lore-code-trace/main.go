// Command lore-code-trace is the portable CI test-ingestion orchestrator: it reads
// a repo's .lore/test-commands.yml, runs the list + per-file run commands, and
// (with --post) sends the report to Lore's Floor ci-tests hook. It is a faithful
// port of the TS buildTestReport/run-tests CLI so any onboarded repo runs one
// blessed binary instead of drifting inlined bash.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	manifestRelPath = ".lore/test-commands.yml"
	maxChunkBytes   = 512_000
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

	base := strings.TrimRight(os.Getenv("LORE_WEBHOOK_URL"), "/")
	token := os.Getenv("LORE_INGEST_TOKEN")
	if base == "" {
		return fmt.Errorf("--post requires LORE_WEBHOOK_URL")
	}
	if token == "" {
		return fmt.Errorf("--post requires LORE_INGEST_TOKEN")
	}
	chunks := chunkReport(report, maxChunkBytes)
	client := &http.Client{Timeout: 60 * time.Second}
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

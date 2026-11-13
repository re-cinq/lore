// Command lore-code-trace is the portable CI ingestion orchestrator. With no
// subcommand it reads a repo's .lore/test-commands.yml, runs the list + per-file
// run commands, and (with --post) sends the report to Lore; it is a faithful
// port of the TS buildTestReport/run-tests CLI so any onboarded repo runs one
// blessed binary instead of drifting inlined bash. `docs` sends the repo's
// changed specs and ADRs instead (docs_run.go).
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
)

const (
	manifestRelPath = ".lore/test-commands.yml"
	runConcurrency  = 4
)

// invocation is the command line, read once: `docs` ingests specs and ADRs,
// `links` checks their test links, and no subcommand runs the tests and ingests
// their report.
type invocation struct {
	docs  bool
	links bool
	post  bool
	force bool
	all   bool
	full  bool
	base  string
}

func parseArgs(args []string) (invocation, error) {
	parsed := invocation{}
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "docs":
			parsed.docs = true
		case "links":
			parsed.links = true
		case "--post":
			parsed.post = true
		case "--force":
			parsed.force = true
		case "--all":
			parsed.all = true
		case "--full":
			parsed.full = true
		case "--base":
			if i+1 == len(args) {
				return invocation{}, fmt.Errorf("--base needs the name of the branch the change targets")
			}
			i++
			parsed.base = args[i]
		}
	}
	return parsed, nil
}

func main() {
	wd, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(os.Stderr, "lore-code-trace:", err)
		os.Exit(exitCode(err))
	}
	parsed, err := parseArgs(os.Args[1:])
	if err == nil {
		err = dispatch(parsed, wd)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "lore-code-trace:", err)
		os.Exit(exitCode(err))
	}
}

func exitCode(err error) int {
	if errors.Is(err, errRetryExhausted) {
		return 75
	}
	return 1
}

func dispatch(parsed invocation, wd string) error {
	if parsed.docs {
		return runDocs(wd, docsOptions{post: parsed.post, force: parsed.force}, os.Stdout)
	}
	if parsed.links {
		return runLinks(wd, linksOptions{all: parsed.all, base: parsed.base}, os.Stdout)
	}
	return run(wd, parsed.post, parsed.full, os.Stdout)
}

func run(startDir string, post, full bool, stdout io.Writer) error {
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
	manifests, err := parseManifest(data)
	if err != nil {
		return err
	}
	commit, branch, repo, err := gitMeta(root)
	if err != nil {
		return err
	}

	token := os.Getenv("LORE_INGEST_TOKEN")
	if post && token == "" {
		return fmt.Errorf("--post requires LORE_INGEST_TOKEN")
	}
	// A delta is projected IN-PROCESS by lore-api before it answers — a 900 KB
	// chunk of tests plus coverage takes longer than the webhook's immediate
	// 202 — so the delta path gets a client sized for the work rather than the
	// 60 s that timed out a bootstrap full ingest on chunk 3/26.
	deltaClient := &http.Client{Timeout: deltaRequestTimeout}
	apiBase := strings.TrimRight(os.Getenv("LORE_API_URL"), "/")

	ctx := context.Background()
	ingestedBase := ""
	if post && !full && apiBase != "" {
		ingestedBase = scopeBase(ctx, root, func(ctx context.Context) (*string, error) {
			return fetchIngestState(ctx, apiBase, token, repo, testReportKind, deltaClient)
		}, os.Stderr)
	}
	combined, everyManifestNarrowed, err := buildCombinedReport(ctx, manifests, root, ingestedBase, reportMeta{Commit: commit, Branch: branch}, os.Stderr)
	if err != nil {
		return err
	}
	reportIsScoped := full || everyManifestNarrowed

	if !post {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(combined)
	}

	if apiBase == "" {
		return fmt.Errorf("--post requires LORE_API_URL")
	}
	err = runDeltaFlow(ctx, deltaDeps{
		fetchState: func(ctx context.Context) (*string, error) {
			return fetchIngestState(ctx, apiBase, token, repo, testReportKind, deltaClient)
		},
		reachable:    func(sha string) bool { return commitReachable(root, sha) },
		changedSince: func(base string) ([]string, []string, error) { return changedSince(root, base) },
		tracked:      func() ([]string, error) { return trackedFiles(root) },
		post: func(ctx context.Context, d ingestDelta) error {
			return postIngestDelta(ctx, apiBase, token, repo, d, deltaClient)
		},
		reportIsScoped: reportIsScoped,
		full:           full,
	}, combined)
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "lore-code-trace: posted incremental test report for %s@%s\n",
		repo, shortSHA(commit))
	return nil
}

// buildCombinedReport builds one report from every manifest entry that lists its
// tests. A run-whole entry has none to list, so it is skipped with a log line, and
// never run, rather than failing the report its siblings fill (#3958). Nor does it
// count when the run asks whether every entry was narrowed to the tests a change
// affects: it adds nothing to the report for the delta to filter.
func buildCombinedReport(ctx context.Context, manifests []Manifest, root, ingestedBase string, meta reportMeta, logw io.Writer) (TestReport, bool, error) {
	combined := TestReport{Commit: meta.Commit, Branch: meta.Branch, Tests: []TestDescriptor{}, Results: []TaggedRunResult{}}
	everyManifestNarrowed := true
	for _, m := range manifests {
		if m.runsWhole() {
			fmt.Fprintf(logw, "[lore-code-trace] skipping run-whole entry %q — it has no list command, so it has no tests to report\n", m.Run)
			continue
		}
		scope := scopeFor(ctx, m, root, ingestedBase, logw)
		everyManifestNarrowed = everyManifestNarrowed && !scope.all
		report, err := buildReport(ctx, m, root, meta, scope, runConcurrency, logw)
		if err != nil {
			return TestReport{}, false, err
		}
		combined.Tests = append(combined.Tests, report.Tests...)
		combined.Results = append(combined.Results, report.Results...)
	}
	return combined, everyManifestNarrowed, nil
}

func shortSHA(s string) string {
	if len(s) > 7 {
		return s[:7]
	}
	return s
}

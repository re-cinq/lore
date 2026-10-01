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

type docsOptions struct {
	post  bool
	force bool
}

// runDocs is the `docs` subcommand: one delta per doc kind, posted to lore-api.
// Without --post it prints which files each kind selects, which is how a
// repository checks its .lore/ingest.yml patterns.
func runDocs(startDir string, opts docsOptions, stdout io.Writer) error {
	root, err := gitOutput(startDir, "rev-parse", "--show-toplevel")
	if err != nil {
		return fmt.Errorf("not inside a git repo: %w", err)
	}
	patterns := ingestPatternsOf(root)
	if !opts.post {
		return printDocSelection(root, patterns, stdout)
	}

	apiBase := strings.TrimRight(os.Getenv("LORE_API_URL"), "/")
	token := os.Getenv("LORE_INGEST_TOKEN")
	if apiBase == "" || token == "" {
		return fmt.Errorf("docs --post requires LORE_API_URL and LORE_INGEST_TOKEN")
	}
	commit, _, repo, err := gitMeta(root)
	if err != nil {
		return err
	}

	ctx := context.Background()
	// A chunk is projected in-process before lore-api answers, the same reason
	// the test report's delta client waits five minutes.
	client := &http.Client{Timeout: 5 * time.Minute}
	failures := []error{}
	for _, kind := range docKinds {
		run := docsRun{kind: kind, commit: commit, patterns: patterns[kind], force: opts.force}
		if err := runDocsFlow(ctx, docsDepsFor(root, apiBase, token, repo, kind, client), run); err != nil {
			failures = append(failures, fmt.Errorf("%s: %w", kind, err))
			continue
		}
		fmt.Fprintf(os.Stderr, "lore-code-trace: posted %s for %s@%s\n", kind, repo, shortSHA(commit))
	}
	return errors.Join(failures...)
}

func docsDepsFor(root, apiBase, token, repo, kind string, client *http.Client) docsDeps {
	return docsDeps{
		fetchState: func(ctx context.Context) (*string, error) {
			return fetchIngestState(ctx, apiBase, token, repo, kind, client)
		},
		reachable:    func(sha string) bool { return commitReachable(root, sha) },
		changedSince: func(base string) ([]string, []string, error) { return changedSince(root, base) },
		tracked:      func() ([]string, error) { return trackedFiles(root) },
		read: func(path string) (string, error) {
			content, err := os.ReadFile(filepath.Join(root, path))
			return string(content), err
		},
		post: func(ctx context.Context, d docDelta) error {
			return postIngestDelta(ctx, apiBase, token, repo, d, client)
		},
	}
}

// ingestPatternsOf reads the repository's .lore/ingest.yml; an absent manifest
// is no patterns, so every kind falls back to its built-in prefixes.
func ingestPatternsOf(root string) map[string][]string {
	data, err := os.ReadFile(filepath.Join(root, ingestManifestPath))
	if err != nil {
		return map[string][]string{}
	}
	return parseIngestPatterns(data)
}

func printDocSelection(root string, patterns map[string][]string, stdout io.Writer) error {
	tracked, err := trackedFiles(root)
	if err != nil {
		return err
	}
	selection := map[string][]string{}
	for _, kind := range docKinds {
		selection[kind] = selectDocPaths(tracked, kind, patterns[kind])
	}
	enc := json.NewEncoder(stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(selection)
}

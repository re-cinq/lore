package main

import (
	"bytes"
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

type linksOptions struct {
	// Check every link in the tree instead of only what the change could break.
	all bool
	// The branch the change targets; empty falls back to GITHUB_BASE_REF.
	base string
}

// errLoreUnavailable marks a parse that failed for Lore's reasons, not the
// repository's: an outage must not block every pull request, so the check is
// skipped with a warning instead of failed.
var errLoreUnavailable = errors.New("lore-api did not answer")

// runLinks is the `links` subcommand: print one annotation per broken spec
// link and fail when there is any.
func runLinks(startDir string, opts linksOptions, stdout io.Writer) error {
	root, err := gitOutput(startDir, "rev-parse", "--show-toplevel")
	if err != nil {
		return fmt.Errorf("not inside a git repo: %w", err)
	}
	patterns, err := ingestPatternsOf(root)
	if err != nil {
		return err
	}
	apiBase := strings.TrimRight(os.Getenv("LORE_API_URL"), "/")
	token := os.Getenv("LORE_INGEST_TOKEN")
	if apiBase == "" || token == "" {
		fmt.Fprintln(stdout, "::warning::spec links were NOT checked: LORE_API_URL and LORE_INGEST_TOKEN are both required")
		return nil
	}
	scope, err := linkScopeOf(root, opts)
	if err != nil {
		return err
	}

	client := &http.Client{Timeout: 60 * time.Second}
	broken, err := checkLinks(context.Background(), linksDepsFor(root, apiBase, token, client), scope, patterns)
	if errors.Is(err, errLoreUnavailable) {
		fmt.Fprintf(stdout, "::warning::spec links were NOT checked: %v\n", err)
		return nil
	}
	if err != nil {
		return err
	}
	for _, link := range broken {
		fmt.Fprintln(stdout, link.annotation())
	}
	if len(broken) > 0 {
		return fmt.Errorf("%d broken spec link(s)", len(broken))
	}
	return nil
}

// linkScopeOf is everything when asked for, or when no base is known; otherwise
// what changed since the change left its base branch.
func linkScopeOf(root string, opts linksOptions) (linkScope, error) {
	base := opts.base
	if base == "" {
		base = os.Getenv("GITHUB_BASE_REF")
	}
	if opts.all || base == "" {
		return linkScope{everything: true}, nil
	}
	forkPoint, err := gitOutput(root, "merge-base", "origin/"+base, "HEAD")
	if err != nil {
		return linkScope{}, fmt.Errorf("cannot find where this change left origin/%s (fetch it with full history, or pass --all): %w", base, err)
	}
	changed, deleted, err := changedSince(root, forkPoint)
	if err != nil {
		return linkScope{}, err
	}
	return linkScope{touched: setOf(append(changed, deleted...)...)}, nil
}

func linksDepsFor(root, apiBase, token string, client *http.Client) linksDeps {
	return linksDeps{
		tracked: func() ([]string, error) { return trackedFiles(root) },
		read: func(path string) (string, error) {
			content, err := os.ReadFile(filepath.Join(root, path))
			return string(content), err
		},
		parse: func(ctx context.Context, docs []docFile) ([]docLink, error) {
			return parseSpecLinks(ctx, apiBase, token, docs, client)
		},
	}
}

// parseSpecLinks asks lore-api for the test links the docs carry, retrying
// what a retry can heal.
func parseSpecLinks(ctx context.Context, apiBase, token string, docs []docFile, client *http.Client) ([]docLink, error) {
	body, err := json.Marshal(map[string][]docFile{"docs": docs})
	if err != nil {
		return nil, fmt.Errorf("encoding docs: %w", err)
	}
	var links []docLink
	err = retryTransient(func() (error, bool) {
		parsed, err, retry := sendSpecLinksParse(ctx, apiBase, token, body, client)
		links = parsed
		return err, retry
	})
	return links, err
}

// sendSpecLinksParse is one attempt. A transport error, a 5xx, a 429 and a 404
// (a lore-api older than the route) are Lore's to answer for; any other 4xx is
// a misconfiguration worth failing on.
func sendSpecLinksParse(ctx context.Context, apiBase, token string, body []byte, client *http.Client) ([]docLink, error, bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiBase+"/api/spec-links/parse", bytes.NewReader(body))
	if err != nil {
		return nil, err, false
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errLoreUnavailable, err), true
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode < 300:
		var answer struct {
			Links []docLink `json:"links"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&answer); err != nil {
			return nil, fmt.Errorf("decoding spec links: %w", err), false
		}
		return answer.Links, nil, false
	case resp.StatusCode == http.StatusNotFound || retryable(resp.StatusCode):
		io.Copy(io.Discard, resp.Body)
		return nil, fmt.Errorf("%w: %s", errLoreUnavailable, resp.Status), retryable(resp.StatusCode)
	default:
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, fmt.Errorf("spec-links parse returned %s: %s", resp.Status, bytes.TrimSpace(msg)), false
	}
}

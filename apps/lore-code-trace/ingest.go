package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

// The CI half of the incremental-ingest handshake (specs/ci-incremental-ingest
// FR5): observe the last commit Lore absorbed, diff against it, post the delta
// straight to lore-api, which projects in-process — no event, no assembly run,
// no pod.

const ingestKind = "test-report"

// ingestDelta is the body of POST /api/repos/{owner}/{repo}/ingest.
// BaseCommit is the state OBSERVED, sent as an explicit null on a full ingest —
// the server CASes the pointer against it, so "absent" and "null" must not be
// confused.
type ingestDelta struct {
	Kind       string     `json:"kind"`
	Commit     string     `json:"commit"`
	BaseCommit *string    `json:"base_commit"`
	Deleted    []string   `json:"deleted,omitempty"`
	Report     TestReport `json:"report"`
}

// staleStateError is the server's 409: the pointer moved under us (a racing
// merge landed first). Current is what it moved to — the caller re-fetches and
// re-diffs against it rather than guessing.
type staleStateError struct {
	Current string
}

func (e *staleStateError) Error() string {
	return fmt.Sprintf("ingest state is stale: server is at %s", shortSHA(e.Current))
}

// errIngestRouteAbsent marks a lore-api that predates the incremental routes;
// the caller falls back to the chunked webhook rather than failing CI.
var errIngestRouteAbsent = errors.New("incremental ingest route not served by this lore-api")

func repoURL(apiBase, repo, tail string) string {
	return apiBase + "/api/repos/" + repo + tail
}

// fetchIngestState answers the last-ingested commit for this repo and kind, or
// nil when there is none — and nil, too, when the route does not exist yet: "no
// recorded state" and "no state endpoint" both mean diff against nothing.
func fetchIngestState(ctx context.Context, apiBase, token, repo string, client *http.Client) (*string, error) {
	q := url.Values{"kind": {ingestKind}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		repoURL(apiBase, repo, "/ingest-state?"+q.Encode()), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching ingest state: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		io.Copy(io.Discard, resp.Body)
		return nil, nil
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("ingest state returned %s", resp.Status)
	}
	var body struct {
		Commit *string `json:"commit"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("decoding ingest state: %w", err)
	}
	return body.Commit, nil
}

// postIngestDelta sends one delta. A 409 comes back typed so the caller can
// re-diff; a 404 comes back as errIngestRouteAbsent so it can fall back.
func postIngestDelta(ctx context.Context, apiBase, token, repo string, d ingestDelta, client *http.Client) error {
	b, err := json.Marshal(d)
	if err != nil {
		return fmt.Errorf("encoding delta: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		repoURL(apiBase, repo, "/ingest"), bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("posting delta: %w", err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode < 300:
		io.Copy(io.Discard, resp.Body)
		return nil
	case resp.StatusCode == http.StatusNotFound:
		io.Copy(io.Discard, resp.Body)
		return errIngestRouteAbsent
	case resp.StatusCode == http.StatusConflict:
		var body struct {
			Commit string `json:"commit"`
		}
		json.NewDecoder(resp.Body).Decode(&body)
		return &staleStateError{Current: body.Commit}
	default:
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("ingest returned %s: %s", resp.Status, bytes.TrimSpace(msg))
	}
}

// deltaDeps are the four things the flow reaches outside itself for, so the
// orchestration (which state, which basis, what to post, when to retry) is
// tested with plain values.
type deltaDeps struct {
	fetchState   func(context.Context) (*string, error)
	reachable    func(sha string) bool
	changedSince func(base string) (changed, deleted []string, err error)
	post         func(context.Context, ingestDelta) error
}

// runDeltaFlow is FR5 end to end. No state ⇒ full ingest against null. A state
// whose commit is UNREACHABLE (force-pushed main, over-shallow clone) ⇒ full
// CONTENT but the observed commit as base — the CAS target is what we saw, not
// what we diffed against, and null against a recorded state would 409 forever.
// Otherwise the diff decides. One 409 earns one re-fetch and re-diff; a second
// fails the step out loud.
func runDeltaFlow(ctx context.Context, deps deltaDeps, report TestReport) error {
	for attempt := 0; ; attempt++ {
		state, err := deps.fetchState(ctx)
		if err != nil {
			return err
		}
		delta := ingestDelta{Kind: ingestKind, Commit: report.Commit, BaseCommit: state, Report: report}
		if state != nil && deps.reachable(*state) {
			changed, deleted, err := deps.changedSince(*state)
			if err != nil {
				return err
			}
			delta.Report = selectDelta(report, changed)
			delta.Deleted = deleted
		}
		err = deps.post(ctx, delta)
		var stale *staleStateError
		if errors.As(err, &stale) && attempt == 0 {
			continue
		}
		return err
	}
}

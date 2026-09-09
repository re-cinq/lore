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
	"time"
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
	// The chunk envelope, set only when one body would exceed lore-api's cap:
	// every chunk CASes against the same base, and the server advances the
	// state only with the final one (seq == total).
	Seq   *int `json:"seq,omitempty"`
	Total *int `json:"total,omitempty"`
}

// deltaChunkBytes keeps each posted body under lore-api's 1 MiB payload cap
// (MAX_BODY_BYTES in build-server.ts) with headroom for the envelope fields.
// A typical delta is a handful of tests and never chunks; the full ingest that
// follows a missing or unreachable state is what this exists for.
const deltaChunkBytes = 900_000

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

// postIngestDelta sends one delta under the webhook path's retry policy: a
// transport error, a 5xx or a 429 earns another attempt with the same backoff
// (ingest is idempotent, so a re-send is always safe), while a 409 comes back
// typed at once — a lost CAS can only lose again with the same base, the flow
// re-diffs instead — and a 404 comes back as errIngestRouteAbsent so the caller
// can fall back. Any other 4xx is a real client error and aborts immediately.
//
// The bootstrap full ingests on 2026-09-03 (26-40 chunks each) died mid-sequence
// on exactly the transients this covers — a 502 during a deploy, a connection
// reset, a client timeout — and because the state advances only with the final
// chunk, each failure made the NEXT push a full ingest again.
func postIngestDelta(ctx context.Context, apiBase, token, repo string, d ingestDelta, client *http.Client) error {
	b, err := json.Marshal(d)
	if err != nil {
		return fmt.Errorf("encoding delta: %w", err)
	}
	var lastErr error
	for attempt := 1; attempt <= postAttempts; attempt++ {
		if attempt > 1 {
			failed := attempt - 1
			retrySleep(time.Duration(failed*failed) * 2 * time.Second)
		}
		err, retry := sendIngestDelta(ctx, apiBase, token, repo, b, client)
		if !retry {
			return err
		}
		lastErr = err
	}
	return fmt.Errorf("%w (after %d attempts)", lastErr, postAttempts)
}

// sendIngestDelta is one attempt. The second result says whether the failure is
// worth another try.
func sendIngestDelta(ctx context.Context, apiBase, token, repo string, body []byte, client *http.Client) (error, bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		repoURL(apiBase, repo, "/ingest"), bytes.NewReader(body))
	if err != nil {
		return err, false
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("posting delta: %w", err), true
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode < 300:
		io.Copy(io.Discard, resp.Body)
		return nil, false
	case resp.StatusCode == http.StatusNotFound:
		io.Copy(io.Discard, resp.Body)
		return errIngestRouteAbsent, false
	case resp.StatusCode == http.StatusConflict:
		var conflict struct {
			Commit string `json:"commit"`
		}
		json.NewDecoder(resp.Body).Decode(&conflict)
		return &staleStateError{Current: conflict.Commit}, false
	default:
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("ingest returned %s: %s", resp.Status, bytes.TrimSpace(msg)), retryable(resp.StatusCode)
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
	// Body budget per post; zero means deltaChunkBytes.
	maxChunkBytes int
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
		err = postDeltaChunked(ctx, deps, delta)
		var stale *staleStateError
		if errors.As(err, &stale) && attempt == 0 {
			continue
		}
		return err
	}
}

// postDeltaChunked sends a delta whole when it fits one body, and otherwise
// splits its report per descriptor into the {seq,total} envelope. Deleted
// paths ride the first chunk only — the prune is idempotent, but there is no
// reason to drive it once per chunk. Any chunk's 409 surfaces as-is so the
// flow's single re-diff applies to the whole ingest.
func postDeltaChunked(ctx context.Context, deps deltaDeps, delta ingestDelta) error {
	budget := deps.maxChunkBytes
	if budget <= 0 {
		budget = deltaChunkBytes
	}
	if jsonLen(delta) <= budget {
		return deps.post(ctx, delta)
	}
	parts := chunkReport(delta.Report, budget)
	total := len(parts)
	for i, part := range parts {
		seq := i + 1
		chunk := ingestDelta{
			Kind: delta.Kind, Commit: delta.Commit, BaseCommit: delta.BaseCommit,
			Report: part, Seq: &seq, Total: &total,
		}
		if i == 0 {
			chunk.Deleted = delta.Deleted
		}
		if err := deps.post(ctx, chunk); err != nil {
			return fmt.Errorf("chunk %d/%d: %w", seq, total, err)
		}
	}
	return nil
}

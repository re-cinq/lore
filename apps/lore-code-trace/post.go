package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// postBody is the report plus the repo slug the Floor ci-tests hook keys on
// (the embedded TestReport flattens to commit/branch/tests/results).
type postBody struct {
	Repo string `json:"repo"`
	TestReport
}

// Transient failures (transport errors, 5xx, 429) retry a few times before the
// chunk aborts the report: the Floor is a single replica, so a rollout or a
// crash-recovery window 503s the whole ingress for a minute — long enough to
// redden a push-to-main run over one blip. Ingest is idempotent (xid upserts),
// so re-sending a chunk is always safe. A 4xx is a real client error (auth,
// validation) that a retry cannot heal, so it aborts immediately.
const postAttempts = 3

// retrySleep is swapped out by tests; attempt n waits n*n*2s (2s, 8s).
var retrySleep = time.Sleep

func retryable(status int) bool {
	return status >= 500 || status == http.StatusTooManyRequests
}

// postReport sends each chunk to the ci-tests ingest URL with a bearer token.
// Any non-retryable failure aborts — a partial report is worse than a retried
// CI step.
func postReport(ctx context.Context, url, token, repo string, chunks []TestReport, client *http.Client) error {
	for i, c := range chunks {
		b, err := json.Marshal(postBody{Repo: repo, TestReport: c})
		if err != nil {
			return fmt.Errorf("encoding chunk %d: %w", i+1, err)
		}
		if err := postChunk(ctx, url, token, b, client); err != nil {
			return fmt.Errorf("chunk %d/%d: %w", i+1, len(chunks), err)
		}
	}
	return nil
}

// postChunk sends one encoded chunk, retrying transient failures. The request
// is rebuilt per attempt — its body reader is consumed by the send.
func postChunk(ctx context.Context, url, token string, body []byte, client *http.Client) error {
	var lastErr error
	for attempt := 1; attempt <= postAttempts; attempt++ {
		if attempt > 1 {
			failed := attempt - 1
			retrySleep(time.Duration(failed*failed) * 2 * time.Second)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := client.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("posting: %w", err)
			continue
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode < 300 {
			return nil
		}
		lastErr = fmt.Errorf("server returned %s", resp.Status)
		if !retryable(resp.StatusCode) {
			return lastErr
		}
	}
	return fmt.Errorf("%w (after %d attempts)", lastErr, postAttempts)
}

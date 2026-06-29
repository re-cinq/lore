package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// postBody is the report plus the repo slug the Floor ci-tests hook keys on
// (the embedded TestReport flattens to commit/branch/tests/results).
type postBody struct {
	Repo string `json:"repo"`
	TestReport
}

// postReport sends each chunk to the ci-tests ingest URL with a bearer token.
// Any non-2xx aborts — a partial report is worse than a retried CI step.
func postReport(ctx context.Context, url, token, repo string, chunks []TestReport, client *http.Client) error {
	for i, c := range chunks {
		b, err := json.Marshal(postBody{Repo: repo, TestReport: c})
		if err != nil {
			return fmt.Errorf("encoding chunk %d: %w", i+1, err)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("posting chunk %d/%d: %w", i+1, len(chunks), err)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 300 {
			return fmt.Errorf("chunk %d/%d: server returned %s", i+1, len(chunks), resp.Status)
		}
	}
	return nil
}

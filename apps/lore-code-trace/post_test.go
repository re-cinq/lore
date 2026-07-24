package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestPostReportSendsEachChunkWithAuthAndRepo(t *testing.T) {
	var bodies [][]byte
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, b)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	chunks := []TestReport{
		{Commit: "c", Branch: "b", Tests: []TestDescriptor{{ID: "a", Name: "a", File: "f"}}},
		{Commit: "c", Branch: "b", Tests: []TestDescriptor{{ID: "b", Name: "b", File: "g"}}},
	}
	if err := postReport(context.Background(), srv.URL, "tok", "o/r", chunks, srv.Client()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(bodies) != 2 {
		t.Fatalf("posts: got %d, want 2 (one per chunk)", len(bodies))
	}
	if auth != "Bearer tok" {
		t.Errorf("auth header: got %q, want %q", auth, "Bearer tok")
	}
	var got map[string]any
	if err := json.Unmarshal(bodies[0], &got); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if got["repo"] != "o/r" || got["commit"] != "c" {
		t.Errorf("body missing repo/commit: %v", got)
	}
}

func TestPostReportErrorsOnNon2xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	if err := postReport(context.Background(), srv.URL, "t", "o/r", []TestReport{{Commit: "c"}}, srv.Client()); err == nil {
		t.Fatal("expected an error when the server returns 500")
	}
}

// noSleep silences the backoff so retry tests run instantly.
func noSleep(t *testing.T) *[]time.Duration {
	t.Helper()
	var slept []time.Duration
	prev := retrySleep
	retrySleep = func(d time.Duration) { slept = append(slept, d) }
	t.Cleanup(func() { retrySleep = prev })
	return &slept
}

func TestPostReportRetriesA503ThenSucceeds(t *testing.T) {
	slept := noSleep(t)
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls <= 2 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	if err := postReport(context.Background(), srv.URL, "t", "o/r", []TestReport{{Commit: "c"}}, srv.Client()); err != nil {
		t.Fatalf("unexpected error after retries: %v", err)
	}
	if calls != 3 {
		t.Errorf("calls: got %d, want 3 (two 503s then success)", calls)
	}
	if want := []time.Duration{2 * time.Second, 8 * time.Second}; len(*slept) != 2 || (*slept)[0] != want[0] || (*slept)[1] != want[1] {
		t.Errorf("backoff: got %v, want %v", *slept, want)
	}
}

func TestPostReportGivesUpAfterThree503s(t *testing.T) {
	noSleep(t)
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	err := postReport(context.Background(), srv.URL, "t", "o/r", []TestReport{{Commit: "c"}}, srv.Client())
	if err == nil {
		t.Fatal("expected an error when every attempt returns 503")
	}
	if calls != 3 {
		t.Errorf("calls: got %d, want 3 (attempts exhausted)", calls)
	}
}

func TestPostReportDoesNotRetryA4xx(t *testing.T) {
	noSleep(t)
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	err := postReport(context.Background(), srv.URL, "t", "o/r", []TestReport{{Commit: "c"}}, srv.Client())
	if err == nil {
		t.Fatal("expected an error on 401")
	}
	if calls != 1 {
		t.Errorf("calls: got %d, want 1 (4xx must not retry)", calls)
	}
}

func TestPostReportResendsTheFullBodyOnRetry(t *testing.T) {
	noSleep(t)
	var bodies [][]byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, b)
		if len(bodies) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	chunks := []TestReport{{Commit: "c", Tests: []TestDescriptor{{ID: "a", Name: "a", File: "f"}}}}
	if err := postReport(context.Background(), srv.URL, "t", "o/r", chunks, srv.Client()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(bodies) != 2 || len(bodies[1]) == 0 || string(bodies[0]) != string(bodies[1]) {
		t.Errorf("retry body must equal the original (got %d bytes then %d)", len(bodies[0]), len(bodies[1]))
	}
}

package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
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

package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestFetchIngestStateReturnsTheStoredCommit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("kind"); got != "test-report" {
			t.Errorf("kind = %q", got)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer tok" {
			t.Errorf("auth = %q", got)
		}
		if r.URL.Path != "/api/repos/re-cinq/lore/ingest-state" {
			t.Errorf("path = %q", r.URL.Path)
		}
		json.NewEncoder(w).Encode(map[string]any{"kind": "test-report", "commit": "deadbeef"})
	}))
	defer srv.Close()

	got, err := fetchIngestState(context.Background(), srv.URL, "tok", "re-cinq/lore", srv.Client())
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if got == nil || *got != "deadbeef" {
		t.Fatalf("commit = %v, want deadbeef", got)
	}
}

func TestFetchIngestStateReadsNullAsNoState(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"kind": "test-report", "commit": nil})
	}))
	defer srv.Close()

	got, err := fetchIngestState(context.Background(), srv.URL, "tok", "re-cinq/lore", srv.Client())
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if got != nil {
		t.Fatalf("commit = %v, want nil (full ingest)", *got)
	}
}

func TestFetchIngestStateTreatsAMissingRouteAsNoState(t *testing.T) {
	// A lore-api that predates the incremental routes must degrade to a full
	// ingest, not fail the CI step.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer srv.Close()

	got, err := fetchIngestState(context.Background(), srv.URL, "tok", "re-cinq/lore", srv.Client())
	if err != nil {
		t.Fatalf("a 404 must not fail the caller, got %v", err)
	}
	if got != nil {
		t.Fatalf("commit = %v, want nil", *got)
	}
}

func TestPostIngestDeltaSendsTheObservedBaseAndReport(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/repos/re-cinq/lore/ingest" {
			t.Errorf("path = %q", r.URL.Path)
		}
		raw, _ := io.ReadAll(r.Body)
		json.Unmarshal(raw, &body)
		json.NewEncoder(w).Encode(map[string]any{"state": "advanced"})
	}))
	defer srv.Close()

	base := "cafe1234"
	err := postIngestDelta(context.Background(), srv.URL, "tok", "re-cinq/lore",
		ingestDelta{Kind: "test-report", Commit: "abc123", BaseCommit: &base,
			Report: report(), Deleted: []string{"src/gone.test.ts"}}, srv.Client())
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if body["kind"] != "test-report" || body["commit"] != "abc123" || body["base_commit"] != "cafe1234" {
		t.Fatalf("body = %v", body)
	}
	if deleted, _ := body["deleted"].([]any); len(deleted) != 1 || deleted[0] != "src/gone.test.ts" {
		t.Fatalf("deleted = %v", body["deleted"])
	}
	if _, ok := body["report"].(map[string]any); !ok {
		t.Fatalf("report missing from body: %v", body)
	}
}

func TestPostIngestDeltaSendsNullBaseForAFullIngest(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		json.Unmarshal(raw, &body)
		json.NewEncoder(w).Encode(map[string]any{"state": "advanced"})
	}))
	defer srv.Close()

	if err := postIngestDelta(context.Background(), srv.URL, "tok", "re-cinq/lore",
		ingestDelta{Kind: "test-report", Commit: "abc123", Report: report()}, srv.Client()); err != nil {
		t.Fatalf("err = %v", err)
	}
	if v, present := body["base_commit"]; !present || v != nil {
		t.Fatalf("base_commit = %v (present %v), want explicit null", v, present)
	}
}

func TestPostIngestDeltaReportsAStaleBaseAsConflict(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]any{"error": "stale base", "commit": "newer99"})
	}))
	defer srv.Close()

	err := postIngestDelta(context.Background(), srv.URL, "tok", "re-cinq/lore",
		ingestDelta{Kind: "test-report", Commit: "abc123", Report: report()}, srv.Client())

	conflict, ok := err.(*staleStateError)
	if !ok {
		t.Fatalf("err = %v (%T), want *staleStateError", err, err)
	}
	if conflict.Current != "newer99" {
		t.Fatalf("current = %q, want newer99 — the caller re-diffs against it", conflict.Current)
	}
}

// flowDeps builds deltaDeps from plain values so the orchestration is tested on
// its own: which state it observes, what it diffs, and what it posts.
type recordedPost struct {
	delta ingestDelta
}

func flowDeps(states []*string, reachable bool, changed, deleted []string, responses []error) (deltaDeps, *[]recordedPost) {
	posts := &[]recordedPost{}
	fetches, sends := 0, 0
	return deltaDeps{
		fetchState: func(context.Context) (*string, error) {
			s := states[min(fetches, len(states)-1)]
			fetches++
			return s, nil
		},
		reachable: func(string) bool { return reachable },
		changedSince: func(string) ([]string, []string, error) {
			return changed, deleted, nil
		},
		post: func(_ context.Context, d ingestDelta) error {
			*posts = append(*posts, recordedPost{delta: d})
			err := responses[min(sends, len(responses)-1)]
			sends++
			return err
		},
	}, posts
}

func TestDeltaFlowPostsAFullIngestWithNullBaseWhenNoStateIsRecorded(t *testing.T) {
	deps, posts := flowDeps([]*string{nil}, false, nil, nil, []error{nil})

	if err := runDeltaFlow(context.Background(), deps, report()); err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(*posts) != 1 {
		t.Fatalf("posts = %d, want 1", len(*posts))
	}
	got := (*posts)[0].delta
	if got.BaseCommit != nil {
		t.Fatalf("base_commit = %v, want nil", *got.BaseCommit)
	}
	if len(got.Report.Tests) != 3 {
		t.Fatalf("a full ingest sends every test, got %d", len(got.Report.Tests))
	}
}

func TestDeltaFlowSendsFullContentButObservedBaseWhenTheBaseIsUnreachable(t *testing.T) {
	// Force-pushed main or an over-shallow clone: the diff basis is gone, but the
	// CAS target is the state we OBSERVED — posting null against a recorded state
	// would 409 on every retry forever.
	base := "gone1234"
	deps, posts := flowDeps([]*string{&base}, false, nil, nil, []error{nil})

	if err := runDeltaFlow(context.Background(), deps, report()); err != nil {
		t.Fatalf("err = %v", err)
	}
	got := (*posts)[0].delta
	if got.BaseCommit == nil || *got.BaseCommit != "gone1234" {
		t.Fatalf("base_commit = %v, want the observed gone1234", got.BaseCommit)
	}
	if len(got.Report.Tests) != 3 {
		t.Fatalf("unreachable base must send full content, got %d tests", len(got.Report.Tests))
	}
}

func TestDeltaFlowDiffsAgainstAReachableBaseAndSendsOnlyTheDelta(t *testing.T) {
	base := "base1234"
	deps, posts := flowDeps([]*string{&base}, true,
		[]string{"src/b.test.ts"}, []string{"src/gone.test.ts"}, []error{nil})

	if err := runDeltaFlow(context.Background(), deps, report()); err != nil {
		t.Fatalf("err = %v", err)
	}
	got := (*posts)[0].delta
	if want := []string{"t2"}; !reflect.DeepEqual(ids(got.Report.Tests), want) {
		t.Fatalf("tests = %v, want %v", ids(got.Report.Tests), want)
	}
	if !reflect.DeepEqual(got.Deleted, []string{"src/gone.test.ts"}) {
		t.Fatalf("deleted = %v", got.Deleted)
	}
	if got.BaseCommit == nil || *got.BaseCommit != "base1234" {
		t.Fatalf("base_commit = %v", got.BaseCommit)
	}
}

func TestDeltaFlowRefetchesAndRediffsOnceOnAStaleBase(t *testing.T) {
	// Two merges landing together: the first POST loses the CAS with a 409 that
	// names the current commit; the runner re-fetches, re-diffs and posts again.
	first, second := "old11111", "new22222"
	deps, posts := flowDeps([]*string{&first, &second}, true,
		[]string{"src/b.test.ts"}, nil,
		[]error{&staleStateError{Current: second}, nil})

	if err := runDeltaFlow(context.Background(), deps, report()); err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(*posts) != 2 {
		t.Fatalf("posts = %d, want 2 (one retry)", len(*posts))
	}
	if b := (*posts)[1].delta.BaseCommit; b == nil || *b != "new22222" {
		t.Fatalf("retry base = %v, want the re-fetched new22222", b)
	}
}

func TestDeltaFlowGivesUpLoudlyAfterASecondStaleBase(t *testing.T) {
	s := "s1"
	deps, posts := flowDeps([]*string{&s}, true, nil, nil,
		[]error{&staleStateError{Current: "x"}, &staleStateError{Current: "y"}})

	err := runDeltaFlow(context.Background(), deps, report())
	if err == nil {
		t.Fatal("a second 409 must fail the step, not loop")
	}
	if len(*posts) != 2 {
		t.Fatalf("posts = %d, want exactly 2", len(*posts))
	}
}

func TestPostIngestDeltaSerializesTheChunkEnvelopeOnlyWhenSet(t *testing.T) {
	var bodies []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b map[string]any
		raw, _ := io.ReadAll(r.Body)
		json.Unmarshal(raw, &b)
		bodies = append(bodies, b)
		json.NewEncoder(w).Encode(map[string]any{"state": "pending-chunks"})
	}))
	defer srv.Close()

	seq, total := 2, 5
	_ = postIngestDelta(context.Background(), srv.URL, "tok", "re-cinq/lore",
		ingestDelta{Kind: "test-report", Commit: "abc123", Report: report(), Seq: &seq, Total: &total}, srv.Client())
	_ = postIngestDelta(context.Background(), srv.URL, "tok", "re-cinq/lore",
		ingestDelta{Kind: "test-report", Commit: "abc123", Report: report()}, srv.Client())

	if bodies[0]["seq"] != float64(2) || bodies[0]["total"] != float64(5) {
		t.Fatalf("chunked body = %v", bodies[0])
	}
	if _, has := bodies[1]["seq"]; has {
		t.Fatalf("an unchunked delta must not carry seq: %v", bodies[1])
	}
}

func TestDeltaFlowChunksAnOversizeIngestUnderTheBodyCap(t *testing.T) {
	// lore-api caps a body at 1 MB; a full ingest (~26 MB on this repo) rides the
	// server's {seq,total} envelope — every chunk CASes against the same base,
	// the state advances only with the final one, and the deleted paths go once.
	deps, posts := flowDeps([]*string{nil}, false, nil, []string{"src/gone.test.ts"}, []error{nil})
	deps.maxChunkBytes = 200 // three descriptors will not fit one 200-byte body

	if err := runDeltaFlow(context.Background(), deps, report()); err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(*posts) < 2 {
		t.Fatalf("an oversize ingest must be chunked, got %d post(s)", len(*posts))
	}
	total := len(*posts)
	seen := 0
	for i, p := range *posts {
		d := p.delta
		if d.Seq == nil || d.Total == nil || *d.Seq != i+1 || *d.Total != total {
			t.Fatalf("chunk %d envelope = seq %v total %v, want %d/%d", i, d.Seq, d.Total, i+1, total)
		}
		if d.BaseCommit != nil {
			t.Fatalf("every chunk must carry the observed base (nil here), got %v", *d.BaseCommit)
		}
		seen += len(d.Report.Tests)
	}
	if seen != 3 {
		t.Fatalf("chunks must partition every test exactly once, saw %d", seen)
	}
}

func TestDeltaFlowSendsASmallDeltaAsOneUnchunkedBody(t *testing.T) {
	base := "base1234"
	deps, posts := flowDeps([]*string{&base}, true, []string{"src/b.test.ts"}, nil, []error{nil})
	deps.maxChunkBytes = 900_000

	if err := runDeltaFlow(context.Background(), deps, report()); err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(*posts) != 1 || (*posts)[0].delta.Seq != nil {
		t.Fatalf("a delta under the cap must be one unchunked post, got %d post(s), seq %v",
			len(*posts), (*posts)[0].delta.Seq)
	}
}

func noRetrySleep(t *testing.T) {
	t.Helper()
	prev := retrySleep
	retrySleep = func(time.Duration) {}
	t.Cleanup(func() { retrySleep = prev })
}

func deltaTo(srv *httptest.Server) error {
	return postIngestDelta(context.Background(), srv.URL, "tok", "re-cinq/lore",
		ingestDelta{Kind: "test-report", Commit: "abc123", Report: report()}, srv.Client())
}

func TestPostIngestDeltaRetriesA5xxAndThenSucceeds(t *testing.T) {
	// The bootstrap full ingest on 2026-09-03 died on chunk 13/40 with a 502
	// during a deploy: one transient answer, no retry, and the state never
	// advanced — so the NEXT push was a full ingest again. Same policy as the
	// webhook path: a 5xx earns another attempt, and ingest is idempotent.
	noRetrySleep(t)
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls == 1 {
			http.Error(w, "<html>bad gateway</html>", http.StatusBadGateway)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"state": "advanced"})
	}))
	defer srv.Close()

	if err := deltaTo(srv); err != nil {
		t.Fatalf("err = %v, want success after a retry", err)
	}
	if calls != 2 {
		t.Fatalf("calls = %d, want 2", calls)
	}
}

func TestPostIngestDeltaRetriesATransportErrorAndThenSucceeds(t *testing.T) {
	// chunk 28/40 on 2026-09-03: "read: connection reset by peer".
	noRetrySleep(t)
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls == 1 {
			conn, _, _ := w.(http.Hijacker).Hijack()
			conn.Close()
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"state": "advanced"})
	}))
	defer srv.Close()

	if err := deltaTo(srv); err != nil {
		t.Fatalf("err = %v, want success after a retry", err)
	}
	if calls != 2 {
		t.Fatalf("calls = %d, want 2", calls)
	}
}

func TestPostIngestDeltaGivesUpAfterTheAttemptBudget(t *testing.T) {
	noRetrySleep(t)
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		http.Error(w, "still down", http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	err := deltaTo(srv)
	if err == nil || !strings.Contains(err.Error(), "after 3 attempts") {
		t.Fatalf("err = %v, want the exhausted-budget error", err)
	}
	if calls != postAttempts {
		t.Fatalf("calls = %d, want %d", calls, postAttempts)
	}
}

func TestPostIngestDeltaNeverRetriesAConflictOrAClientError(t *testing.T) {
	// A 409 is a lost CAS — re-sending the same base can only lose again; the
	// flow re-diffs instead. A 400 is a real client error a retry cannot heal.
	noRetrySleep(t)
	for _, tc := range []struct {
		status int
		body   string
	}{
		{http.StatusConflict, `{"error":"stale","commit":"newer99"}`},
		{http.StatusBadRequest, `{"error":"unknown kind"}`},
	} {
		calls := 0
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			calls++
			w.WriteHeader(tc.status)
			io.WriteString(w, tc.body)
		}))
		err := deltaTo(srv)
		srv.Close()
		if err == nil {
			t.Fatalf("status %d: expected an error", tc.status)
		}
		if calls != 1 {
			t.Fatalf("status %d: calls = %d, want exactly 1 (no retry)", tc.status, calls)
		}
		if _, isStale := err.(*staleStateError); tc.status == http.StatusConflict && !isStale {
			t.Fatalf("409 must surface as *staleStateError, got %T", err)
		}
	}
}

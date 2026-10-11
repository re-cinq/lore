package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// linksRepo is docsRepo plus a test file of three lines, with origin/main
// pointing at that first commit so later commits are "the change".
func linksRepo(t *testing.T) string {
	t.Helper()
	dir := docsRepo(t)
	writeFile(t, dir, "apps/x/a.test.ts", "one\ntwo\nthree\n")
	gitRun(t, dir, "add", "-A")
	gitRun(t, dir, "commit", "-q", "-m", "test file")
	gitRun(t, dir, "update-ref", "refs/remotes/origin/main", "HEAD")
	return dir
}

// parseServer answers every parse request with the given links and records the
// doc paths it was sent.
func parseServer(t *testing.T, status int, links []docLink) *[]string {
	t.Helper()
	return parseServerAnswering(t, []int{status}, links)
}

// parseServerAnswering walks the given statuses one per request, repeating the
// last one once they run out, so a test can let an attempt recover.
func parseServerAnswering(t *testing.T, statuses []int, links []docLink) *[]string {
	t.Helper()
	sent := &[]string{}
	attempt := &atomic.Int64{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/spec-links/parse" || r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("unexpected %s %s with %q", r.Method, r.URL.Path, r.Header.Get("Authorization"))
		}
		var body struct {
			Docs []docFile `json:"docs"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		*sent = append(*sent, pathsOf(body.Docs)...)
		nth := int(attempt.Add(1)) - 1
		w.WriteHeader(statuses[min(nth, len(statuses)-1)])
		json.NewEncoder(w).Encode(map[string]any{"links": links})
	}))
	t.Cleanup(srv.Close)
	t.Setenv("LORE_API_URL", srv.URL)
	t.Setenv("LORE_INGEST_TOKEN", "tok")
	return sent
}

func TestRunLinksFailsWithAnAnnotationForALinkPastTheEndOfItsFile(t *testing.T) {
	dir := linksRepo(t)
	parseServer(t, http.StatusOK, []docLink{
		{DocPath: "specs/a/spec.md", StatementLine: intPtr(1), Path: "apps/x/a.test.ts", Line: intPtr(9)},
	})

	var out bytes.Buffer
	err := runLinks(dir, linksOptions{all: true}, &out)

	if err == nil || !strings.Contains(err.Error(), "1 broken spec link") {
		t.Fatalf("err = %v, want it to count 1 broken spec link", err)
	}
	want := "::error file=specs/a/spec.md,line=1::broken spec link: apps/x/a.test.ts#L9 is past the end of the file (3 lines)\n"
	if out.String() != want {
		t.Errorf("output = %q, want %q", out.String(), want)
	}
}

func TestRunLinksPassesWhenEveryLinkHolds(t *testing.T) {
	dir := linksRepo(t)
	parseServer(t, http.StatusOK, []docLink{
		{DocPath: "specs/a/spec.md", StatementLine: intPtr(1), Path: "apps/x/a.test.ts", Line: intPtr(3)},
	})

	var out bytes.Buffer
	if err := runLinks(dir, linksOptions{all: true}, &out); err != nil {
		t.Fatalf("runLinks: %v", err)
	}
	if out.Len() != 0 {
		t.Errorf("output = %q, want none", out.String())
	}
}

func TestRunLinksAgainstABaseSendsOnlyTheDocsTheChangeCouldBreak(t *testing.T) {
	dir := linksRepo(t)
	writeFile(t, dir, "specs/b/spec.md", "# Spec B\n")
	gitRun(t, dir, "add", "-A")
	gitRun(t, dir, "commit", "-q", "-m", "a second spec")
	sent := parseServer(t, http.StatusOK, nil)

	var out bytes.Buffer
	if err := runLinks(dir, linksOptions{base: "main"}, &out); err != nil {
		t.Fatalf("runLinks: %v", err)
	}

	if len(*sent) != 1 || (*sent)[0] != "specs/b/spec.md" {
		t.Errorf("sent = %v, want only the spec the change added", *sent)
	}
}

func TestRunLinksAgainstABaseReportsASpecWhoseTestFileTheChangeDeleted(t *testing.T) {
	dir := linksRepo(t)
	writeFile(t, dir, "specs/a/spec.md", "# Spec A\n\n- Claims. ([validated by claims](apps/x/a.test.ts#L2))\n")
	gitRun(t, dir, "add", "-A")
	gitRun(t, dir, "commit", "-q", "-m", "link it")
	gitRun(t, dir, "update-ref", "refs/remotes/origin/main", "HEAD")
	gitRun(t, dir, "rm", "-q", "apps/x/a.test.ts")
	gitRun(t, dir, "commit", "-q", "-m", "delete the test")
	parseServer(t, http.StatusOK, []docLink{
		{DocPath: "specs/a/spec.md", StatementLine: intPtr(3), Path: "apps/x/a.test.ts", Line: intPtr(2)},
	})

	var out bytes.Buffer
	err := runLinks(dir, linksOptions{base: "main"}, &out)

	if err == nil || !strings.Contains(out.String(), "specs/a/spec.md,line=3::broken spec link: apps/x/a.test.ts does not exist") {
		t.Fatalf("err = %v, output = %q, want the deleted test file reported on the spec", err, out.String())
	}
}

func TestRunLinksWarnsAndPassesWhenLoreIsUnreachable(t *testing.T) {
	noRetrySleep(t)
	dir := linksRepo(t)
	parseServer(t, http.StatusServiceUnavailable, nil)

	var out bytes.Buffer
	if err := runLinks(dir, linksOptions{all: true}, &out); err != nil {
		t.Fatalf("runLinks: %v, want a Lore outage not to fail the check", err)
	}
	if !strings.HasPrefix(out.String(), "::warning::") {
		t.Errorf("output = %q, want a warning that the check was skipped", out.String())
	}
}

func TestRunLinksWarnsAndPassesWithoutAToken(t *testing.T) {
	dir := linksRepo(t)
	t.Setenv("LORE_API_URL", "https://lore.example.test")
	t.Setenv("LORE_INGEST_TOKEN", "")

	var out bytes.Buffer
	if err := runLinks(dir, linksOptions{all: true}, &out); err != nil {
		t.Fatalf("runLinks: %v", err)
	}
	if !strings.Contains(out.String(), "::warning::") || !strings.Contains(out.String(), "LORE_INGEST_TOKEN") {
		t.Errorf("output = %q, want a warning naming LORE_INGEST_TOKEN", out.String())
	}
}

func TestRunLinksWarnsAndPassesWhenTheTokenKeepsBeingRefusedForScope(t *testing.T) {
	noRetrySleep(t)
	dir := linksRepo(t)
	parseServerAnswering(t, []int{http.StatusForbidden}, nil)

	var out bytes.Buffer
	if err := runLinks(dir, linksOptions{all: true}, &out); err != nil {
		t.Fatalf("runLinks: %v, want a standing 403 to warn rather than fail the check", err)
	}
	if !strings.HasPrefix(out.String(), "::warning::") || !strings.Contains(out.String(), "403") {
		t.Errorf("output = %q, want a warning naming the 403", out.String())
	}
}

func TestRunLinksChecksTheLinksWhenA403GivesWayToAnAnswer(t *testing.T) {
	noRetrySleep(t)
	dir := linksRepo(t)
	parseServerAnswering(t, []int{http.StatusForbidden, http.StatusOK}, []docLink{
		{DocPath: "specs/a/spec.md", StatementLine: intPtr(1), Path: "apps/x/a.test.ts", Line: intPtr(9)},
	})

	var out bytes.Buffer
	err := runLinks(dir, linksOptions{all: true}, &out)

	if err == nil || !strings.Contains(err.Error(), "1 broken spec link") {
		t.Fatalf("err = %v, output = %q, want the retry to reach the real answer", err, out.String())
	}
}

func TestRunLinksFailsWhenLoreRefusesTheToken(t *testing.T) {
	dir := linksRepo(t)
	parseServer(t, http.StatusUnauthorized, nil)

	var out bytes.Buffer
	err := runLinks(dir, linksOptions{all: true}, &out)

	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("err = %v, want the 401 surfaced", err)
	}
}

func TestRunLinksFailsWhenTheBaseCannotBeFound(t *testing.T) {
	dir := linksRepo(t)
	parseServer(t, http.StatusOK, nil)

	var out bytes.Buffer
	err := runLinks(dir, linksOptions{base: "no-such-branch"}, &out)

	if err == nil || !strings.Contains(err.Error(), "no-such-branch") {
		t.Fatalf("err = %v, want it to name the missing base", err)
	}
}

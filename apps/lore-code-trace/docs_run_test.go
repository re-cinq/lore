package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// docsRepo is a real git repository holding one spec, one ADR and a file of
// neither kind, with origin o/r.
func docsRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	gitRun(t, dir, "init", "-q")
	gitRun(t, dir, "config", "user.email", "t@t.com")
	gitRun(t, dir, "config", "user.name", "t")
	gitRun(t, dir, "remote", "add", "origin", "git@github.com:o/r.git")
	writeFile(t, dir, "specs/a/spec.md", "# Spec A\n")
	writeFile(t, dir, "adrs/ADR-001.md", "# ADR 1\n")
	writeFile(t, dir, "README.md", "# Readme\n")
	gitRun(t, dir, "add", "-A")
	gitRun(t, dir, "commit", "-q", "-m", "init")
	return dir
}

func writeFile(t *testing.T, dir, rel, content string) {
	t.Helper()
	full := filepath.Join(dir, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func headOf(t *testing.T, dir string) string {
	t.Helper()
	sha, err := gitOutput(dir, "rev-parse", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	return sha
}

// ingestServer answers ingest-state with the given commit for every kind and
// records each posted delta.
func ingestServer(t *testing.T, state *string) (*httptest.Server, *[]docDelta) {
	t.Helper()
	posts := &[]docDelta{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("authorization = %q, want Bearer tok", r.Header.Get("Authorization"))
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/repos/o/r/ingest-state":
			json.NewEncoder(w).Encode(map[string]any{"kind": r.URL.Query().Get("kind"), "commit": state})
		case r.Method == http.MethodPost && r.URL.Path == "/api/repos/o/r/ingest":
			body, _ := io.ReadAll(r.Body)
			var delta docDelta
			if err := json.Unmarshal(body, &delta); err != nil {
				t.Errorf("posted body is not a doc delta: %v", err)
			}
			*posts = append(*posts, delta)
			w.Write([]byte(`{}`))
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	t.Setenv("LORE_API_URL", srv.URL)
	t.Setenv("LORE_INGEST_TOKEN", "tok")
	return srv, posts
}

func deltaOfKind(t *testing.T, posts []docDelta, kind string) docDelta {
	t.Helper()
	for _, delta := range posts {
		if delta.Kind == kind {
			return delta
		}
	}
	t.Fatalf("no %s delta among %d posts", kind, len(posts))
	return docDelta{}
}

func TestRunDocsPostsEverySpecAndADRWhenLoreHoldsNoState(t *testing.T) {
	dir := docsRepo(t)
	_, posts := ingestServer(t, nil)

	if err := runDocs(dir, docsOptions{post: true}, io.Discard); err != nil {
		t.Fatalf("runDocs: %v", err)
	}

	if len(*posts) != 2 {
		t.Fatalf("posts = %d, want one per kind", len(*posts))
	}
	specs := deltaOfKind(t, *posts, "specs")
	wantSpecs := []docFile{{Path: "specs/a/spec.md", Content: "# Spec A\n"}}
	if !reflect.DeepEqual(specs.Files, wantSpecs) || specs.BaseCommit != nil || specs.Commit != headOf(t, dir) {
		t.Errorf("specs delta = %+v, want %v at HEAD with a null base", specs, wantSpecs)
	}
	adrs := deltaOfKind(t, *posts, "adrs")
	wantADRs := []docFile{{Path: "adrs/ADR-001.md", Content: "# ADR 1\n"}}
	if !reflect.DeepEqual(adrs.Files, wantADRs) {
		t.Errorf("adrs files = %v, want %v", adrs.Files, wantADRs)
	}
}

func TestRunDocsPostsOnlyWhatChangedSinceTheStoredCommit(t *testing.T) {
	dir := docsRepo(t)
	base := headOf(t, dir)
	writeFile(t, dir, "specs/a/spec.md", "# Spec A, revised\n")
	writeFile(t, dir, "specs/b/spec.md", "# Spec B\n")
	gitRun(t, dir, "rm", "-q", "adrs/ADR-001.md")
	gitRun(t, dir, "add", "-A")
	gitRun(t, dir, "commit", "-q", "-m", "second")
	_, posts := ingestServer(t, &base)

	if err := runDocs(dir, docsOptions{post: true}, io.Discard); err != nil {
		t.Fatalf("runDocs: %v", err)
	}

	specs := deltaOfKind(t, *posts, "specs")
	wantSpecs := []docFile{
		{Path: "specs/a/spec.md", Content: "# Spec A, revised\n"},
		{Path: "specs/b/spec.md", Content: "# Spec B\n"},
	}
	if !reflect.DeepEqual(specs.Files, wantSpecs) || specs.BaseCommit == nil || *specs.BaseCommit != base {
		t.Errorf("specs delta = %+v, want %v against %s", specs, wantSpecs, base)
	}
	adrs := deltaOfKind(t, *posts, "adrs")
	if len(adrs.Files) != 0 || !reflect.DeepEqual(adrs.Deleted, []string{"adrs/ADR-001.md"}) {
		t.Errorf("adrs delta = %+v, want no files and adrs/ADR-001.md deleted", adrs)
	}
}

func TestRunDocsSelectsByTheRepositorysIngestManifest(t *testing.T) {
	dir := docsRepo(t)
	writeFile(t, dir, "docs/decisions/0001.md", "# Decision 1\n")
	writeFile(t, dir, ".lore/ingest.yml", "adrs:\n  - \"docs/decisions/*.md\"\n")
	gitRun(t, dir, "add", "-A")
	gitRun(t, dir, "commit", "-q", "-m", "manifest")
	_, posts := ingestServer(t, nil)

	if err := runDocs(dir, docsOptions{post: true}, io.Discard); err != nil {
		t.Fatalf("runDocs: %v", err)
	}

	adrs := deltaOfKind(t, *posts, "adrs")
	want := []docFile{{Path: "docs/decisions/0001.md", Content: "# Decision 1\n"}}
	if !reflect.DeepEqual(adrs.Files, want) {
		t.Errorf("adrs files = %v, want %v", adrs.Files, want)
	}
}

func TestRunDocsWithoutPostPrintsTheSelectionAndCallsNothing(t *testing.T) {
	dir := docsRepo(t)

	var out bytes.Buffer
	if err := runDocs(dir, docsOptions{}, &out); err != nil {
		t.Fatalf("runDocs: %v", err)
	}

	var selection map[string][]string
	if err := json.Unmarshal(out.Bytes(), &selection); err != nil {
		t.Fatalf("output is not a selection: %v\n%s", err, out.String())
	}
	want := map[string][]string{"specs": {"specs/a/spec.md"}, "adrs": {"adrs/ADR-001.md"}}
	if !reflect.DeepEqual(selection, want) {
		t.Errorf("selection = %v, want %v", selection, want)
	}
}

func TestRunDocsPostRequiresTheAPIURLAndToken(t *testing.T) {
	dir := docsRepo(t)
	t.Setenv("LORE_API_URL", "")
	t.Setenv("LORE_INGEST_TOKEN", "")

	err := runDocs(dir, docsOptions{post: true}, io.Discard)

	if err == nil || !strings.Contains(err.Error(), "LORE_API_URL") {
		t.Fatalf("err = %v, want it to name LORE_API_URL", err)
	}
}

func TestRunDocsReportsAFailedKindAndStillPostsTheOther(t *testing.T) {
	dir := docsRepo(t)
	kinds := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			json.NewEncoder(w).Encode(map[string]any{"commit": nil})
			return
		}
		var delta docDelta
		json.NewDecoder(r.Body).Decode(&delta)
		kinds = append(kinds, delta.Kind)
		if delta.Kind == "specs" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	t.Setenv("LORE_API_URL", srv.URL)
	t.Setenv("LORE_INGEST_TOKEN", "tok")

	err := runDocs(dir, docsOptions{post: true}, io.Discard)

	if err == nil || !strings.Contains(err.Error(), "specs") {
		t.Fatalf("err = %v, want it to name the specs kind", err)
	}
	if !reflect.DeepEqual(kinds, []string{"specs", "adrs"}) {
		t.Errorf("posted kinds = %v, want specs then adrs", kinds)
	}
}

func TestParseArgsReadsTheDocsSubcommandAndItsFlags(t *testing.T) {
	cases := []struct {
		args []string
		want invocation
	}{
		{[]string{}, invocation{}},
		{[]string{"--post"}, invocation{post: true}},
		{[]string{"docs"}, invocation{docs: true}},
		{[]string{"docs", "--post", "--force"}, invocation{docs: true, post: true, force: true}},
	}
	for _, c := range cases {
		if got := parseArgs(c.args); got != c.want {
			t.Errorf("parseArgs(%v) = %+v, want %+v", c.args, got, c.want)
		}
	}
}

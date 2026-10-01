package main

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestSelectDocPathsUsesTheKindPrefixesAndMarkdownOnly(t *testing.T) {
	tree := []string{
		"specs/a/spec.md",
		"specs/a/diagram.png",
		".specify/memory/constitution.md",
		"adrs/ADR-001.md",
		"docs/guide.md",
	}

	specs := selectDocPaths(tree, "specs", nil)
	adrs := selectDocPaths(tree, "adrs", nil)

	if want := []string{"specs/a/spec.md", ".specify/memory/constitution.md"}; !reflect.DeepEqual(specs, want) {
		t.Errorf("specs = %v, want %v", specs, want)
	}
	if want := []string{"adrs/ADR-001.md"}; !reflect.DeepEqual(adrs, want) {
		t.Errorf("adrs = %v, want %v", adrs, want)
	}
}

func TestSelectDocPathsLetsDeclaredPatternsReplaceThePrefixes(t *testing.T) {
	tree := []string{"adrs/ADR-001.md", "docs/decisions/0001.md", "docs/guide.md"}

	got := selectDocPaths(tree, "adrs", []string{"docs/decisions/*.md"})

	if want := []string{"docs/decisions/0001.md"}; !reflect.DeepEqual(got, want) {
		t.Errorf("adrs = %v, want %v", got, want)
	}
}

func TestParseIngestPatternsReadsGlobListsPerKind(t *testing.T) {
	manifest := "specs:\n  - \"specs/**/*.md\"\nadrs:\n  - \"docs/decisions/*.md\"\nnotes: not-a-list\n"

	got := parseIngestPatterns([]byte(manifest))

	want := map[string][]string{
		"specs": {"specs/**/*.md"},
		"adrs":  {"docs/decisions/*.md"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("patterns = %v, want %v", got, want)
	}
}

func TestParseIngestPatternsReadsAnUnparseableManifestAsNoPatterns(t *testing.T) {
	if got := parseIngestPatterns([]byte("specs: [unclosed")); len(got) != 0 {
		t.Errorf("patterns = %v, want none", got)
	}
}

// docsFixture is a repository as the docs flow sees it: what is tracked, what
// each file holds, and what the diff against the observed base says.
type docsFixture struct {
	states    []*string
	reachable bool
	changed   []string
	deleted   []string
	tracked   []string
	responses []error
	maxBytes  int
}

func (f docsFixture) deps() (docsDeps, *[]docDelta) {
	posts := &[]docDelta{}
	fetches, sends := 0, 0
	responses := f.responses
	if len(responses) == 0 {
		responses = []error{nil}
	}
	return docsDeps{
		fetchState: func(context.Context) (*string, error) {
			s := f.states[min(fetches, len(f.states)-1)]
			fetches++
			return s, nil
		},
		reachable: func(string) bool { return f.reachable },
		changedSince: func(string) ([]string, []string, error) {
			return f.changed, f.deleted, nil
		},
		tracked: func() ([]string, error) { return f.tracked, nil },
		read:    func(path string) (string, error) { return "content of " + path, nil },
		post: func(_ context.Context, d docDelta) error {
			*posts = append(*posts, d)
			err := responses[min(sends, len(responses)-1)]
			sends++
			return err
		},
		maxChunkBytes: f.maxBytes,
	}, posts
}

var specsRun = docsRun{kind: "specs", commit: "head5678"}

func pathsOf(files []docFile) []string {
	paths := []string{}
	for _, file := range files {
		paths = append(paths, file.Path)
	}
	return paths
}

func TestDocsFlowPostsEveryTrackedSpecWithNullBaseWhenNoStateIsRecorded(t *testing.T) {
	deps, posts := docsFixture{
		states:  []*string{nil},
		tracked: []string{"specs/a/spec.md", "specs/b/spec.md", "adrs/ADR-001.md", "README.md"},
	}.deps()

	if err := runDocsFlow(context.Background(), deps, specsRun); err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(*posts) != 1 {
		t.Fatalf("posts = %d, want 1", len(*posts))
	}
	got := (*posts)[0]
	if got.Kind != "specs" || got.Commit != "head5678" || got.BaseCommit != nil {
		t.Errorf("envelope = %s@%s base %v, want specs@head5678 base nil", got.Kind, got.Commit, got.BaseCommit)
	}
	wantPaths := []string{"specs/a/spec.md", "specs/b/spec.md"}
	if !reflect.DeepEqual(pathsOf(got.Files), wantPaths) {
		t.Errorf("files = %v, want %v", pathsOf(got.Files), wantPaths)
	}
	if got.Files[0].Content != "content of specs/a/spec.md" {
		t.Errorf("content = %q, want the file's content inline", got.Files[0].Content)
	}
	if !reflect.DeepEqual(got.Present, wantPaths) {
		t.Errorf("present = %v, want every spec the tree holds so the server can prune the rest", got.Present)
	}
}

func TestDocsFlowSendsOnlyChangedAndDeletedSpecsAgainstAReachableBase(t *testing.T) {
	base := "base1234"
	deps, posts := docsFixture{
		states:    []*string{&base},
		reachable: true,
		changed:   []string{"specs/a/spec.md", "apps/x.ts", "adrs/ADR-002.md"},
		deleted:   []string{"specs/old/spec.md", "apps/gone.ts"},
		tracked:   []string{"specs/a/spec.md", "specs/b/spec.md"},
	}.deps()

	if err := runDocsFlow(context.Background(), deps, specsRun); err != nil {
		t.Fatalf("err = %v", err)
	}
	got := (*posts)[0]
	if got.BaseCommit == nil || *got.BaseCommit != "base1234" {
		t.Errorf("base_commit = %v, want base1234", got.BaseCommit)
	}
	if want := []string{"specs/a/spec.md"}; !reflect.DeepEqual(pathsOf(got.Files), want) {
		t.Errorf("files = %v, want %v", pathsOf(got.Files), want)
	}
	if want := []string{"specs/old/spec.md"}; !reflect.DeepEqual(got.Deleted, want) {
		t.Errorf("deleted = %v, want %v", got.Deleted, want)
	}
	if got.Present != nil {
		t.Errorf("present = %v, want none on a diffed delta", got.Present)
	}
}

func TestDocsFlowPostsAnEmptyDeltaWhenNoSpecChangedSoTheStateStillAdvances(t *testing.T) {
	base := "base1234"
	deps, posts := docsFixture{
		states:    []*string{&base},
		reachable: true,
		changed:   []string{"apps/x.ts"},
	}.deps()

	if err := runDocsFlow(context.Background(), deps, specsRun); err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(*posts) != 1 || len((*posts)[0].Files) != 0 {
		t.Fatalf("posts = %+v, want one delta with no files", *posts)
	}
}

func TestDocsFlowSendsFullContentButObservedBaseWhenTheBaseIsUnreachable(t *testing.T) {
	base := "gone1234"
	deps, posts := docsFixture{
		states:  []*string{&base},
		tracked: []string{"specs/a/spec.md", "specs/b/spec.md"},
	}.deps()

	if err := runDocsFlow(context.Background(), deps, specsRun); err != nil {
		t.Fatalf("err = %v", err)
	}
	got := (*posts)[0]
	if got.BaseCommit == nil || *got.BaseCommit != "gone1234" {
		t.Errorf("base_commit = %v, want the observed gone1234", got.BaseCommit)
	}
	if len(got.Files) != 2 || len(got.Present) != 2 {
		t.Errorf("files = %d, present = %d, want 2 and 2", len(got.Files), len(got.Present))
	}
}

func TestDocsFlowSendsEverySpecWhenTheIngestManifestChanged(t *testing.T) {
	// New patterns redefine which files ARE specs, so a diff of file contents
	// cannot say what entered or left the kind.
	base := "base1234"
	deps, posts := docsFixture{
		states:    []*string{&base},
		reachable: true,
		changed:   []string{".lore/ingest.yml"},
		tracked:   []string{"specs/a/spec.md", "specs/b/spec.md"},
	}.deps()

	if err := runDocsFlow(context.Background(), deps, specsRun); err != nil {
		t.Fatalf("err = %v", err)
	}
	if got := (*posts)[0]; len(got.Files) != 2 || len(got.Present) != 2 {
		t.Errorf("files = %d, present = %d, want 2 and 2", len(got.Files), len(got.Present))
	}
}

func TestDocsFlowForcesEverySpecAndSaysSo(t *testing.T) {
	base := "base1234"
	deps, posts := docsFixture{
		states:    []*string{&base},
		reachable: true,
		tracked:   []string{"specs/a/spec.md", "specs/b/spec.md"},
	}.deps()

	run := docsRun{kind: "specs", commit: "head5678", force: true}
	if err := runDocsFlow(context.Background(), deps, run); err != nil {
		t.Fatalf("err = %v", err)
	}
	got := (*posts)[0]
	if !got.Force || len(got.Files) != 2 {
		t.Errorf("force = %v, files = %d, want true and 2", got.Force, len(got.Files))
	}
}

func TestDocsFlowSelectsByTheDeclaredPatterns(t *testing.T) {
	deps, posts := docsFixture{
		states:  []*string{nil},
		tracked: []string{"adrs/ADR-001.md", "docs/decisions/0001.md"},
	}.deps()

	run := docsRun{kind: "adrs", commit: "head5678", patterns: []string{"docs/decisions/*.md"}}
	if err := runDocsFlow(context.Background(), deps, run); err != nil {
		t.Fatalf("err = %v", err)
	}
	if want := []string{"docs/decisions/0001.md"}; !reflect.DeepEqual(pathsOf((*posts)[0].Files), want) {
		t.Errorf("files = %v, want %v", pathsOf((*posts)[0].Files), want)
	}
}

func TestDocsFlowChunksAnOversizeIngestAndPrunesOnlyWithTheLastChunk(t *testing.T) {
	tracked := []string{}
	for i := 0; i < 6; i++ {
		tracked = append(tracked, fmt.Sprintf("specs/%d/spec.md", i))
	}
	base := "gone1234"
	deps, posts := docsFixture{
		states:   []*string{&base},
		tracked:  tracked,
		deleted:  nil,
		maxBytes: 150,
	}.deps()

	if err := runDocsFlow(context.Background(), deps, specsRun); err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(*posts) < 2 {
		t.Fatalf("posts = %d, want the ingest split into several chunks", len(*posts))
	}
	sent := []string{}
	for i, chunk := range *posts {
		if chunk.Seq == nil || chunk.Total == nil || *chunk.Seq != i+1 || *chunk.Total != len(*posts) {
			t.Fatalf("chunk %d envelope = %v/%v, want %d/%d", i, chunk.Seq, chunk.Total, i+1, len(*posts))
		}
		if chunk.BaseCommit == nil || *chunk.BaseCommit != "gone1234" {
			t.Errorf("chunk %d base = %v, want every chunk to CAS against gone1234", i, chunk.BaseCommit)
		}
		isLast := i == len(*posts)-1
		if (chunk.Present != nil) != isLast {
			t.Errorf("chunk %d present = %v, want it only on the last chunk", i, chunk.Present)
		}
		sent = append(sent, pathsOf(chunk.Files)...)
	}
	if !reflect.DeepEqual(sent, tracked) {
		t.Errorf("files across chunks = %v, want %v", sent, tracked)
	}
}

func TestDocsFlowSendsDeletedPathsWithTheFirstChunkOnly(t *testing.T) {
	base := "base1234"
	deps, posts := docsFixture{
		states:    []*string{&base},
		reachable: true,
		changed:   []string{"specs/0/spec.md", "specs/1/spec.md", "specs/2/spec.md", "specs/3/spec.md"},
		deleted:   []string{"specs/old/spec.md"},
		maxBytes:  150,
	}.deps()

	if err := runDocsFlow(context.Background(), deps, specsRun); err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(*posts) < 2 {
		t.Fatalf("posts = %d, want several chunks", len(*posts))
	}
	if want := []string{"specs/old/spec.md"}; !reflect.DeepEqual((*posts)[0].Deleted, want) {
		t.Errorf("first chunk deleted = %v, want %v", (*posts)[0].Deleted, want)
	}
	for i, chunk := range (*posts)[1:] {
		if chunk.Deleted != nil {
			t.Errorf("chunk %d deleted = %v, want none after the first", i+1, chunk.Deleted)
		}
	}
}

func TestDocsFlowRefetchesAndRediffsOnceOnAStaleBase(t *testing.T) {
	first, second := "base1111", "base2222"
	deps, posts := docsFixture{
		states:    []*string{&first, &second},
		reachable: true,
		changed:   []string{"specs/a/spec.md"},
		responses: []error{&staleStateError{Current: second}, nil},
	}.deps()

	if err := runDocsFlow(context.Background(), deps, specsRun); err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(*posts) != 2 || *(*posts)[1].BaseCommit != "base2222" {
		t.Fatalf("posts = %+v, want a second post against base2222", *posts)
	}
}

func TestDocsFlowGivesUpLoudlyAfterASecondStaleBase(t *testing.T) {
	base := "base1111"
	deps, _ := docsFixture{
		states:    []*string{&base},
		reachable: true,
		responses: []error{&staleStateError{Current: "moved"}},
	}.deps()

	err := runDocsFlow(context.Background(), deps, specsRun)

	if err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("err = %v, want the stale-state error", err)
	}
}

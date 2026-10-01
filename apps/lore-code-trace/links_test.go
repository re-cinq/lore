package main

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func intPtr(n int) *int { return &n }

func TestCountLinesCountsATrailingLineWithoutNewline(t *testing.T) {
	cases := map[string]int{"": 0, "a\n": 1, "a\nb\n": 2, "a\nb": 2}
	for content, want := range cases {
		if got := countLines(content); got != want {
			t.Errorf("countLines(%q) = %d, want %d", content, got, want)
		}
	}
}

func TestDocsToCheckKeepsChangedDocsAndDocsNamingAChangedFile(t *testing.T) {
	contents := map[string]string{
		"specs/a/spec.md": "links to apps/x/a.test.ts",
		"specs/b/spec.md": "links to apps/x/b.test.ts",
		"specs/c/spec.md": "links to nothing that moved",
	}
	scope := linkScope{touched: setOf("specs/c/spec.md", "apps/x/a.test.ts")}

	got := docsToCheck([]string{"specs/a/spec.md", "specs/b/spec.md", "specs/c/spec.md"}, contents, scope)

	if want := []string{"specs/a/spec.md", "specs/c/spec.md"}; !reflect.DeepEqual(got, want) {
		t.Errorf("docs = %v, want %v", got, want)
	}
}

func TestDocsToCheckKeepsEveryDocWhenTheScopeIsEverything(t *testing.T) {
	docs := []string{"specs/a/spec.md", "specs/b/spec.md"}

	got := docsToCheck(docs, map[string]string{}, linkScope{everything: true})

	if !reflect.DeepEqual(got, docs) {
		t.Errorf("docs = %v, want %v", got, docs)
	}
}

// treeOf is a checkout as the link judge sees it: path to line count.
func treeOf(files map[string]int) func(string) (int, bool) {
	return func(path string) (int, bool) {
		lines, tracked := files[path]
		return lines, tracked
	}
}

func TestBrokenLinksReportsAMissingFile(t *testing.T) {
	links := []docLink{{DocPath: "specs/a/spec.md", StatementLine: intPtr(3), Path: "apps/x/gone.test.ts", Line: intPtr(12)}}

	got := brokenLinks(links, treeOf(map[string]int{}), linkScope{everything: true})

	want := []brokenLink{{doc: "specs/a/spec.md", line: 3, reason: "apps/x/gone.test.ts does not exist"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("broken = %+v, want %+v", got, want)
	}
}

func TestBrokenLinksReportsALinePastTheEndOfTheFile(t *testing.T) {
	links := []docLink{{DocPath: "specs/a/spec.md", StatementLine: intPtr(3), Path: "apps/x/a.test.ts", Line: intPtr(41)}}

	got := brokenLinks(links, treeOf(map[string]int{"apps/x/a.test.ts": 40}), linkScope{everything: true})

	want := []brokenLink{{doc: "specs/a/spec.md", line: 3, reason: "apps/x/a.test.ts#L41 is past the end of the file (40 lines)"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("broken = %+v, want %+v", got, want)
	}
}

func TestBrokenLinksReportsAMisplacedLink(t *testing.T) {
	links := []docLink{{DocPath: "specs/a/spec.md", StatementLine: intPtr(3), Path: "apps/x/a.test.ts", Line: intPtr(4), Misplaced: true}}

	got := brokenLinks(links, treeOf(map[string]int{"apps/x/a.test.ts": 40}), linkScope{everything: true})

	if len(got) != 1 || !strings.Contains(got[0].reason, "end of its statement") {
		t.Errorf("broken = %+v, want the misplaced link reported", got)
	}
}

func TestBrokenLinksAcceptsALinkInsideTheFileAndALinkWithNoLine(t *testing.T) {
	links := []docLink{
		{DocPath: "specs/a/spec.md", Path: "apps/x/a.test.ts", Line: intPtr(40)},
		{DocPath: "specs/a/spec.md", Path: "apps/x/a.test.ts"},
	}

	got := brokenLinks(links, treeOf(map[string]int{"apps/x/a.test.ts": 40}), linkScope{everything: true})

	if len(got) != 0 {
		t.Errorf("broken = %+v, want none", got)
	}
}

func TestBrokenLinksLeavesAnUntouchedDocsOldRotOutOfAScopedCheck(t *testing.T) {
	// specs/b was sent only because it names a file this change touched; its
	// link to a file nobody touched was already broken and is not this change's.
	links := []docLink{
		{DocPath: "specs/b/spec.md", StatementLine: intPtr(5), Path: "apps/x/moved.test.ts", Line: intPtr(9)},
		{DocPath: "specs/b/spec.md", StatementLine: intPtr(7), Path: "apps/x/old-rot.test.ts", Line: intPtr(1)},
		{DocPath: "specs/a/spec.md", StatementLine: intPtr(2), Path: "apps/x/old-rot.test.ts", Line: intPtr(1)},
	}
	scope := linkScope{touched: setOf("apps/x/moved.test.ts", "specs/a/spec.md")}

	got := brokenLinks(links, treeOf(map[string]int{}), scope)

	want := []brokenLink{
		{doc: "specs/b/spec.md", line: 5, reason: "apps/x/moved.test.ts does not exist"},
		{doc: "specs/a/spec.md", line: 2, reason: "apps/x/old-rot.test.ts does not exist"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("broken = %+v, want %+v", got, want)
	}
}

func TestAnnotationNamesTheDocAndLine(t *testing.T) {
	got := brokenLink{doc: "specs/a/spec.md", line: 3, reason: "apps/x/gone.test.ts does not exist"}.annotation()

	want := "::error file=specs/a/spec.md,line=3::broken spec link: apps/x/gone.test.ts does not exist"
	if got != want {
		t.Errorf("annotation = %q, want %q", got, want)
	}
}

func TestAnnotationOmitsTheLineWhenTheStatementHasNone(t *testing.T) {
	got := brokenLink{doc: "specs/a/spec.md", reason: "apps/x/gone.test.ts does not exist"}.annotation()

	if want := "::error file=specs/a/spec.md::broken spec link: apps/x/gone.test.ts does not exist"; got != want {
		t.Errorf("annotation = %q, want %q", got, want)
	}
}

func linksFixture(parsed []docLink, parseErr error) (linksDeps, *[][]docFile) {
	sent := &[][]docFile{}
	return linksDeps{
		tracked: func() ([]string, error) {
			return []string{"specs/a/spec.md", "specs/b/spec.md", "apps/x/a.test.ts"}, nil
		},
		read: func(path string) (string, error) { return "one\ntwo\n", nil },
		parse: func(_ context.Context, docs []docFile) ([]docLink, error) {
			*sent = append(*sent, docs)
			return parsed, parseErr
		},
	}, sent
}

func TestCheckLinksSendsEverySpecAndReturnsTheBrokenOnes(t *testing.T) {
	deps, sent := linksFixture([]docLink{
		{DocPath: "specs/a/spec.md", StatementLine: intPtr(1), Path: "apps/x/a.test.ts", Line: intPtr(2)},
		{DocPath: "specs/b/spec.md", StatementLine: intPtr(1), Path: "apps/x/a.test.ts", Line: intPtr(3)},
	}, nil)

	broken, err := checkLinks(context.Background(), deps, linkScope{everything: true}, map[string][]string{})

	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(*sent) != 1 || !reflect.DeepEqual(pathsOf((*sent)[0]), []string{"specs/a/spec.md", "specs/b/spec.md"}) {
		t.Errorf("sent = %+v, want both specs in one request", *sent)
	}
	want := []brokenLink{{doc: "specs/b/spec.md", line: 1, reason: "apps/x/a.test.ts#L3 is past the end of the file (2 lines)"}}
	if !reflect.DeepEqual(broken, want) {
		t.Errorf("broken = %+v, want %+v", broken, want)
	}
}

func TestCheckLinksSendsNothingWhenNoDocIsInScope(t *testing.T) {
	deps, sent := linksFixture(nil, nil)

	broken, err := checkLinks(context.Background(), deps, linkScope{touched: setOf("README.md")}, map[string][]string{})

	if err != nil || len(broken) != 0 || len(*sent) != 0 {
		t.Errorf("broken = %v, err = %v, requests = %d, want nothing sent and nothing broken", broken, err, len(*sent))
	}
}

func TestCheckLinksReturnsTheParseFailure(t *testing.T) {
	deps, _ := linksFixture(nil, errors.New("lore-api is down"))

	_, err := checkLinks(context.Background(), deps, linkScope{everything: true}, map[string][]string{})

	if err == nil || !strings.Contains(err.Error(), "lore-api is down") {
		t.Fatalf("err = %v, want the parse failure", err)
	}
}

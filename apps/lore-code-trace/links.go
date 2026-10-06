package main

import (
	"context"
	"fmt"
	"path"
	"strings"
)

// The spec-link check (specs/spec-test-coverage): every test link a spec or
// ADR carries must point at a file the checkout holds and a line inside it.
// lore-api parses the links, so one parser decides what a link is; this binary
// judges them against the tree it is run in.

// docLink is one test link as POST /api/spec-links/parse answers it.
type docLink struct {
	DocPath       string `json:"doc_path"`
	StatementLine *int   `json:"statement_line"`
	Label         string `json:"label"`
	Path          string `json:"path"`
	Line          *int   `json:"line"`
	Misplaced     bool   `json:"misplaced"`
}

type brokenLink struct {
	doc string
	// Line of the statement carrying the link; zero when unknown.
	line   int
	reason string
}

// annotation is the GitHub Actions error line, which also reads fine in a
// terminal.
func (b brokenLink) annotation() string {
	location := "file=" + b.doc
	if b.line > 0 {
		location += fmt.Sprintf(",line=%d", b.line)
	}
	return fmt.Sprintf("::error %s::broken spec link: %s", location, b.reason)
}

// linkScope is what one check answers for: every link in the tree, or only
// the links a change could have broken. touched holds every path the change
// added, modified or deleted.
type linkScope struct {
	everything bool
	touched    map[string]struct{}
}

func (s linkScope) touches(path string) bool {
	_, ok := s.touched[path]
	return ok
}

// covers reports whether a link is this check's to judge: any link of a doc the
// change touched, and any link pointing at a file it touched. The rest was
// broken before the change and is not a reason to fail it.
func (s linkScope) covers(link docLink) bool {
	return s.everything || s.touches(link.DocPath) || s.touches(link.Path)
}

func setOf(paths ...string) map[string]struct{} {
	set := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		set[path] = struct{}{}
	}
	return set
}

type linksDeps struct {
	tracked func() ([]string, error)
	read    func(path string) (string, error)
	parse   func(context.Context, []docFile) ([]docLink, error)
	// Body budget per parse request; zero means docChunkBytes.
	maxChunkBytes int
}

// checkLinks answers the broken links in scope. patterns are the repository's
// .lore/ingest.yml globs per doc kind.
func checkLinks(ctx context.Context, deps linksDeps, scope linkScope, patterns map[string][]string) ([]brokenLink, error) {
	tracked, err := deps.tracked()
	if err != nil {
		return nil, err
	}
	docs, err := readDocFiles(deps.read, docPathsOf(tracked, patterns))
	if err != nil {
		return nil, err
	}
	links, err := parseInChunks(ctx, deps, docsInScope(docs, scope))
	if err != nil {
		return nil, err
	}
	return brokenLinks(links, lineCounter(tracked, deps.read), scope), nil
}

func docPathsOf(tracked []string, patterns map[string][]string) []string {
	paths := []string{}
	for _, kind := range docKinds {
		paths = append(paths, selectDocPaths(tracked, kind, patterns[kind])...)
	}
	return paths
}

func docsInScope(docs []docFile, scope linkScope) []docFile {
	contents := make(map[string]string, len(docs))
	for _, doc := range docs {
		contents[doc.Path] = doc.Content
	}
	kept := setOf(docsToCheck(pathsOfDocs(docs), contents, scope)...)
	inScope := []docFile{}
	for _, doc := range docs {
		if _, ok := kept[doc.Path]; ok {
			inScope = append(inScope, doc)
		}
	}
	return inScope
}

func pathsOfDocs(docs []docFile) []string {
	paths := make([]string, 0, len(docs))
	for _, doc := range docs {
		paths = append(paths, doc.Path)
	}
	return paths
}

// docsToCheck keeps the docs a scoped check has to parse: the ones the change
// touched, and the ones whose text names a file it touched. This is only a
// pre-filter that saves parsing every doc: scope.covers judges each link by its
// resolved path afterwards. It matches on the file NAME because a `../` href is
// relative to the doc, so the doc's text need not hold the repo-root path; a
// name that matches too much costs one extra doc parsed, never a missed link.
func docsToCheck(docs []string, contents map[string]string, scope linkScope) []string {
	if scope.everything {
		return docs
	}
	names := fileNamesOf(scope.touched)
	kept := []string{}
	for _, doc := range docs {
		if scope.touches(doc) || containsAny(contents[doc], names) {
			kept = append(kept, doc)
		}
	}
	return kept
}

func fileNamesOf(paths map[string]struct{}) []string {
	names := make([]string, 0, len(paths))
	for touched := range paths {
		names = append(names, path.Base(touched))
	}
	return names
}

func containsAny(content string, names []string) bool {
	for _, name := range names {
		if strings.Contains(content, name) {
			return true
		}
	}
	return false
}

func parseInChunks(ctx context.Context, deps linksDeps, docs []docFile) ([]docLink, error) {
	if len(docs) == 0 {
		return nil, nil
	}
	budget := deps.maxChunkBytes
	if budget <= 0 {
		budget = docChunkBytes
	}
	links := []docLink{}
	for _, chunk := range chunkDocFiles(docs, budget) {
		parsed, err := deps.parse(ctx, chunk)
		if err != nil {
			return nil, err
		}
		links = append(links, parsed...)
	}
	return links, nil
}

// lineCounter answers a tracked file's line count, reading each file once.
func lineCounter(tracked []string, read func(string) (string, error)) func(string) (int, bool) {
	trackedSet := setOf(tracked...)
	counts := map[string]int{}
	return func(path string) (int, bool) {
		if _, ok := trackedSet[path]; !ok {
			return 0, false
		}
		if lines, ok := counts[path]; ok {
			return lines, true
		}
		content, err := read(path)
		if err != nil {
			return 0, false
		}
		counts[path] = countLines(content)
		return counts[path], true
	}
}

func countLines(content string) int {
	lines := strings.Count(content, "\n")
	if content != "" && !strings.HasSuffix(content, "\n") {
		lines++
	}
	return lines
}

func brokenLinks(links []docLink, linesOf func(string) (int, bool), scope linkScope) []brokenLink {
	broken := []brokenLink{}
	for _, link := range links {
		reason := breakageOf(link, linesOf)
		if reason == "" || !scope.covers(link) {
			continue
		}
		broken = append(broken, brokenLink{doc: link.DocPath, line: valueOf(link.StatementLine), reason: reason})
	}
	return broken
}

// breakageOf says why a link is broken, or "" when it holds.
func breakageOf(link docLink, linesOf func(string) (int, bool)) string {
	lines, tracked := linesOf(link.Path)
	if !tracked {
		return link.Path + " does not exist"
	}
	if link.Line != nil && (*link.Line < 1 || *link.Line > lines) {
		return fmt.Sprintf("%s#L%d is past the end of the file (%d lines)", link.Path, *link.Line, lines)
	}
	if link.Misplaced {
		return fmt.Sprintf("the link to %s must sit at the end of its statement, or it validates nothing", link.Path)
	}
	return ""
}

func valueOf(n *int) int {
	if n == nil {
		return 0
	}
	return *n
}

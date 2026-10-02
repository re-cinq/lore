package main

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"
)

// Spec and ADR ingest from CI (specs/ci-incremental-ingest FR8): the same
// handshake the test report uses, with the changed files' content inline, so
// lore-api projects them in-process and no pod has to clone the repository.

const (
	ingestManifestPath = ".lore/ingest.yml"
	// Each chunk is projected before lore-api answers, so a chunk is sized for
	// the projection time of the specs it carries rather than for the 1 MiB body
	// cap: a quarter megabyte is about fifteen specs.
	docChunkBytes = 250_000
)

var docKinds = []string{"specs", "adrs"}

// The built-in homes of each kind, mirroring INGEST_KINDS in
// ingest-graph-registry.ts; a kind declared in .lore/ingest.yml replaces them.
var docKindPrefixes = map[string][]string{
	"specs": {"specs/", ".specify/"},
	"adrs":  {"adrs/"},
}

type docFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// docDelta is the doc-kind body of POST /api/repos/{owner}/{repo}/ingest.
type docDelta struct {
	Kind       string    `json:"kind"`
	Commit     string    `json:"commit"`
	BaseCommit *string   `json:"base_commit"`
	Files      []docFile `json:"files"`
	Deleted    []string  `json:"deleted,omitempty"`
	// Every path of the kind the tree holds, sent with the last chunk of a full
	// ingest: with no diff to name what went away, the server prunes whatever
	// the graph holds beyond this list.
	Present []string `json:"present,omitempty"`
	Force   bool     `json:"force,omitempty"`
	Seq     *int     `json:"seq,omitempty"`
	Total   *int     `json:"total,omitempty"`
}

type docsDeps struct {
	fetchState   func(context.Context) (*string, error)
	reachable    func(sha string) bool
	changedSince func(base string) (changed, deleted []string, err error)
	tracked      func() ([]string, error)
	read         func(path string) (string, error)
	post         func(context.Context, docDelta) error
	// Body budget per post; zero means docChunkBytes.
	maxChunkBytes int
}

type docsRun struct {
	kind     string
	commit   string
	patterns []string
	// Re-project every file even when its content hash is unchanged (after a
	// parser or segmenter change).
	force bool
}

// docScope is what one delta covers. present is set only when the scope is the
// whole kind rather than a diff.
type docScope struct {
	paths   []string
	deleted []string
	present []string
}

func runDocsFlow(ctx context.Context, deps docsDeps, run docsRun) error {
	return retryOnceOnStale(func() error {
		state, err := deps.fetchState(ctx)
		if err != nil {
			return err
		}
		scope, err := scopeOfDocs(deps, run, state)
		if err != nil {
			return err
		}
		files, err := readDocFiles(deps.read, scope.paths)
		if err != nil {
			return err
		}
		envelope := docDelta{Kind: run.kind, Commit: run.commit, BaseCommit: state, Force: run.force}
		return postDocChunks(ctx, deps, envelope, scope, files)
	})
}

func scopeOfDocs(deps docsDeps, run docsRun, state *string) (docScope, error) {
	diffed, err := diffedScope(deps, run, state)
	if err != nil || diffed != nil {
		return valueOrZero(diffed), err
	}
	tracked, err := deps.tracked()
	if err != nil {
		return docScope{}, err
	}
	all := selectDocPaths(tracked, run.kind, run.patterns)
	return docScope{paths: all, present: all}, nil
}

// diffedScope answers nil when a diff cannot describe the delta: a forced run,
// no recorded state, a base this checkout cannot reach, or an ingest manifest
// that changed — new patterns redefine which files belong to the kind.
func diffedScope(deps docsDeps, run docsRun, state *string) (*docScope, error) {
	if run.force || state == nil || !deps.reachable(*state) {
		return nil, nil
	}
	changed, deleted, err := deps.changedSince(*state)
	if err != nil {
		return nil, err
	}
	if slices.Contains(changed, ingestManifestPath) || slices.Contains(deleted, ingestManifestPath) {
		return nil, nil
	}
	return &docScope{
		paths:   selectDocPaths(changed, run.kind, run.patterns),
		deleted: selectDocPaths(deleted, run.kind, run.patterns),
	}, nil
}

func valueOrZero(scope *docScope) docScope {
	if scope == nil {
		return docScope{}
	}
	return *scope
}

func readDocFiles(read func(path string) (string, error), paths []string) ([]docFile, error) {
	files := []docFile{}
	for _, path := range paths {
		content, err := read(path)
		if err != nil {
			return nil, fmt.Errorf("reading %s: %w", path, err)
		}
		files = append(files, docFile{Path: path, Content: content})
	}
	return files, nil
}

// postDocChunks sends the delta whole when it fits one body, and otherwise in
// the {seq,total} envelope. Deleted paths ride the first chunk and the present
// list the last, so the prune runs once and only after every file has landed.
func postDocChunks(ctx context.Context, deps docsDeps, envelope docDelta, scope docScope, files []docFile) error {
	budget := deps.maxChunkBytes
	if budget <= 0 {
		budget = docChunkBytes
	}
	chunks := chunkDocFiles(files, budget)
	total := len(chunks)
	for i, chunk := range chunks {
		delta := envelope
		delta.Files = chunk
		if i == 0 {
			delta.Deleted = scope.deleted
		}
		if i == total-1 {
			delta.Present = scope.present
		}
		if total == 1 {
			return deps.post(ctx, delta)
		}
		seq := i + 1
		delta.Seq, delta.Total = &seq, &total
		if err := deps.post(ctx, delta); err != nil {
			return fmt.Errorf("chunk %d/%d: %w", seq, total, err)
		}
	}
	return nil
}

// chunkDocFiles packs files so each chunk's JSON stays under maxBytes; a single
// file larger than that is its own chunk rather than dropped. No files is one
// empty chunk: the delta is still posted, so the stored commit advances.
func chunkDocFiles(files []docFile, maxBytes int) [][]docFile {
	chunks := [][]docFile{}
	current := []docFile{}
	for _, file := range files {
		candidate := append(slices.Clone(current), file)
		if jsonLen(candidate) > maxBytes && len(current) > 0 {
			chunks = append(chunks, current)
			candidate = []docFile{file}
		}
		current = candidate
	}
	return append(chunks, current)
}

// selectDocPaths keeps the paths that belong to the kind, in the order given.
func selectDocPaths(paths []string, kind string, patterns []string) []string {
	selected := []string{}
	for _, path := range paths {
		if isDocOfKind(path, kind, patterns) {
			selected = append(selected, path)
		}
	}
	return selected
}

func isDocOfKind(path, kind string, patterns []string) bool {
	if len(patterns) > 0 {
		return matchesAnyGlob(path, patterns)
	}
	if !strings.HasSuffix(path, ".md") {
		return false
	}
	return slices.ContainsFunc(docKindPrefixes[kind], func(prefix string) bool {
		return strings.HasPrefix(path, prefix)
	})
}

// parseIngestPatterns reads .lore/ingest.yml as kind → globs, dropping any
// value that is not a list of strings. A manifest that does not parse is an
// error, not "no patterns": the built-in prefixes select different files, and a
// full ingest prunes whatever its selection leaves out.
func parseIngestPatterns(data []byte) (map[string][]string, error) {
	var raw map[string]any
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", ingestManifestPath, err)
	}
	patterns := map[string][]string{}
	for kind, value := range raw {
		if globs := stringsOf(value); len(globs) > 0 {
			patterns[kind] = globs
		}
	}
	return patterns, nil
}

func stringsOf(value any) []string {
	entries, _ := value.([]any)
	globs := []string{}
	for _, entry := range entries {
		if glob, ok := entry.(string); ok {
			globs = append(globs, glob)
		}
	}
	return globs
}

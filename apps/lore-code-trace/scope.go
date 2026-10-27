package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"strings"
)

// testScope is the set of test files a run executes. Running the whole suite to
// post a delta threw away nearly all of it: this repo's 1,150 files took 40
// minutes per push when a typical change affects a few dozen. A manifest's
// `related` command names the affected files up front.
type testScope struct {
	all   bool
	files map[string]struct{}
}

var everyTest = testScope{all: true}

func onlyFiles(files []string) testScope {
	set := make(map[string]struct{}, len(files))
	for _, file := range files {
		set[file] = struct{}{}
	}
	return testScope{files: set}
}

func (s testScope) includes(file string) bool {
	if s.all {
		return true
	}
	_, ok := s.files[file]
	return ok
}

// scopeFor asks the manifest's related command which test files the change
// since base affects. It prints a JSON array of test files, or null when the
// change reaches every test (a lockfile, a test config). No base, no related
// command, or a related command that fails all mean every test: running too
// much is slow, running too little leaves the graph stale.
func scopeFor(ctx context.Context, m Manifest, cwd, base string, logw io.Writer) testScope {
	if base == "" || strings.TrimSpace(m.Related) == "" {
		return everyTest
	}
	command := strings.ReplaceAll(m.Related, "{base}", base)
	out, err := runCommand(ctx, command, filepath.Join(cwd, m.Cwd), traceTimeout())
	if err != nil {
		fmt.Fprintf(logw, "[lore-code-trace] related command failed — running every test: %v\n", err)
		return everyTest
	}
	var files *[]string
	if err := json.Unmarshal(out, &files); err != nil {
		fmt.Fprintf(logw, "[lore-code-trace] related output is not a JSON array — running every test: %v\n", err)
		return everyTest
	}
	if files == nil {
		return everyTest
	}
	stripped := make([]string, len(*files))
	for i, file := range *files {
		stripped[i] = stripPrefix(file, m.PathPrefixStrip)
	}
	fmt.Fprintf(logw, "[lore-code-trace] %d test file(s) affected since %s\n", len(stripped), shortSHA(base))
	return onlyFiles(stripped)
}

// scopeBase is the commit Lore last absorbed, which a run may narrow its tests
// against: the delta it posts is diffed from the same commit. A failed fetch or
// a base this checkout cannot reach (a force-push, a shallow clone) gives no
// base, and the run covers every test.
func scopeBase(ctx context.Context, root string, fetchState func(context.Context) (*string, error), logw io.Writer) string {
	state, err := fetchState(ctx)
	if err != nil {
		fmt.Fprintf(logw, "[lore-code-trace] ingest state unreadable — running every test: %v\n", err)
		return ""
	}
	if state == nil || !commitReachable(root, *state) {
		return ""
	}
	return *state
}

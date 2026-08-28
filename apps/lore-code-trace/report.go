package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Contract types mirror libs/shared/src/test-report.ts. The binary forwards
// descriptors verbatim, so Spec stays an opaque string|[]string.
type TestDescriptor struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	File      string   `json:"file"`
	StartLine *int     `json:"startLine,omitempty"`
	EndLine   *int     `json:"endLine,omitempty"`
	Suite     []string `json:"suite,omitempty"`
	Spec      any      `json:"spec,omitempty"`
	Passed    *bool    `json:"passed,omitempty"`
}

type CoveredChunk struct {
	File      string `json:"file"`
	StartLine int    `json:"startLine"`
	EndLine   int    `json:"endLine"`
}

type RunResult struct {
	Passed  bool           `json:"passed"`
	Covered []CoveredChunk `json:"covered"`
}

type TaggedRunResult struct {
	ID      string         `json:"id"`
	Passed  bool           `json:"passed"`
	Covered []CoveredChunk `json:"covered"`
}

type TestReport struct {
	Commit  string            `json:"commit"`
	Branch  string            `json:"branch"`
	Tests   []TestDescriptor  `json:"tests"`
	Results []TaggedRunResult `json:"results"`
}

type reportMeta struct {
	Commit string
	Branch string
}

// buildReport runs the manifest's list, then runs the run command once per file
// (bounded by concurrency) and fans each file's RunResult onto every descriptor
// id in that file — the file is the coverage granularity. A per-file run failure
// is logged and skipped, never fatal.
func buildReport(ctx context.Context, m Manifest, cwd string, meta reportMeta, concurrency int, logw io.Writer) (TestReport, error) {
	runCwd := filepath.Join(cwd, m.Cwd)
	timeout := traceTimeout()

	if strings.TrimSpace(m.List) == "" {
		return TestReport{}, fmt.Errorf("test-command manifest entry has no 'list' command; it runs whole and cannot enumerate tests")
	}

	listOut, err := runCommand(ctx, m.List, runCwd, timeout)
	if err != nil {
		return TestReport{}, fmt.Errorf("list command failed: %w", err)
	}
	tests, err := parseDescriptors(listOut)
	if err != nil {
		return TestReport{}, fmt.Errorf("parsing tests.list output: %w", err)
	}
	for i := range tests {
		tests[i].File = stripPrefix(tests[i].File, m.PathPrefixStrip)
	}

	files, idsByFile := groupByFile(tests)

	if len(files) > 1 && !strings.Contains(m.Run, "{selector}") {
		fmt.Fprintf(logw, "[lore-code-trace] run command has no {selector}; the same command runs once per file and every file gets identical results\n")
	}

	if concurrency < 1 {
		concurrency = 1
	}
	var (
		mu        sync.Mutex
		runByFile = make(map[string]*RunResult, len(files))
		sem       = make(chan struct{}, concurrency)
		wg        sync.WaitGroup
	)
	for _, f := range files {
		wg.Add(1)
		sem <- struct{}{}
		go func(file string) {
			defer wg.Done()
			defer func() { <-sem }()
			if rr := runOneFile(ctx, m, file, runCwd, timeout, logw); rr != nil {
				mu.Lock()
				runByFile[file] = rr
				mu.Unlock()
			}
		}(f)
	}
	wg.Wait()

	results := make([]TaggedRunResult, 0, len(tests))
	for _, f := range files {
		rr := runByFile[f]
		if rr == nil {
			continue
		}
		for _, id := range idsByFile[f] {
			results = append(results, TaggedRunResult{ID: id, Passed: rr.Passed, Covered: rr.Covered})
		}
	}

	return TestReport{Commit: meta.Commit, Branch: meta.Branch, Tests: tests, Results: results}, nil
}

// runOneFile runs the manifest's run command for one file and parses its output
// per coverage_format. json: stdout is {passed, covered} and a non-zero exit is a
// broken command (skip). lcov/cobertura: the exit code is pass/fail and stdout is
// the raw coverage report (parsed even when the test failed). Returns nil to skip.
func runOneFile(ctx context.Context, m Manifest, file, runCwd string, timeout time.Duration, logw io.Writer) *RunResult {
	out, err := runCommand(ctx, substituteSelector(m.Run, file), runCwd, timeout)

	var rr *RunResult
	switch m.CoverageFormat {
	case "json":
		if err != nil {
			fmt.Fprintf(logw, "[lore-code-trace] run failed for %s — skipped: %v\n", file, err)
			return nil
		}
		parsed, perr := parseRunResult(out)
		if perr != nil {
			fmt.Fprintf(logw, "[lore-code-trace] unparseable run output for %s — skipped: %v\n", file, perr)
			return nil
		}
		rr = parsed
	case "lcov":
		rr = &RunResult{Passed: err == nil, Covered: parseLcovCoverage(string(out))}
	case "cobertura":
		rr = &RunResult{Passed: err == nil, Covered: parseCoberturaCoverage(string(out))}
	default:
		fmt.Fprintf(logw, "[lore-code-trace] unsupported coverage_format %q for %s — skipped\n", m.CoverageFormat, file)
		return nil
	}

	for i := range rr.Covered {
		rr.Covered[i].File = stripPrefix(rr.Covered[i].File, m.PathPrefixStrip)
	}
	return rr
}

func substituteSelector(run, selector string) string {
	return strings.ReplaceAll(run, "{selector}", selector)
}

// groupByFile returns the distinct files in first-appearance order plus the
// descriptor ids per file.
func groupByFile(tests []TestDescriptor) ([]string, map[string][]string) {
	var files []string
	ids := make(map[string][]string)
	for _, d := range tests {
		if _, seen := ids[d.File]; !seen {
			files = append(files, d.File)
		}
		ids[d.File] = append(ids[d.File], d.ID)
	}
	return files, ids
}

func stripPrefix(path, prefix string) string {
	if prefix == "" {
		return path
	}
	return strings.TrimPrefix(strings.TrimPrefix(path, prefix), "/")
}

func parseDescriptors(out []byte) ([]TestDescriptor, error) {
	var ds []TestDescriptor
	if err := json.Unmarshal(out, &ds); err != nil {
		return nil, fmt.Errorf("expected a JSON array of descriptors: %w", err)
	}
	for i, d := range ds {
		if d.ID == "" || d.Name == "" || d.File == "" {
			return nil, fmt.Errorf("descriptor %d is missing a required id/name/file", i)
		}
	}
	return ds, nil
}

func parseRunResult(out []byte) (*RunResult, error) {
	var r RunResult
	if err := json.Unmarshal(out, &r); err != nil {
		return nil, fmt.Errorf("expected {passed, covered}: %w", err)
	}
	return &r, nil
}

func runCommand(ctx context.Context, command, cwd string, timeout time.Duration) ([]byte, error) {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, "sh", "-c", command)
	cmd.Dir = cwd
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		return out.Bytes(), fmt.Errorf("%w: %s", err, strings.TrimSpace(errb.String()))
	}
	return out.Bytes(), nil
}

// traceTimeout honours LORE_TRACE_TIMEOUT_MS (default 120s), matching the TS runner.
func traceTimeout() time.Duration {
	if ms, err := strconv.Atoi(os.Getenv("LORE_TRACE_TIMEOUT_MS")); err == nil && ms > 0 {
		return time.Duration(ms) * time.Millisecond
	}
	return 120 * time.Second
}

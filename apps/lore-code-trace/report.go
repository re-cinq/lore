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
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	File      string          `json:"file"`
	StartLine *int            `json:"startLine,omitempty"`
	EndLine   *int            `json:"endLine,omitempty"`
	Suite     []string        `json:"suite,omitempty"`
	Spec      json.RawMessage `json:"spec,omitempty"`
	Passed    *bool           `json:"passed,omitempty"`
	RunnerID  string          `json:"runnerId,omitempty"`
	Execution *TestExecution  `json:"execution,omitempty"`
}

type TestLocation struct {
	Line   int `json:"line"`
	Column int `json:"column"`
}

type TestExecution struct {
	Status          string        `json:"status"`
	Location        *TestLocation `json:"location,omitempty"`
	ExpectedFailure *bool         `json:"expectedFailure"`
	FileCaseCount   int           `json:"fileCaseCount,omitempty"`
}

type CoveredChunk struct {
	File      string `json:"file"`
	StartLine int    `json:"startLine"`
	EndLine   int    `json:"endLine"`
}

type RunResult struct {
	Passed  bool             `json:"passed"`
	Covered []CoveredChunk   `json:"covered"`
	Tests   []TestDescriptor `json:"tests"`
}

type TaggedRunResult struct {
	ID      string         `json:"id"`
	Passed  bool           `json:"passed"`
	Covered []CoveredChunk `json:"covered"`
}

type TestReport struct {
	Commit string `json:"commit"`
	// Branch is the checkout's branch. The server compares it with the repo's
	// default branch: any other branch's report lands in that branch's overlay
	// instead of the main graph (issue #1769).
	Branch  string            `json:"branch"`
	Tests   []TestDescriptor  `json:"tests"`
	Results []TaggedRunResult `json:"results"`
}

type reportMeta struct {
	Commit string
	Branch string
}

func buildReport(ctx context.Context, m Manifest, cwd string, meta reportMeta, scope testScope, concurrency int, logw io.Writer) (TestReport, error) {
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
		// Fall back to a plain string array: each element is a file path, and the
		// workspace cwd is prepended to make IDs repo-relative across workspaces.
		tests, err = parseSimpleDescriptors(listOut, m.Cwd)
		if err != nil {
			return TestReport{}, fmt.Errorf("parsing tests.list output: %w", err)
		}
	}
	inScope := make([]TestDescriptor, 0, len(tests))
	for _, test := range tests {
		test.File = stripPrefix(test.File, m.PathPrefixStrip)
		if scope.includes(test.File) {
			inScope = append(inScope, test)
		}
	}
	tests = inScope

	files, testsByFile := groupByFile(tests)

	if len(files) > 1 && !strings.Contains(m.Run, "{selector}") {
		fmt.Fprintf(logw, "[lore-code-trace] run command has no {selector}; the same command runs once per file and every file gets identical results\n")
	}

	runByFile, err := runManyFiles(ctx, m, files, runCwd, timeout, logw)
	if err != nil {
		if m.RunMany != "" {
			fmt.Fprintf(logw, "[lore-code-trace] run_many failed — running each file on its own: %v\n", err)
		}
		runByFile = runEachFile(ctx, m, files, runCwd, timeout, concurrency, logw)
	}

	results := make([]TaggedRunResult, 0, len(tests))
	assessed := make([]TestDescriptor, 0, len(tests))
	for _, f := range files {
		fileTests, fileResults := fileExecutionReport(f, testsByFile[f], runByFile[f])
		assessed = append(assessed, fileTests...)
		results = append(results, fileResults...)
	}

	return TestReport{
		Commit:  meta.Commit,
		Branch:  meta.Branch,
		Tests:   assessed,
		Results: results,
	}, nil
}

// errNoRunMany says the manifest declares no batch runner for its files.
var errNoRunMany = fmt.Errorf("no run_many")

// runManyFiles hands every file to the manifest's run_many command at once: one
// process that boots each package's test runner once, where the per-file run
// paid that boot, and a whole-source coverage pass, for every file (96% of the
// job's time on this repository). A file it leaves out is skipped, as a failed
// run is. It answers errNoRunMany when the manifest has none, and an error when
// the command fails or prints something else than {file: {passed, covered}}.
func runManyFiles(ctx context.Context, m Manifest, files []string, runCwd string, timeout time.Duration, logw io.Writer) (map[string]*RunResult, error) {
	if m.RunMany == "" || m.CoverageFormat != "json" {
		return nil, errNoRunMany
	}
	// Each file had the whole per-file budget; the batch gets their sum.
	out, err := runCommandWithInput(ctx, m.RunMany, runCwd, timeout*time.Duration(len(files)), strings.Join(files, "\n")+"\n")
	if err != nil {
		return nil, err
	}
	var answered map[string]*RunResult
	if err := json.Unmarshal(out, &answered); err != nil {
		return nil, fmt.Errorf("expected {file: {passed, covered}}: %w", err)
	}
	runByFile := make(map[string]*RunResult, len(files))
	for _, file := range files {
		rr := answered[file]
		if rr == nil {
			fmt.Fprintf(logw, "[lore-code-trace] run_many did not answer for %s — skipped\n", file)
			continue
		}
		normalizeRunPaths(rr, m.PathPrefixStrip)
		runByFile[file] = rr
	}
	return runByFile, nil
}

// runEachFile runs the manifest's run command once per file, bounded by
// concurrency.
func runEachFile(ctx context.Context, m Manifest, files []string, runCwd string, timeout time.Duration, concurrency int, logw io.Writer) map[string]*RunResult {
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
	return runByFile
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

	normalizeRunPaths(rr, m.PathPrefixStrip)
	return rr
}

func normalizeRunPaths(result *RunResult, prefix string) {
	for index := range result.Covered {
		result.Covered[index].File = stripPrefix(result.Covered[index].File, prefix)
	}
	for index := range result.Tests {
		result.Tests[index].File = stripPrefix(result.Tests[index].File, prefix)
	}
}

func substituteSelector(run, selector string) string {
	return strings.ReplaceAll(run, "{selector}", selector)
}

func groupByFile(tests []TestDescriptor) ([]string, map[string][]TestDescriptor) {
	var files []string
	byFile := make(map[string][]TestDescriptor)
	for _, d := range tests {
		if _, seen := byFile[d.File]; !seen {
			files = append(files, d.File)
		}
		byFile[d.File] = append(byFile[d.File], d)
	}
	return files, byFile
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

// parseSimpleDescriptors handles a list command that outputs a JSON array of
// file-path strings rather than full descriptor objects. Each string becomes a
// descriptor whose ID is prefixed with the workspace cwd to stay repo-relative.
func parseSimpleDescriptors(out []byte, cwdPrefix string) ([]TestDescriptor, error) {
	var files []string
	if err := json.Unmarshal(out, &files); err != nil {
		return nil, fmt.Errorf("expected a JSON array of descriptors or file paths: %w", err)
	}
	ds := make([]TestDescriptor, len(files))
	for i, f := range files {
		if f == "" {
			return nil, fmt.Errorf("descriptor %d is an empty file path", i)
		}
		id := f
		if cwdPrefix != "" && cwdPrefix != "." {
			id = cwdPrefix + "/" + f
		}
		ds[i] = TestDescriptor{ID: id, Name: f, File: f}
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
	return runCommandWithInput(ctx, command, cwd, timeout, "")
}

func runCommandWithInput(ctx context.Context, command, cwd string, timeout time.Duration, input string) ([]byte, error) {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, "sh", "-c", command)
	cmd.Dir = cwd
	cmd.Stdin = strings.NewReader(input)
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

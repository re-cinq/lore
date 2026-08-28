package main

import (
	"context"
	"io"
	"strings"
	"testing"
)

// Real shell commands (printf emitting the contract JSON) stand in for a repo's
// list/run — no mocks. Two descriptors in one file exercise group-by-file + the
// fan of a single file-level RunResult onto every descriptor id in that file.
func TestBuildReportFansFileResultOntoEveryDescriptor(t *testing.T) {
	listJSON := `[{"id":"src/a_test.go::A","name":"A","file":"src/a_test.go"},{"id":"src/a_test.go::B","name":"B","file":"src/a_test.go"}]`
	m := Manifest{
		List:           "printf '%s' '" + listJSON + "'",
		Run:            `printf '%s' '{"passed":true,"covered":[{"file":"src/a.go","startLine":1,"endLine":3}]}'`,
		CoverageFormat: "json",
		Cwd:            ".",
	}

	report, err := buildReport(context.Background(), m, t.TempDir(), reportMeta{Commit: "c1", Branch: "main"}, 2, io.Discard)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if report.Commit != "c1" || report.Branch != "main" {
		t.Errorf("meta not propagated: %+v", report)
	}
	if len(report.Tests) != 2 {
		t.Fatalf("tests: got %d, want 2", len(report.Tests))
	}
	if len(report.Results) != 2 {
		t.Fatalf("results: got %d, want 2 (one per descriptor in the file)", len(report.Results))
	}
	byID := map[string]TaggedRunResult{}
	for _, r := range report.Results {
		byID[r.ID] = r
	}
	for _, id := range []string{"src/a_test.go::A", "src/a_test.go::B"} {
		r, ok := byID[id]
		if !ok {
			t.Fatalf("missing result for %q", id)
		}
		if !r.Passed || len(r.Covered) != 1 || r.Covered[0].File != "src/a.go" {
			t.Errorf("result for %q wrong: %+v", id, r)
		}
	}
}

// coverage_format: lcov — the run command emits raw lcov on stdout; the binary
// parses it to canonical ranges and takes pass/fail from the exit code.
func TestBuildReportParsesLcovRunOutput(t *testing.T) {
	listJSON := `[{"id":"x::1","name":"1","file":"x.go"}]`
	lcov := "SF:src/x.go\nDA:1,1\nDA:2,1\nend_of_record\n"
	m := Manifest{
		List:           "printf '%s' '" + listJSON + "'",
		Run:            "printf '%s' '" + lcov + "' # {selector}",
		CoverageFormat: "lcov",
		Cwd:            ".",
	}
	report, err := buildReport(context.Background(), m, t.TempDir(), reportMeta{Commit: "c", Branch: "b"}, 2, io.Discard)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(report.Results) != 1 {
		t.Fatalf("results: got %d, want 1", len(report.Results))
	}
	r := report.Results[0]
	if !r.Passed {
		t.Error("expected passed=true from a zero exit")
	}
	want := []CoveredChunk{{File: "src/x.go", StartLine: 1, EndLine: 2}}
	if len(r.Covered) != 1 || r.Covered[0] != want[0] {
		t.Errorf("covered: got %+v, want %+v", r.Covered, want)
	}
}

// A whole-suite entry (relaxed parser keeps it with no list) cannot enumerate
// tests; the sole list consumer must fail loudly here rather than run sh -c ""
// and emit a misleading empty report.
func TestBuildReportErrorsWhenListMissing(t *testing.T) {
	m := Manifest{
		List: "",
		Run:  "npm run consumer",
		Cwd:  ".",
	}
	_, err := buildReport(context.Background(), m, t.TempDir(), reportMeta{Commit: "c", Branch: "b"}, 2, io.Discard)
	if err == nil {
		t.Fatal("expected an error when the manifest has no list command")
	}
	if !strings.Contains(err.Error(), "cannot enumerate") {
		t.Errorf("error should explain the entry runs whole and cannot enumerate, got: %v", err)
	}
}

// A list-bearing entry with an unknown coverage_format (cleared to empty by the
// relaxed parser) still runs the list and builds a report; each file's coverage
// is skipped-with-log via runOneFile's default branch, not a hard failure.
func TestBuildReportRunsListBearingEntryWithEmptyCoverageFormat(t *testing.T) {
	listJSON := `[{"id":"x::1","name":"1","file":"x.go"}]`
	m := Manifest{
		List:           "printf '%s' '" + listJSON + "'",
		Run:            "printf ignored # {selector}",
		CoverageFormat: "",
		Cwd:            ".",
	}
	report, err := buildReport(context.Background(), m, t.TempDir(), reportMeta{Commit: "c", Branch: "b"}, 2, io.Discard)
	if err != nil {
		t.Fatalf("an unknown coverage_format should skip coverage, not error: %v", err)
	}
	if len(report.Tests) != 1 {
		t.Errorf("tests: got %d, want 1", len(report.Tests))
	}
	if len(report.Results) != 0 {
		t.Errorf("results: got %d, want 0 (coverage skipped)", len(report.Results))
	}
}

// A run command with no {selector} across more than one file runs the same
// command per file and fans identical results everywhere — cheap to do by
// mistake, so buildReport warns rather than staying silent.
func TestBuildReportWarnsWhenRunLacksSelectorAcrossFiles(t *testing.T) {
	listJSON := `[{"id":"a.go::1","name":"1","file":"a.go"},{"id":"b.go::1","name":"1","file":"b.go"}]`
	m := Manifest{
		List:           "printf '%s' '" + listJSON + "'",
		Run:            `printf '%s' '{"passed":true,"covered":[]}'`,
		CoverageFormat: "json",
		Cwd:            ".",
	}
	var logw strings.Builder
	_, err := buildReport(context.Background(), m, t.TempDir(), reportMeta{Commit: "c", Branch: "b"}, 2, &logw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(logw.String(), "no {selector}") {
		t.Errorf("expected a missing-selector warning, got: %q", logw.String())
	}
}

// A single file with no {selector} runs the command once — no redundancy, so no
// warning.
func TestBuildReportSilentWhenRunLacksSelectorForOneFile(t *testing.T) {
	listJSON := `[{"id":"a.go::1","name":"1","file":"a.go"}]`
	m := Manifest{
		List:           "printf '%s' '" + listJSON + "'",
		Run:            `printf '%s' '{"passed":true,"covered":[]}'`,
		CoverageFormat: "json",
		Cwd:            ".",
	}
	var logw strings.Builder
	if _, err := buildReport(context.Background(), m, t.TempDir(), reportMeta{Commit: "c", Branch: "b"}, 2, &logw); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.Contains(logw.String(), "no {selector}") {
		t.Errorf("did not expect a warning for a single file, got: %q", logw.String())
	}
}

// A failing run command must not abort the whole report — that file is skipped.
func TestBuildReportSkipsFileWhenRunCommandFails(t *testing.T) {
	listJSON := `[{"id":"x::1","name":"1","file":"x.go"}]`
	m := Manifest{
		List:           "printf '%s' '" + listJSON + "'",
		Run:            "false {selector}",
		CoverageFormat: "json",
		Cwd:            ".",
	}
	report, err := buildReport(context.Background(), m, t.TempDir(), reportMeta{Commit: "c", Branch: "b"}, 2, io.Discard)
	if err != nil {
		t.Fatalf("a failing run should be skipped, not error: %v", err)
	}
	if len(report.Tests) != 1 {
		t.Errorf("tests: got %d, want 1", len(report.Tests))
	}
	if len(report.Results) != 0 {
		t.Errorf("results: got %d, want 0 (file skipped)", len(report.Results))
	}
}

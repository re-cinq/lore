package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestExitCodeMapsRetryExhaustionAndOrdinaryErrors(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want int
	}{
		{name: "retry exhaustion", err: errRetryExhausted, want: 75},
		{name: "ordinary error", err: errors.New("ingest failed"), want: 1},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := exitCode(test.err); got != test.want {
				t.Errorf("exitCode(%v) = %d, want %d", test.err, got, test.want)
			}
		})
	}
}

// End-to-end through run(): a real temp git repo + an echo-based manifest exercise
// manifest load, git metadata, orchestration, and the print path — no mocks.
func TestRunPrintsReportFromEchoManifest(t *testing.T) {
	dir := repoWithManifest(t, `list: "printf '%s' '[{\"id\":\"x::1\",\"name\":\"1\",\"file\":\"a.go\"}]'"
run: "printf '%s' '{\"passed\":true,\"covered\":[]}' # {selector}"
coverage_format: json
`)

	report := printedReport(t, dir)
	if report.Commit == "" {
		t.Error("commit not populated from git")
	}
	if len(report.Tests) != 1 || report.Tests[0].ID != "x::1" {
		t.Errorf("tests: %+v", report.Tests)
	}
	if len(report.Results) != 1 || !report.Results[0].Passed {
		t.Errorf("results: %+v", report.Results)
	}
}

// The contract's own run-whole example after a listable entry, the way a repo
// declares a packed-tarball browser suite beside its unit suite (#3958): run()
// reports the listable entry's tests and results instead of failing on the entry
// that cannot enumerate any.
func TestRunReportsTheSiblingsOfARunWholeEntry(t *testing.T) {
	dir := repoWithManifest(t, `- list: "printf '%s' '[{\"id\":\"x::1\",\"name\":\"1\",\"file\":\"a.go\"}]'"
  run: "printf '%s' '{\"passed\":true,\"covered\":[]}' # {selector}"
  coverage_format: json
- run: "npm run consumer"
`)

	report := printedReport(t, dir)
	if len(report.Tests) != 1 || report.Tests[0].ID != "x::1" {
		t.Errorf("tests: %+v", report.Tests)
	}
	if len(report.Results) != 1 || !report.Results[0].Passed {
		t.Errorf("results: %+v", report.Results)
	}
}

// The run-whole entry is skipped, not run: its command would leave a file behind,
// and the log names the entry the report passed over.
func TestBuildCombinedReportSkipsARunWholeEntryWithoutRunningIt(t *testing.T) {
	root := t.TempDir()
	manifests := []Manifest{echoEntry(), {Run: "touch ran-whole", Cwd: "."}}

	var log bytes.Buffer
	report, _, err := buildCombinedReport(context.Background(), manifests, root, "", reportMeta{Commit: "c1", Branch: "main"}, &log)
	if err != nil {
		t.Fatalf("buildCombinedReport: %v", err)
	}
	if len(report.Tests) != 1 || len(report.Results) != 1 {
		t.Errorf("report: %+v", report)
	}
	if _, err := os.Stat(filepath.Join(root, "ran-whole")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("the run-whole entry's command ran (stat: %v)", err)
	}
	if !strings.Contains(log.String(), `skipping run-whole entry "touch ran-whole"`) {
		t.Errorf("log does not name the skipped entry:\n%s", log.String())
	}
}

// The skipped entry has no say in whether the report is narrowed to what a change
// affects: an entry its related command narrowed stays narrowed beside it, while
// a listable entry with no related command still widens the report.
func TestBuildCombinedReportLeavesNarrowingToTheEntriesItReports(t *testing.T) {
	narrowed := echoEntry()
	narrowed.Related = `printf '%s' '["a.go"]'`

	tests := []struct {
		name    string
		sibling Manifest
		want    bool
	}{
		{name: "beside a run-whole entry", sibling: Manifest{Run: "npm run consumer", Cwd: "."}, want: true},
		{name: "beside a listable entry with no related command", sibling: echoEntry(), want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			manifests := []Manifest{narrowed, test.sibling}
			_, got, err := buildCombinedReport(context.Background(), manifests, t.TempDir(), "abc1234", reportMeta{Commit: "c1", Branch: "main"}, io.Discard)
			if err != nil {
				t.Fatalf("buildCombinedReport: %v", err)
			}
			if got != test.want {
				t.Errorf("every entry narrowed = %v, want %v", got, test.want)
			}
		})
	}
}

// repoWithManifest makes a temp git repo with an origin remote and one commit
// holding manifest as its .lore/test-commands.yml.
func repoWithManifest(t *testing.T, manifest string) string {
	t.Helper()
	dir := t.TempDir()
	gitRun(t, dir, "init", "-q")
	gitRun(t, dir, "config", "user.email", "t@t.com")
	gitRun(t, dir, "config", "user.name", "t")
	gitRun(t, dir, "remote", "add", "origin", "git@github.com:o/r.git")

	loreDir := filepath.Join(dir, ".lore")
	if err := os.MkdirAll(loreDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(loreDir, "test-commands.yml"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	gitRun(t, dir, "add", "-A")
	gitRun(t, dir, "commit", "-q", "-m", "init")
	return dir
}

// printedReport runs the print path in dir and decodes the report it writes.
func printedReport(t *testing.T, dir string) TestReport {
	t.Helper()
	var out bytes.Buffer
	if err := run(dir, false, false, &out); err != nil {
		t.Fatalf("run: %v", err)
	}
	var report TestReport
	if err := json.Unmarshal(out.Bytes(), &report); err != nil {
		t.Fatalf("output is not a report: %v\n%s", err, out.String())
	}
	return report
}

// echoEntry is a listable entry whose list and run print the contract's JSON: one
// test in a.go, which passes.
func echoEntry() Manifest {
	return Manifest{
		List:           `printf '%s' '[{"id":"x::1","name":"1","file":"a.go"}]'`,
		Run:            `printf '%s' '{"passed":true,"covered":[]}' # {selector}`,
		CoverageFormat: "json",
		Cwd:            ".",
	}
}

func gitRun(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

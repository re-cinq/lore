package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// End-to-end through run(): a real temp git repo + an echo-based manifest exercise
// manifest load, git metadata, orchestration, and the print path — no mocks.
func TestRunPrintsReportFromEchoManifest(t *testing.T) {
	dir := t.TempDir()
	gitRun(t, dir, "init", "-q")
	gitRun(t, dir, "config", "user.email", "t@t.com")
	gitRun(t, dir, "config", "user.name", "t")
	gitRun(t, dir, "remote", "add", "origin", "git@github.com:o/r.git")

	manifest := `list: "printf '%s' '[{\"id\":\"x::1\",\"name\":\"1\",\"file\":\"a.go\"}]'"
run: "printf '%s' '{\"passed\":true,\"covered\":[]}' # {selector}"
coverage_format: json
`
	loreDir := filepath.Join(dir, ".lore")
	if err := os.MkdirAll(loreDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(loreDir, "test-commands.yml"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	gitRun(t, dir, "add", "-A")
	gitRun(t, dir, "commit", "-q", "-m", "init")

	var out bytes.Buffer
	if err := run(dir, false, &out); err != nil {
		t.Fatalf("run: %v", err)
	}

	var report TestReport
	if err := json.Unmarshal(out.Bytes(), &report); err != nil {
		t.Fatalf("output is not a report: %v\n%s", err, out.String())
	}
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

func gitRun(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

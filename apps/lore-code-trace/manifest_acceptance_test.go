package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// A test with a two-entry manifest asserting both entries' list commands ran.
func TestParseManifestAcceptsMultiEntryManifest(t *testing.T) {
	// Setup a fake git repository so gitOutput("rev-parse", "--show-toplevel") works.
	dir := t.TempDir()
	if err := exec.Command("git", "init", dir).Run(); err != nil {
		t.Fatalf("failed to init git: %v", err)
	}

	// Create the .lore directory and test-commands.yml with a two-entry list.
	loreDir := filepath.Join(dir, ".lore")
	if err := os.Mkdir(loreDir, 0755); err != nil {
		t.Fatalf("failed to mkdir .lore: %v", err)
	}
	manifestData := []byte(`
- list: "echo [\"api.test.js\"]"
  run: "echo {selector}"
  coverage_format: json
  cwd: "api"
- list: "echo [\"web.test.js\"]"
  run: "echo {selector}"
  coverage_format: json
  cwd: "web"
`)
	if err := os.WriteFile(filepath.Join(loreDir, "test-commands.yml"), manifestData, 0644); err != nil {
		t.Fatalf("failed to write manifest: %v", err)
	}

	// Create the directories so the commands can run in them.
	os.Mkdir(filepath.Join(dir, "api"), 0755)
	os.Mkdir(filepath.Join(dir, "web"), 0755)
	
	// Create dummy test files
	if err := os.WriteFile(filepath.Join(dir, "api", "api.test.js"), []byte("api"), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "web", "web.test.js"), []byte("web"), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}
	
	// git requires at least one commit
	exec.Command("git", "-C", dir, "config", "user.email", "test@example.com").Run()
	exec.Command("git", "-C", dir, "config", "user.name", "Test").Run()
	if err := exec.Command("git", "-C", dir, "add", ".").Run(); err != nil {
		t.Fatalf("failed to git add: %v", err)
	}
	if err := exec.Command("git", "-C", dir, "commit", "-m", "init").Run(); err != nil {
		t.Fatalf("failed to git commit: %v", err)
	}

	// Run the orchestrator in non-post mode (prints JSON to stdout).
	var out bytes.Buffer
	if err := run(dir, false, false, &out); err != nil {
		t.Fatalf("run() returned error: %v", err)
	}

	// Assert the output report contains tests from BOTH workspaces.
	var report struct {
		Tests []struct {
			ID string `json:"id"`
		} `json:"tests"`
	}
	if err := json.Unmarshal(out.Bytes(), &report); err != nil {
		t.Fatalf("failed to unmarshal report: %v", err)
	}

	foundAPI := false
	foundWeb := false
	for _, tc := range report.Tests {
		if tc.ID == "api/api.test.js" {
			foundAPI = true
		}
		if tc.ID == "web/web.test.js" {
			foundWeb = true
		}
	}

	if !foundAPI || !foundWeb {
		t.Errorf("expected both workspaces' tests in report. Got API: %v, Web: %v. Tests: %v", foundAPI, foundWeb, report.Tests)
	}
}

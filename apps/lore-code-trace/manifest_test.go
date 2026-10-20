package main

import "testing"

func TestParseManifestAppliesCwdDefault(t *testing.T) {
	ms, err := parseManifest([]byte("list: \"echo []\"\nrun: \"echo {selector}\"\ncoverage_format: json\n"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := Manifest{List: "echo []", Run: "echo {selector}", CoverageFormat: "json", Cwd: ".", PathPrefixStrip: ""}
	if len(ms) != 1 || ms[0] != want {
		t.Errorf("got %+v, want [%+v]", ms, want)
	}
}

// A whole-suite entry declares only run — no list, no {selector}, no
// coverage_format — and is honest, not malformed (mirrors #1604 on the TS side).
func TestParseManifestAcceptsWholeSuiteRunOnly(t *testing.T) {
	ms, err := parseManifest([]byte("run: \"npm run consumer\"\n"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := Manifest{List: "", Run: "npm run consumer", CoverageFormat: "", Cwd: ".", PathPrefixStrip: ""}
	if len(ms) != 1 || ms[0] != want {
		t.Errorf("got %+v, want [%+v]", ms, want)
	}
}

// Re-pinned: the strict parser rejected a run without {selector}; the relaxed
// contract (#1604) accepts it as a run-whole entry.
func TestParseManifestAcceptsRunWithoutSelector(t *testing.T) {
	ms, err := parseManifest([]byte("list: \"echo []\"\nrun: \"echo nope\"\ncoverage_format: json\n"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := Manifest{List: "echo []", Run: "echo nope", CoverageFormat: "json", Cwd: ".", PathPrefixStrip: ""}
	if len(ms) != 1 || ms[0] != want {
		t.Errorf("got %+v, want [%+v]", ms, want)
	}
}

// Re-pinned: the strict parser rejected an unknown coverage_format; the relaxed
// contract (#1604) keeps the entry and clears the unknown value to empty.
func TestParseManifestClearsUnknownCoverageFormat(t *testing.T) {
	ms, err := parseManifest([]byte("list: \"echo []\"\nrun: \"echo {selector}\"\ncoverage_format: bogus\n"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := Manifest{List: "echo []", Run: "echo {selector}", CoverageFormat: "", Cwd: ".", PathPrefixStrip: ""}
	if len(ms) != 1 || ms[0] != want {
		t.Errorf("got %+v, want [%+v]", ms, want)
	}
}

func TestParseManifestRejectsEmptyRun(t *testing.T) {
	_, err := parseManifest([]byte("list: \"echo []\"\ncoverage_format: json\n"))
	if err == nil {
		t.Fatal("expected error when run is empty")
	}
}

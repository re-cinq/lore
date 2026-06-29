package main

import "testing"

func TestParseManifestAppliesCwdDefault(t *testing.T) {
	m, err := parseManifest([]byte("list: \"echo []\"\nrun: \"echo {selector}\"\ncoverage_format: json\n"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := Manifest{List: "echo []", Run: "echo {selector}", CoverageFormat: "json", Cwd: ".", PathPrefixStrip: ""}
	if m != want {
		t.Errorf("got %+v, want %+v", m, want)
	}
}

func TestParseManifestRejectsRunWithoutSelector(t *testing.T) {
	_, err := parseManifest([]byte("list: \"echo []\"\nrun: \"echo nope\"\ncoverage_format: json\n"))
	if err == nil {
		t.Fatal("expected error when run lacks the {selector} placeholder")
	}
}

func TestParseManifestRejectsUnknownCoverageFormat(t *testing.T) {
	_, err := parseManifest([]byte("list: \"echo []\"\nrun: \"echo {selector}\"\ncoverage_format: bogus\n"))
	if err == nil {
		t.Fatal("expected error for an unsupported coverage_format")
	}
}

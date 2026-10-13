package main

import "testing"

func TestGlobMatch(t *testing.T) {
	cases := []struct {
		pattern, path string
		want          bool
	}{
		{"specs/**/*.md", "specs/a/spec.md", true},
		{"specs/**/*.md", "specs/a/b/c/plan.md", true},
		{"specs/**/*.md", "specs/README.md", true},
		{"specs/**/*.md", "specs/a/spec.txt", false},
		{"specs/**/*.md", "adrs/ADR-001.md", false},
		{"adrs/*.md", "adrs/ADR-001.md", true},
		{"adrs/*.md", "adrs/old/ADR-001.md", false},
		{"docs/spec-?.md", "docs/spec-1.md", true},
		{"docs/spec-?.md", "docs/spec-12.md", false},
		{".specify/**/*.md", ".specify/memory/constitution.md", true},
		{"**/*.md", "a/b.md", true},
		{"**/*.md", "b.md", true},
		{"specs/**", "specs/a/b.md", true},
		// minimatch's default: a wildcard never matches a dot-segment it did not spell out.
		{"specs/**/*.md", "specs/.drafts/spec.md", false},
		{"specs/*.md", "specs/.hidden.md", false},
	}
	for _, c := range cases {
		if got := globMatch(c.pattern, c.path); got != c.want {
			t.Errorf("globMatch(%q, %q) = %v, want %v", c.pattern, c.path, got, c.want)
		}
	}
}

func TestMatchesAnyGlobIsTrueWhenOnePatternMatches(t *testing.T) {
	patterns := []string{"adrs/**/*.md", "docs/decisions/*.md"}
	if !matchesAnyGlob("docs/decisions/0001.md", patterns) {
		t.Error("docs/decisions/0001.md matches the second pattern")
	}
	if matchesAnyGlob("docs/guide.md", patterns) {
		t.Error("docs/guide.md matches neither pattern")
	}
}

package main

import (
	"reflect"
	"testing"
)

func TestParseNameStatus(t *testing.T) {
	// `git diff --name-status base..HEAD`: one status letter, a tab, the path —
	// except renames, which carry a similarity score and BOTH paths.
	out := "M\tsrc/a.ts\nA\tsrc/b.ts\nD\tsrc/gone.ts\nR100\tsrc/old.ts\tsrc/new.ts\n"
	changed, deleted := parseNameStatus(out)

	if want := []string{"src/a.ts", "src/b.ts", "src/new.ts"}; !reflect.DeepEqual(changed, want) {
		t.Fatalf("changed = %v, want %v", changed, want)
	}
	// A rename deletes its old path as far as the graph is concerned.
	if want := []string{"src/gone.ts", "src/old.ts"}; !reflect.DeepEqual(deleted, want) {
		t.Fatalf("deleted = %v, want %v", deleted, want)
	}
}

func TestParseNameStatusEmpty(t *testing.T) {
	changed, deleted := parseNameStatus("\n")
	if len(changed) != 0 || len(deleted) != 0 {
		t.Fatalf("empty diff should yield nothing, got %v / %v", changed, deleted)
	}
}

func report() TestReport {
	line := func(n int) *int { return &n }
	return TestReport{
		Commit: "abc", Branch: "main",
		Tests: []TestDescriptor{
			{ID: "t1", Name: "one", File: "src/a.test.ts", StartLine: line(1), EndLine: line(5)},
			{ID: "t2", Name: "two", File: "src/b.test.ts", StartLine: line(1), EndLine: line(5)},
			{ID: "t3", Name: "three", File: "src/c.test.ts", StartLine: line(1), EndLine: line(5)},
		},
		Results: []TaggedRunResult{
			{ID: "t1", Passed: true, Covered: []CoveredChunk{{File: "src/a.ts", StartLine: 1, EndLine: 9}}},
			{ID: "t2", Passed: true, Covered: []CoveredChunk{{File: "src/touched.ts", StartLine: 2, EndLine: 4}}},
			{ID: "t3", Passed: true, Covered: []CoveredChunk{{File: "src/quiet.ts", StartLine: 1, EndLine: 3}}},
		},
	}
}

func ids(tests []TestDescriptor) []string {
	out := make([]string, 0, len(tests))
	for _, d := range tests {
		out = append(out, d.ID)
	}
	return out
}

func TestSelectDeltaKeepsTestsInChangedTestFiles(t *testing.T) {
	got := selectDelta(report(), []string{"src/b.test.ts"})

	if want := []string{"t2"}; !reflect.DeepEqual(ids(got.Tests), want) {
		t.Fatalf("tests = %v, want %v", ids(got.Tests), want)
	}
	if len(got.Results) != 1 || got.Results[0].ID != "t2" {
		t.Fatalf("results should carry only the kept test, got %v", got.Results)
	}
	if got.Commit != "abc" || got.Branch != "main" {
		t.Fatalf("commit/branch must survive the filter, got %q/%q", got.Commit, got.Branch)
	}
}

func TestSelectDeltaKeepsTestsWhoseCoverageTouchesAChangedFile(t *testing.T) {
	// An edit shifts every line range below it in the same file, so coverage
	// touching a changed file re-projects at FILE granularity — not by line.
	got := selectDelta(report(), []string{"src/touched.ts"})

	if want := []string{"t2"}; !reflect.DeepEqual(ids(got.Tests), want) {
		t.Fatalf("tests = %v, want %v", ids(got.Tests), want)
	}
}

func TestSelectDeltaKeepsNothingWhenNothingRelevantChanged(t *testing.T) {
	got := selectDelta(report(), []string{"README.md"})

	if len(got.Tests) != 0 || len(got.Results) != 0 {
		t.Fatalf("unrelated change should select no tests, got %v", ids(got.Tests))
	}
}

func TestSelectDeltaUnionsBothReasonsWithoutDuplicating(t *testing.T) {
	// t1 qualifies by its own file AND by its coverage; it must appear once.
	got := selectDelta(report(), []string{"src/a.test.ts", "src/a.ts", "src/touched.ts"})

	if want := []string{"t1", "t2"}; !reflect.DeepEqual(ids(got.Tests), want) {
		t.Fatalf("tests = %v, want %v", ids(got.Tests), want)
	}
}

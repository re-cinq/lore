package main

import (
	"encoding/json"
	"testing"
)

func TestChunkReportSplitsAndPreservesEveryItem(t *testing.T) {
	report := TestReport{
		Commit: "c", Branch: "b",
		Tests: []TestDescriptor{
			{ID: "a", Name: "a", File: "f"},
			{ID: "b", Name: "b", File: "f"},
			{ID: "c", Name: "c", File: "g"},
		},
		Results: []TaggedRunResult{
			{ID: "a", Passed: true},
			{ID: "b", Passed: true},
			{ID: "c", Passed: false},
		},
	}

	chunks := chunkReport(report, 200)
	if len(chunks) < 2 {
		t.Fatalf("expected a split at 200 bytes, got %d chunk(s)", len(chunks))
	}
	tests, results := 0, 0
	for _, c := range chunks {
		if c.Commit != "c" || c.Branch != "b" {
			t.Errorf("chunk dropped commit/branch: %+v", c)
		}
		b, _ := json.Marshal(c)
		if len(b) > 200 && len(c.Tests) > 1 {
			t.Errorf("chunk exceeds max with >1 item (%d bytes)", len(b))
		}
		tests += len(c.Tests)
		results += len(c.Results)
	}
	if tests != 3 || results != 3 {
		t.Errorf("items lost across chunks: tests=%d results=%d, want 3/3", tests, results)
	}
}

func TestChunkReportKeepsSingleChunkUnderMax(t *testing.T) {
	report := TestReport{
		Commit: "c", Branch: "b",
		Tests:   []TestDescriptor{{ID: "a", Name: "a", File: "f"}},
		Results: []TaggedRunResult{{ID: "a", Passed: true}},
	}
	if got := chunkReport(report, 100000); len(got) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(got))
	}
}

package main

import (
	"context"
	"encoding/json"
	"io"
	"reflect"
	"strings"
	"testing"
)

func nativeTest(id, status string, line int) TestDescriptor {
	runnerID, _ := json.Marshal([]string{"src/a.test.ts", "node", id})
	expectedFailure := false
	return TestDescriptor{
		ID: id, Name: id, File: "src/a.test.ts", RunnerID: string(runnerID),
		StartLine: &line,
		Execution: &TestExecution{
			Status: status, Location: &TestLocation{Line: line, Column: 3},
			ExpectedFailure: &expectedFailure,
		},
	}
}

func printfJSON(t *testing.T, value interface{}) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return "printf '%s' '" + strings.ReplaceAll(string(encoded), "'", "'\\''") + "'"
}

func buildNativeReport(t *testing.T, discovered []TestDescriptor, run RunResult) TestReport {
	t.Helper()
	m := Manifest{
		List:           printfJSON(t, discovered),
		Run:            printfJSON(t, run) + " # {selector}",
		CoverageFormat: "json", Cwd: ".",
	}
	report, err := buildReport(context.Background(), m, t.TempDir(), reportMeta{Commit: "abc", Branch: "main"}, everyTest, 2, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	return report
}

func TestBuildReportKeepsNativePassedFailedSkippedAndPendingCases(t *testing.T) {
	discovered := []TestDescriptor{
		nativeTest("passed", "unknown", 2),
		nativeTest("failed", "unknown", 4),
		nativeTest("skipped", "unknown", 6),
		nativeTest("pending", "unknown", 8),
	}
	executed := []TestDescriptor{
		nativeTest("passed", "passed", 2),
		nativeTest("failed", "failed", 4),
		nativeTest("skipped", "skipped", 6),
		nativeTest("pending", "pending", 8),
	}
	report := buildNativeReport(t, discovered, RunResult{Passed: true, Tests: executed, Covered: []CoveredChunk{}})
	if !reflect.DeepEqual(report.Tests, executed) {
		t.Fatalf("native cases = %#v, want %#v", report.Tests, executed)
	}
	want := []TaggedRunResult{
		{ID: "passed", Passed: true, Covered: []CoveredChunk{}},
		{ID: "failed", Passed: false, Covered: []CoveredChunk{}},
	}
	if !reflect.DeepEqual(report.Results, want) {
		t.Fatalf("results = %#v, want %#v", report.Results, want)
	}
}

func TestBuildReportDoesNotUpgradeLegacyFileSuccessOrDiscoveryClaims(t *testing.T) {
	discovered := []TestDescriptor{nativeTest("one", "passed", 2)}
	report := buildNativeReport(t, discovered, RunResult{Passed: true, Covered: []CoveredChunk{}})
	if got := report.Tests[0].Execution.Status; got != "unknown" {
		t.Fatalf("discovery status = %q, want unknown", got)
	}
	if len(report.Results) != 1 || !report.Results[0].Passed {
		t.Fatalf("legacy compatibility results = %#v", report.Results)
	}
}

func TestBuildReportRejectsIncompleteOrAmbiguousNativeSnapshots(t *testing.T) {
	for _, scenario := range []string{"missing", "extra", "duplicate", "name", "file", "line", "column", "runner-id"} {
		t.Run(scenario, func(t *testing.T) {
			discovered := []TestDescriptor{nativeTest("one", "unknown", 2), nativeTest("two", "unknown", 4)}
			executed := []TestDescriptor{nativeTest("one", "passed", 2), nativeTest("two", "passed", 4)}
			switch scenario {
			case "missing":
				executed = executed[:1]
			case "extra":
				executed = append(executed, nativeTest("three", "passed", 6))
			case "duplicate":
				executed[1].RunnerID = executed[0].RunnerID
			case "name":
				executed[1].Name = "another test"
			case "file":
				executed[1].File = "src/another.test.ts"
			case "line":
				executed[1].Execution.Location.Line = 5
			case "column":
				executed[1].Execution.Location.Column = 8
			case "runner-id":
				executed[1].RunnerID = "invented"
			}
			report := buildNativeReport(t, discovered, RunResult{Passed: true, Tests: executed})
			for _, descriptor := range report.Tests {
				if descriptor.Execution == nil || descriptor.Execution.Status != "unknown" {
					t.Fatalf("%s preserved proof for %#v", scenario, descriptor)
				}
			}
			if len(report.Results) != 0 {
				t.Fatalf("%s invented execution outcomes: %#v", scenario, report.Results)
			}
		})
	}
}

func TestBuildReportRetainsCasesWithTheSameLegacyID(t *testing.T) {
	discovered := []TestDescriptor{nativeTest("first", "unknown", 2), nativeTest("second", "unknown", 4)}
	executed := []TestDescriptor{nativeTest("first", "passed", 2), nativeTest("second", "failed", 4)}
	for index := range discovered {
		discovered[index].ID = "same-title"
		executed[index].ID = "same-title"
	}
	report := buildNativeReport(t, discovered, RunResult{Tests: executed})
	want := []TaggedRunResult{{ID: "same-title", Passed: false, Covered: []CoveredChunk{}}}
	if !reflect.DeepEqual(report.Tests, executed) || !reflect.DeepEqual(report.Results, want) {
		t.Fatalf("duplicate legacy ids lost native identity: %#v", report)
	}
}

func TestBuildReportRetainsNativeSnapshotFromRunMany(t *testing.T) {
	discovered := []TestDescriptor{nativeTest("one", "unknown", 2), nativeTest("two", "unknown", 2)}
	executed := []TestDescriptor{nativeTest("one", "passed", 2), nativeTest("two", "skipped", 2)}
	m := Manifest{
		List:           printfJSON(t, discovered),
		Run:            "exit 1 # {selector}",
		RunMany:        "cat >/dev/null; " + printfJSON(t, map[string]RunResult{"src/a.test.ts": {Passed: true, Tests: executed}}),
		CoverageFormat: "json", Cwd: ".",
	}
	report, err := buildReport(context.Background(), m, t.TempDir(), reportMeta{}, everyTest, 2, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(report.Tests, executed) || len(report.Results) != 1 || report.Results[0].ID != "one" {
		t.Fatalf("run_many changed native cases: %#v", report)
	}
}

func TestBuildReportKeepsAmbiguousSkippedLegacyOutcomesUnproven(t *testing.T) {
	discovered := []TestDescriptor{nativeTest("first", "unknown", 2), nativeTest("second", "unknown", 4)}
	executed := []TestDescriptor{nativeTest("first", "passed", 2), nativeTest("second", "skipped", 4)}
	for index := range discovered {
		discovered[index].ID = "same-title"
		executed[index].ID = "same-title"
	}
	report := buildNativeReport(t, discovered, RunResult{Passed: true, Tests: executed})
	if !reflect.DeepEqual(report.Tests, executed) || len(report.Results) != 0 {
		t.Fatalf("skipped legacy collision acquired a pass: %#v", report)
	}
}

func TestBuildReportTreatsMissingExecutionAndExpectedFailureAsUnknown(t *testing.T) {
	for _, scenario := range []string{"execution", "expected-failure", "status"} {
		t.Run(scenario, func(t *testing.T) {
			discovered := []TestDescriptor{nativeTest("one", "unknown", 2)}
			executed := []TestDescriptor{nativeTest("one", "passed", 2)}
			switch scenario {
			case "execution":
				executed[0].Execution = nil
			case "expected-failure":
				executed[0].Execution.ExpectedFailure = nil
			case "status":
				executed[0].Execution.Status = "successful"
			}
			report := buildNativeReport(t, discovered, RunResult{Passed: true, Tests: executed})
			if report.Tests[0].Execution.Status != "unknown" || len(report.Results) != 0 {
				t.Fatalf("malformed execution became proof: %#v", report)
			}
		})
	}
}

func TestNativeExecutionSurvivesReportJSON(t *testing.T) {
	expectedFailure := true
	descriptor := nativeTest("one", "passed", 2)
	descriptor.Spec = json.RawMessage(`["specs/widget/spec.md#1","specs/widget/spec.md#2"]`)
	descriptor.Execution.ExpectedFailure = &expectedFailure
	executed := descriptor
	executed.Spec = nil
	report := buildNativeReport(t, []TestDescriptor{descriptor}, RunResult{Tests: []TestDescriptor{executed}})
	if !reflect.DeepEqual(report.Tests[0].Spec, descriptor.Spec) {
		t.Fatalf("discovery spec anchors were lost: %#v", report.Tests[0])
	}
	encoded, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	var decoded TestReport
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(decoded.Tests, report.Tests) {
		t.Fatalf("native evidence changed in JSON: %s", encoded)
	}
}

func TestNativeFileCaseCountSurvivesJSONOnCompleteSnapshots(t *testing.T) {
	for _, count := range []int{0, 1} {
		descriptor := nativeTest("one", "passed", 2)
		descriptor.Execution.FileCaseCount = count
		report := buildNativeReport(t, []TestDescriptor{descriptor}, RunResult{Tests: []TestDescriptor{descriptor}})
		encoded, err := json.Marshal(report)
		if err != nil {
			t.Fatal(err)
		}
		var decoded TestReport
		if err := json.Unmarshal(encoded, &decoded); err != nil {
			t.Fatal(err)
		}
		if got := decoded.Tests[0].Execution.FileCaseCount; got != count {
			t.Fatalf("fileCaseCount = %d, want %d", got, count)
		}
		if count == 0 && strings.Contains(string(encoded), "fileCaseCount") {
			t.Fatalf("legacy execution acquired a count: %s", encoded)
		}
	}
}

func TestBuildReportUnknownNativeCountsMatchTheFinalWholeFileSnapshot(t *testing.T) {
	for _, scenario := range []string{"missing", "extra", "duplicate", "execution", "status", "runtime-count", "discovery-count", "no-cases"} {
		t.Run(scenario, func(t *testing.T) {
			discovered := []TestDescriptor{nativeTest("one", "unknown", 2), nativeTest("two", "unknown", 4)}
			executed := []TestDescriptor{nativeTest("one", "passed", 2), nativeTest("two", "passed", 4)}
			for index := range discovered {
				discovered[index].Execution.FileCaseCount = 2
				executed[index].Execution.FileCaseCount = 2
			}
			wantIDs := []string{"one", "two"}
			switch scenario {
			case "missing":
				executed = executed[:1]
				executed[0].Execution.FileCaseCount = 1
			case "extra":
				executed = append(executed, nativeTest("three", "failed", 6))
				for index := range executed {
					executed[index].Execution.FileCaseCount = 3
				}
				wantIDs = append(wantIDs, "three")
			case "duplicate":
				executed[1].RunnerID = executed[0].RunnerID
			case "execution":
				executed[1].Execution = nil
			case "status":
				executed[1].Execution.Status = "successful"
			case "runtime-count":
				executed[1].Execution.FileCaseCount = 3
			case "discovery-count":
				discovered[0].Execution.FileCaseCount = 3
			case "no-cases":
				executed = []TestDescriptor{}
			}
			report := buildNativeReport(t, discovered, RunResult{Passed: true, Tests: executed})
			var gotIDs []string
			for _, descriptor := range report.Tests {
				gotIDs = append(gotIDs, descriptor.ID)
				if descriptor.Execution == nil || descriptor.Execution.Status != "unknown" || descriptor.Execution.FileCaseCount != len(report.Tests) {
					t.Fatalf("%s retained proof or an inconsistent file count: %#v", scenario, descriptor)
				}
			}
			if !reflect.DeepEqual(gotIDs, wantIDs) || len(report.Results) != 0 {
				t.Fatalf("%s lost cases or retained outcomes: %#v", scenario, report)
			}
		})
	}
}

package main

import "slices"

func fileExecutionReport(file string, discovered []TestDescriptor, run *RunResult) ([]TestDescriptor, []TaggedRunResult) {
	unknown := unknownSnapshot(file, discovered, nil)
	if run == nil {
		return unknown, nil
	}
	covered := run.Covered
	if covered == nil {
		covered = []CoveredChunk{}
	}
	if run.Tests == nil {
		results := make([]TaggedRunResult, 0, len(unknown))
		for _, descriptor := range unknown {
			results = append(results, TaggedRunResult{ID: descriptor.ID, Passed: run.Passed, Covered: covered})
		}
		return unknown, results
	}
	matched, valid := matchNativeSnapshot(file, discovered, run.Tests)
	if !valid {
		return unknownSnapshot(file, discovered, run.Tests), nil
	}
	statuses := make(map[string][]string, len(matched))
	var order []string
	for _, descriptor := range matched {
		if _, seen := statuses[descriptor.ID]; !seen {
			order = append(order, descriptor.ID)
		}
		statuses[descriptor.ID] = append(statuses[descriptor.ID], descriptor.Execution.Status)
	}
	results := make([]TaggedRunResult, 0, len(matched))
	for _, id := range order {
		passed := !slices.ContainsFunc(statuses[id], func(status string) bool { return status != "passed" })
		if passed || slices.Contains(statuses[id], "failed") {
			results = append(results, TaggedRunResult{ID: id, Passed: passed, Covered: covered})
		}
	}
	return matched, results
}

func matchNativeSnapshot(file string, discovered, executed []TestDescriptor) ([]TestDescriptor, bool) {
	if len(discovered) != len(executed) {
		return nil, false
	}
	byRunnerID := make(map[string]TestDescriptor, len(executed))
	for _, descriptor := range executed {
		if descriptor.RunnerID == "" || descriptor.File != file || !validExecutionSnapshot(descriptor.Execution, len(executed)) {
			return nil, false
		}
		if _, duplicate := byRunnerID[descriptor.RunnerID]; duplicate {
			return nil, false
		}
		byRunnerID[descriptor.RunnerID] = descriptor
	}
	matched := make([]TestDescriptor, 0, len(discovered))
	for _, listed := range discovered {
		runtime, present := byRunnerID[listed.RunnerID]
		if !present || !snapshotCountMatches(listed.Execution, len(discovered)) || !sameNativeTest(listed, runtime) {
			return nil, false
		}
		delete(byRunnerID, listed.RunnerID)
		runtime.Spec = listed.Spec
		runtime.EndLine = listed.EndLine
		runtime.Passed = nil
		runtime.Execution = normalizedExecution(runtime.Execution)
		matched = append(matched, runtime)
	}
	return matched, len(byRunnerID) == 0
}

func sameNativeTest(listed, executed TestDescriptor) bool {
	if listed.ID != executed.ID || listed.Name != executed.Name || listed.File != executed.File || !slices.Equal(listed.Suite, executed.Suite) {
		return false
	}
	if listed.StartLine != nil && executed.Execution != nil && executed.Execution.Location != nil && *listed.StartLine != executed.Execution.Location.Line {
		return false
	}
	if listed.Execution == nil || listed.Execution.Location == nil {
		return true
	}
	return executed.Execution != nil && executed.Execution.Location != nil && *listed.Execution.Location == *executed.Execution.Location
}

func unknownSnapshot(file string, discovered, executed []TestDescriptor) []TestDescriptor {
	descriptors := make([]TestDescriptor, 0, len(discovered)+len(executed))
	seen := make(map[string]bool, len(discovered))
	for _, descriptor := range discovered {
		descriptors = append(descriptors, withoutExecutionProof(descriptor))
		seen[descriptor.RunnerID] = true
	}
	for _, descriptor := range executed {
		if descriptor.File == file && !seen[descriptor.RunnerID] {
			descriptors = append(descriptors, withoutExecutionProof(descriptor))
			seen[descriptor.RunnerID] = true
		}
	}
	for index := range descriptors {
		if descriptors[index].Execution != nil {
			descriptors[index].Execution.FileCaseCount = len(descriptors)
		}
	}
	return descriptors
}

func snapshotCountMatches(execution *TestExecution, count int) bool {
	return execution == nil || execution.FileCaseCount == 0 || execution.FileCaseCount == count
}

func validExecutionSnapshot(execution *TestExecution, count int) bool {
	if execution == nil || execution.ExpectedFailure == nil || !snapshotCountMatches(execution, count) {
		return false
	}
	return slices.Contains([]string{"passed", "failed", "skipped", "pending", "unknown"}, execution.Status)
}

func withoutExecutionProof(descriptor TestDescriptor) TestDescriptor {
	if descriptor.RunnerID == "" {
		descriptor.Execution = nil
		return descriptor
	}
	descriptor.Execution = normalizedExecution(descriptor.Execution)
	descriptor.Execution.Status = "unknown"
	return descriptor
}

func normalizedExecution(execution *TestExecution) *TestExecution {
	expectedFailure := false
	unknown := &TestExecution{Status: "unknown", ExpectedFailure: &expectedFailure}
	if execution == nil {
		return unknown
	}
	checked := *execution
	if checked.ExpectedFailure == nil {
		checked.ExpectedFailure = &expectedFailure
		checked.Status = "unknown"
	}
	switch checked.Status {
	case "passed", "failed", "skipped", "pending", "unknown":
	default:
		checked.Status = "unknown"
	}
	if checked.Location != nil && (checked.Location.Line < 1 || checked.Location.Column < 1) {
		checked.Location = nil
	}
	return &checked
}

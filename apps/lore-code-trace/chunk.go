package main

import "encoding/json"

// chunkReport splits a report so each chunk's JSON stays under maxBytes (mirrors
// chunkTestReport in spec-trace-tools.ts). Packing is per test file, carrying
// each descriptor's matching result, so a file's tests never straddle two
// chunks: lore-api mirrors one Utopia item per test file, and a chunk holding
// part of a file would replace that item with the part. A single file larger
// than maxBytes is emitted as its own (over-size) chunk rather than dropped.
func chunkReport(r TestReport, maxBytes int) []TestReport {
	var chunks []TestReport
	cur := TestReport{Commit: r.Commit, Branch: r.Branch}
	for _, file := range reportByFile(r) {
		cand := TestReport{
			Commit:  r.Commit,
			Branch:  r.Branch,
			Tests:   append(append([]TestDescriptor{}, cur.Tests...), file.Tests...),
			Results: append(append([]TaggedRunResult{}, cur.Results...), file.Results...),
		}
		if jsonLen(cand) > maxBytes && len(cur.Tests) > 0 {
			chunks = append(chunks, cur)
			cur = TestReport{Commit: r.Commit, Branch: r.Branch, Tests: file.Tests, Results: file.Results}
		} else {
			cur = cand
		}
	}
	return append(chunks, cur)
}

// reportByFile groups the report's descriptors by test file, in the order each
// file first appears, each with the results of its descriptors.
func reportByFile(r TestReport) []TestReport {
	resultByID := make(map[string]TaggedRunResult, len(r.Results))
	for _, res := range r.Results {
		resultByID[res.ID] = res
	}

	indexByFile := map[string]int{}
	var files []TestReport
	for _, d := range r.Tests {
		at, seen := indexByFile[d.File]
		if !seen {
			at = len(files)
			indexByFile[d.File] = at
			files = append(files, TestReport{})
		}
		files[at].Tests = append(files[at].Tests, d)
		if res, hasRes := resultByID[d.ID]; hasRes {
			files[at].Results = append(files[at].Results, res)
		}
	}
	return files
}

func jsonLen(v any) int {
	b, _ := json.Marshal(v)
	return len(b)
}

package main

import "encoding/json"

// chunkReport splits a report so each chunk's JSON stays under maxBytes (mirrors
// chunkTestReport in spec-trace-tools.ts). Packing is per-descriptor, carrying
// each descriptor's matching result; a single item larger than maxBytes is
// emitted as its own (over-size) chunk rather than dropped.
func chunkReport(r TestReport, maxBytes int) []TestReport {
	resultByID := make(map[string]TaggedRunResult, len(r.Results))
	for _, res := range r.Results {
		resultByID[res.ID] = res
	}

	var chunks []TestReport
	cur := TestReport{Commit: r.Commit, Branch: r.Branch}
	for _, d := range r.Tests {
		res, hasRes := resultByID[d.ID]
		cand := TestReport{
			Commit:  r.Commit,
			Branch:  r.Branch,
			Tests:   append(append([]TestDescriptor{}, cur.Tests...), d),
			Results: append([]TaggedRunResult{}, cur.Results...),
		}
		if hasRes {
			cand.Results = append(cand.Results, res)
		}
		if jsonLen(cand) > maxBytes && len(cur.Tests) > 0 {
			chunks = append(chunks, cur)
			cur = TestReport{Commit: r.Commit, Branch: r.Branch, Tests: []TestDescriptor{d}}
			if hasRes {
				cur.Results = []TaggedRunResult{res}
			}
		} else {
			cur = cand
		}
	}
	return append(chunks, cur)
}

func jsonLen(v any) int {
	b, _ := json.Marshal(v)
	return len(b)
}

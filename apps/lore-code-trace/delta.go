package main

import (
	"strconv"
	"strings"
)

// The pure half of the incremental handshake (specs/ci-incremental-ingest FR5):
// read a diff, decide which tests the graph must re-absorb. No IO, so the
// selection rules are testable without a repository.

// parseNameStatus reads `git diff --name-status <base>..HEAD`. Each line is a
// status letter, a tab and a path; a rename (R<score>) carries BOTH paths and
// counts twice — the new path changed, and the old one is gone as far as the
// graph is concerned, so its subtree must be pruned.
func parseNameStatus(out string) (changed, deleted []string) {
	changed, deleted = []string{}, []string{}
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Split(strings.TrimSpace(line), "\t")
		if len(fields) < 2 || fields[0] == "" {
			continue
		}
		switch status := fields[0]; {
		case status == "D":
			deleted = append(deleted, unquotePath(fields[1]))
		case strings.HasPrefix(status, "R") && len(fields) >= 3:
			deleted = append(deleted, unquotePath(fields[1]))
			changed = append(changed, unquotePath(fields[2]))
		default:
			changed = append(changed, unquotePath(fields[1]))
		}
	}
	return changed, deleted
}

// selectDelta narrows a full report to the tests the changed paths affect:
// every test DECLARED in a changed file, plus every test whose coverage TOUCHES
// one. The second rule is file-granular on purpose — an edit shifts the line
// ranges of everything below it in the same file, so a test covering that file
// has stale ranges even when its own source did not move.
//
// Commit and branch survive: they identify the delta, not its contents.
func selectDelta(report TestReport, changed []string) TestReport {
	changedSet := make(map[string]struct{}, len(changed))
	for _, path := range changed {
		changedSet[path] = struct{}{}
	}

	resultByID := make(map[string]TaggedRunResult, len(report.Results))
	for _, result := range report.Results {
		resultByID[result.ID] = result
	}

	out := TestReport{
		Commit:  report.Commit,
		Branch:  report.Branch,
		Tests:   []TestDescriptor{},
		Results: []TaggedRunResult{},
	}
	for _, test := range report.Tests {
		result, hasResult := resultByID[test.ID]
		if !affected(test, result, hasResult, changedSet) {
			continue
		}
		out.Tests = append(out.Tests, test)
		if hasResult {
			out.Results = append(out.Results, result)
		}
	}
	return out
}

func affected(
	test TestDescriptor,
	result TaggedRunResult,
	hasResult bool,
	changed map[string]struct{},
) bool {
	if _, ok := changed[test.File]; ok {
		return true
	}
	if !hasResult {
		return false
	}
	for _, covered := range result.Covered {
		if _, ok := changed[covered.File]; ok {
			return true
		}
	}
	return false
}

// unquotePath undoes git's C-style quoting of a path with non-ASCII or control
// characters ("caf\303\251.test.ts"). The diff is run with core.quotePath=false
// so this rarely fires, but git still quotes control characters regardless —
// and a path left quoted never matches a descriptor's File, so its test would
// silently drop out of the delta. A path that fails to unquote is kept as-is
// rather than dropped.
func unquotePath(p string) string {
	if len(p) < 2 || p[0] != '"' {
		return p
	}
	if u, err := strconv.Unquote(p); err == nil {
		return u
	}
	return p
}

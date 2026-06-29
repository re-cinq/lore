package main

import (
	"regexp"
	"sort"
	"strconv"
)

// Faithful Go port of the lcov/cobertura parsers that used to live server-side in
// mcp-server's coverage.ts. Normalizing in the binary (where coverage is produced)
// means the server never parses coverage formats — it ingests canonical chunks only.

var (
	lcovRecordSep = regexp.MustCompile(`(?m)^end_of_record$`)
	lcovSF        = regexp.MustCompile(`(?m)^SF:(.+)$`)
	lcovDA        = regexp.MustCompile(`(?m)^DA:(\d+),(\d+)$`)
	cobClass      = regexp.MustCompile(`<class[^>]*\bfilename="([^"]+)"[^>]*>([\s\S]*?)</class>`)
	cobLine       = regexp.MustCompile(`<line\s+number="(\d+)"\s+hits="(\d+)"`)
)

// parseLcovCoverage aggregates every record's hit lines (DA with hits>0) into
// per-file ranges. Per-test (TN:) grouping is dropped — the binary's run is
// per-file, so coverage is the file's whole run.
func parseLcovCoverage(lcov string) []CoveredChunk {
	var chunks []CoveredChunk
	for _, record := range lcovRecordSep.Split(lcov, -1) {
		sf := lcovSF.FindStringSubmatch(record)
		if sf == nil {
			continue
		}
		var lines []int
		for _, da := range lcovDA.FindAllStringSubmatch(record, -1) {
			if hits, _ := strconv.Atoi(da[2]); hits > 0 {
				n, _ := strconv.Atoi(da[1])
				lines = append(lines, n)
			}
		}
		chunks = append(chunks, collapseRanges(sf[1], lines)...)
	}
	return chunks
}

func parseCoberturaCoverage(xml string) []CoveredChunk {
	var chunks []CoveredChunk
	for _, block := range cobClass.FindAllStringSubmatch(xml, -1) {
		var lines []int
		for _, ln := range cobLine.FindAllStringSubmatch(block[2], -1) {
			if hits, _ := strconv.Atoi(ln[2]); hits > 0 {
				n, _ := strconv.Atoi(ln[1])
				lines = append(lines, n)
			}
		}
		chunks = append(chunks, collapseRanges(block[1], lines)...)
	}
	return chunks
}

// collapseRanges sorts line numbers and merges contiguous runs into ranges.
func collapseRanges(file string, lines []int) []CoveredChunk {
	if len(lines) == 0 {
		return nil
	}
	sorted := append([]int(nil), lines...)
	sort.Ints(sorted)

	var ranges []CoveredChunk
	cur := CoveredChunk{File: file, StartLine: sorted[0], EndLine: sorted[0]}
	for _, line := range sorted[1:] {
		if line == cur.EndLine+1 {
			cur.EndLine = line
			continue
		}
		ranges = append(ranges, cur)
		cur = CoveredChunk{File: file, StartLine: line, EndLine: line}
	}
	return append(ranges, cur)
}

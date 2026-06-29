package main

import (
	"reflect"
	"testing"
)

func TestParseLcovCoverageKeepsHitLinesAndCollapsesRanges(t *testing.T) {
	lcov := "TN:t\nSF:src/a.go\nDA:1,1\nDA:2,1\nDA:3,0\nDA:5,2\nend_of_record\n"
	got := parseLcovCoverage(lcov)
	want := []CoveredChunk{
		{File: "src/a.go", StartLine: 1, EndLine: 2},
		{File: "src/a.go", StartLine: 5, EndLine: 5},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestParseCoberturaCoverageKeepsHitLines(t *testing.T) {
	xml := `<class filename="src/b.go"><lines>` +
		`<line number="1" hits="1"/><line number="2" hits="0"/><line number="3" hits="4"/>` +
		`</lines></class>`
	got := parseCoberturaCoverage(xml)
	want := []CoveredChunk{
		{File: "src/b.go", StartLine: 1, EndLine: 1},
		{File: "src/b.go", StartLine: 3, EndLine: 3},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestCollapseRangesSortsAndMergesContiguous(t *testing.T) {
	got := collapseRanges("f", []int{3, 1, 2, 7})
	want := []CoveredChunk{
		{File: "f", StartLine: 1, EndLine: 3},
		{File: "f", StartLine: 7, EndLine: 7},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

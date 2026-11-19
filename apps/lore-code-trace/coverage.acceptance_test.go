package main

import (
	"context"
	"io"
	"reflect"
	"testing"
	"time"
)

func TestParseCoberturaReversedAttributes(t *testing.T) {
	// A valid report containing <class filename="src/b.go"><lines><line hits="1" number="5"/></lines></class>
	// produces no covered chunks, although XML attribute order does not change the reported hit.
	xml := `<class filename="src/b.go"><lines><line hits="1" number="5"/></lines></class>`

	m := Manifest{
		CoverageFormat: "cobertura",
		Run:            "printf '%s' '" + xml + "'",
	}

	rr := runOneFile(context.Background(), m, "src/b.go", ".", 1*time.Second, io.Discard)

	if rr == nil {
		t.Fatalf("runOneFile returned nil")
	}

	want := []CoveredChunk{{File: "src/b.go", StartLine: 5, EndLine: 5}}
	if !reflect.DeepEqual(rr.Covered, want) {
		t.Errorf("got covered chunks %+v, want %+v", rr.Covered, want)
	}
}

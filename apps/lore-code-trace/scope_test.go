package main

import (
	"context"
	"io"
	"reflect"
	"testing"
)

func TestScopeForRunsEveryTestWithoutABase(t *testing.T) {
	m := Manifest{Related: `printf '%s' '["a_test.go"]' # {base}`, Cwd: "."}

	scope := scopeFor(context.Background(), m, t.TempDir(), "", io.Discard)

	if !scope.includes("b_test.go") {
		t.Error("a run with no base to diff against must cover every test file")
	}
}

func TestScopeForRunsEveryTestWhenTheManifestHasNoRelatedCommand(t *testing.T) {
	m := Manifest{Cwd: "."}

	scope := scopeFor(context.Background(), m, t.TempDir(), "abc123", io.Discard)

	if !scope.includes("b_test.go") {
		t.Error("a manifest without related must cover every test file")
	}
}

func TestScopeForNarrowsToTheFilesTheRelatedCommandPrints(t *testing.T) {
	m := Manifest{Related: `[ {base} = abc123 ] && printf '%s' '["src/a_test.go"]'`, Cwd: "."}

	scope := scopeFor(context.Background(), m, t.TempDir(), "abc123", io.Discard)

	got := []bool{scope.includes("src/a_test.go"), scope.includes("src/b_test.go")}
	if !reflect.DeepEqual(got, []bool{true, false}) {
		t.Errorf("includes(a, b) = %v, want [true false]", got)
	}
}

func TestScopeForRunsEveryTestWhenTheRelatedCommandPrintsNull(t *testing.T) {
	m := Manifest{Related: `printf null # {base}`, Cwd: "."}

	scope := scopeFor(context.Background(), m, t.TempDir(), "abc123", io.Discard)

	if !scope.includes("src/b_test.go") {
		t.Error("null from related means every test is affected")
	}
}

func TestScopeForRunsEveryTestWhenTheRelatedCommandFails(t *testing.T) {
	m := Manifest{Related: `exit 3 # {base}`, Cwd: "."}

	scope := scopeFor(context.Background(), m, t.TempDir(), "abc123", io.Discard)

	if !scope.includes("src/b_test.go") {
		t.Error("a failed related command must fall back to every test")
	}
}

func TestScopeForStripsThePathPrefixFromRelatedFiles(t *testing.T) {
	m := Manifest{Related: `printf '%s' '["pkg/src/a_test.go"]' # {base}`, Cwd: ".", PathPrefixStrip: "pkg"}

	scope := scopeFor(context.Background(), m, t.TempDir(), "abc123", io.Discard)

	if !scope.includes("src/a_test.go") {
		t.Error("related files must match descriptors after path_prefix_strip")
	}
}

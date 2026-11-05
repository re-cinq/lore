package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type anchorFixture struct {
	Line       string  `json:"line"`
	Normalized string  `json:"normalized"`
	Hash       *string `json:"hash"`
}

func TestAnchorHashMatchesTheFixturesLoreAndReLintShare(t *testing.T) {
	raw, err := os.ReadFile("../../libs/shared/src/domain/anchor-hash.fixtures.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []anchorFixture
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		if got := normalizeAnchorLine(fixture.Line); got != fixture.Normalized {
			t.Errorf("normalizeAnchorLine(%q) = %q, want %q", fixture.Line, got, fixture.Normalized)
		}
		hash, ok := anchorHashOf(fixture.Line)
		if fixture.Hash == nil && ok {
			t.Errorf("anchorHashOf(%q) = %q, want none", fixture.Line, hash)
		}
		if fixture.Hash != nil && hash != *fixture.Hash {
			t.Errorf("anchorHashOf(%q) = %q, want %q", fixture.Line, hash, *fixture.Hash)
		}
	}
}

func TestStampAnchorHashesHashesTheDeclarationLineAndSkipsAMissingFile(t *testing.T) {
	root := t.TempDir()
	declaration := `  it("adds numbers", () => {`
	if err := os.WriteFile(filepath.Join(root, "a.test.ts"), []byte("// one\n"+declaration+"\n});\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	two := 2
	tests := []TestDescriptor{
		{ID: "a", Name: "adds numbers", File: "a.test.ts", StartLine: &two},
		{ID: "b", Name: "gone", File: "gone.test.ts", StartLine: &two},
	}

	stampAnchorHashes(tests, root)

	want, _ := anchorHashOf(declaration)
	if tests[0].AnchorHash != want || tests[1].AnchorHash != "" {
		t.Errorf("stamped %q and %q, want %q and nothing", tests[0].AnchorHash, tests[1].AnchorHash, want)
	}
}

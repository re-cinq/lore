package main

import "testing"

func TestParseRepoFromRemote(t *testing.T) {
	cases := map[string]string{
		"git@github.com:re-cinq/lore.git":          "re-cinq/lore",
		"git@github.com:re-cinq/lore":              "re-cinq/lore",
		"https://github.com/re-cinq/lore.git":      "re-cinq/lore",
		"https://github.com/re-cinq/lore":          "re-cinq/lore",
		"ssh://git@github.com/re-cinq/lore.git":    "re-cinq/lore",
		"https://x@github.com/re-cinq/lore.git\n":  "re-cinq/lore",
	}
	for in, want := range cases {
		got, err := parseRepoFromRemote(in)
		if err != nil {
			t.Errorf("%q: unexpected error %v", in, err)
			continue
		}
		if got != want {
			t.Errorf("%q: got %q, want %q", in, got, want)
		}
	}
}

func TestParseRepoFromRemoteRejectsGarbage(t *testing.T) {
	if _, err := parseRepoFromRemote("not-a-remote-url"); err == nil {
		t.Fatal("expected an error for an unparseable remote")
	}
}

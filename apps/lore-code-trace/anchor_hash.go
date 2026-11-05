package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
)

// The content hash a spec link carries for the line it cites, the same as
// libs/shared/src/domain/anchor-hash.ts computes: lowercase the line, keep only
// a-z and 0-9, and take the first 8 hex characters of its sha256. A test's
// descriptor carries the hash of its declaration line, so lore-api binds a
// hashed spec link to the test it names wherever the test now sits.

const anchorHashLength = 8
const minHashable = 8

func normalizeAnchorLine(line string) string {
	var kept strings.Builder
	for _, char := range strings.ToLower(line) {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			kept.WriteRune(char)
		}
	}
	return kept.String()
}

// anchorHashOf answers false for a line too short to anchor, such as `});`.
func anchorHashOf(line string) (string, bool) {
	normalized := normalizeAnchorLine(line)
	if len(normalized) < minHashable {
		return "", false
	}
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])[:anchorHashLength], true
}

// stampAnchorHashes sets AnchorHash on every descriptor whose start line the
// file under root still holds. A file it cannot read leaves its tests unstamped:
// lore-api then binds them by line range, as before hashes.
func stampAnchorHashes(tests []TestDescriptor, root string) {
	lines := map[string][]string{}
	for index, test := range tests {
		if test.StartLine == nil {
			continue
		}
		fileLines, seen := lines[test.File]
		if !seen {
			content, err := os.ReadFile(filepath.Join(root, test.File))
			if err == nil {
				fileLines = strings.Split(string(content), "\n")
			}
			lines[test.File] = fileLines
		}
		line := *test.StartLine
		if line < 1 || line > len(fileLines) {
			continue
		}
		if hash, ok := anchorHashOf(fileLines[line-1]); ok {
			tests[index].AnchorHash = hash
		}
	}
}

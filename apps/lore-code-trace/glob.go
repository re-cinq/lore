package main

import (
	"path"
	"strings"
)

// The subset of minimatch that `.lore/ingest.yml` documents (`**`, `*`, `?`),
// matched segment by segment so this binary selects the same files the server's
// matchesAnyGlob (ingest-patterns.ts) does. Braces and negation are not
// supported: neither is documented for the manifest.

func matchesAnyGlob(filePath string, patterns []string) bool {
	for _, pattern := range patterns {
		if globMatch(pattern, filePath) {
			return true
		}
	}
	return false
}

func globMatch(pattern, filePath string) bool {
	return matchSegments(strings.Split(pattern, "/"), strings.Split(filePath, "/"))
}

func matchSegments(pattern, segments []string) bool {
	if len(pattern) == 0 {
		return len(segments) == 0
	}
	if pattern[0] == "**" {
		return matchGlobstar(pattern[1:], segments)
	}
	if len(segments) == 0 || !matchSegment(pattern[0], segments[0]) {
		return false
	}
	return matchSegments(pattern[1:], segments[1:])
}

// matchGlobstar lets `**` swallow zero or more whole segments, none of them a
// dot-segment; a trailing `**` needs at least one segment to swallow.
func matchGlobstar(rest, segments []string) bool {
	if len(rest) == 0 {
		return len(segments) > 0 && noneHidden(segments)
	}
	for skipped := 0; skipped <= len(segments); skipped++ {
		if matchSegments(rest, segments[skipped:]) {
			return true
		}
		if skipped < len(segments) && isHidden(segments[skipped]) {
			return false
		}
	}
	return false
}

func matchSegment(pattern, segment string) bool {
	if isHidden(segment) && !isHidden(pattern) {
		return false
	}
	matched, err := path.Match(pattern, segment)
	return err == nil && matched
}

func isHidden(segment string) bool {
	return strings.HasPrefix(segment, ".")
}

func noneHidden(segments []string) bool {
	for _, segment := range segments {
		if isHidden(segment) {
			return false
		}
	}
	return true
}

package main

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// Manifest mirrors libs/shared/src/test-command-manifest.ts: the per-repo
// .lore/test-commands.yml that declares how to list and run the project's tests.
// Only Run is required — a whole-suite entry that runs whole declares just Run,
// with no List, no {selector}, and no CoverageFormat.
type Manifest struct {
	List            string `yaml:"list"`
	Run             string `yaml:"run"`
	CoverageFormat  string `yaml:"coverage_format"`
	Cwd             string `yaml:"cwd"`
	PathPrefixStrip string `yaml:"path_prefix_strip"`
}

var validCoverageFormats = map[string]bool{"lcov": true, "cobertura": true, "json": true}

// parseManifest decodes and validates a single test-commands manifest. A polyglot
// repo may declare a YAML array; as with the TS loader we take the first entry.
func parseManifest(data []byte) (Manifest, error) {
	var entries []Manifest
	if err := yaml.Unmarshal(data, &entries); err == nil && len(entries) > 0 {
		return validateManifest(entries[0])
	}
	var m Manifest
	if err := yaml.Unmarshal(data, &m); err != nil {
		return Manifest{}, fmt.Errorf("parsing test-commands manifest: %w", err)
	}
	return validateManifest(m)
}

// validateManifest mirrors the relaxed TS parser (#1604 / #1601): run is the only
// required field. A missing list, a run without {selector}, and an unknown
// coverage_format are all honest run-whole traits, not errors — an unknown
// coverage_format is cleared to empty rather than rejected.
func validateManifest(m Manifest) (Manifest, error) {
	if strings.TrimSpace(m.Run) == "" {
		return Manifest{}, fmt.Errorf("manifest: run command is required")
	}
	if !validCoverageFormats[m.CoverageFormat] {
		m.CoverageFormat = ""
	}
	if m.Cwd == "" {
		m.Cwd = "."
	}
	return m, nil
}

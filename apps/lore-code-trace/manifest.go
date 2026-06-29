package main

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// Manifest mirrors libs/shared/src/test-command-manifest.ts: the per-repo
// .lore/test-commands.yml that declares how to list and run the project's tests.
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

func validateManifest(m Manifest) (Manifest, error) {
	if strings.TrimSpace(m.List) == "" {
		return Manifest{}, fmt.Errorf("manifest: list command is required")
	}
	if strings.TrimSpace(m.Run) == "" {
		return Manifest{}, fmt.Errorf("manifest: run command is required")
	}
	if !strings.Contains(m.Run, "{selector}") {
		return Manifest{}, fmt.Errorf("manifest: run command must contain the {selector} placeholder")
	}
	if !validCoverageFormats[m.CoverageFormat] {
		return Manifest{}, fmt.Errorf("manifest: coverage_format must be lcov|cobertura|json, got %q", m.CoverageFormat)
	}
	if m.Cwd == "" {
		m.Cwd = "."
	}
	return m, nil
}

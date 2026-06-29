package main

import (
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

// matches the trailing owner/repo of an SSH or HTTPS git remote, with optional
// `.git` suffix and trailing slash.
var remoteRe = regexp.MustCompile(`[:/]([^/:]+)/([^/]+?)(?:\.git)?/?$`)

func parseRepoFromRemote(url string) (string, error) {
	m := remoteRe.FindStringSubmatch(strings.TrimSpace(url))
	if m == nil {
		return "", fmt.Errorf("could not parse owner/repo from remote %q", url)
	}
	return m[1] + "/" + m[2], nil
}

func gitOutput(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git %s: %w", strings.Join(args, " "), err)
	}
	return strings.TrimSpace(string(out)), nil
}

// gitMeta reads commit, branch, and owner/repo (from origin) for the report.
func gitMeta(dir string) (commit, branch, repo string, err error) {
	if commit, err = gitOutput(dir, "rev-parse", "HEAD"); err != nil {
		return
	}
	if branch, err = gitOutput(dir, "rev-parse", "--abbrev-ref", "HEAD"); err != nil {
		return
	}
	remote, err := gitOutput(dir, "config", "--get", "remote.origin.url")
	if err != nil {
		return "", "", "", err
	}
	repo, err = parseRepoFromRemote(remote)
	return
}

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

// commitReachable reports whether sha is in this checkout's history — false
// after a force-push or from an over-shallow clone, either of which makes the
// recorded state unusable as a diff basis.
func commitReachable(dir, sha string) bool {
	cmd := exec.Command("git", "merge-base", "--is-ancestor", sha, "HEAD")
	cmd.Dir = dir
	return cmd.Run() == nil
}

// changedSince lists paths changed and deleted between base and HEAD.
func changedSince(dir, base string) (changed, deleted []string, err error) {
	out, err := gitOutput(dir, "diff", "--name-status", base+"..HEAD")
	if err != nil {
		return nil, nil, err
	}
	changed, deleted = parseNameStatus(out)
	return changed, deleted, nil
}

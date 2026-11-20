---
name: lore-review
description: Run Lore’s one-story code review locally on working changes, a branch comparison, or a checked-out pull request. Use when a developer wants the story the tests tell, the gaps the implementation and the issue leave against it, and a proposed change for each gap, before or after opening a pull request.
---

# Review a local change

Return the report in the conversation. The review is made by the installed Lore runner, which runs the same three steps as the hosted review. First locate `$HOME/.re-cinq/lore/scripts/lore-review-readers.mjs`. If it is unavailable, report **Incomplete — the Lore runner is unavailable** and stop. Use read-only repository and GitHub operations. Keep temporary material outside the working tree. Leave publication, thread resolution and merge checks to the hosted reviewer.

## Fix the scope once

Use the requested comparison. With no arguments, review working changes if present, otherwise compare the current branch with the default branch. For a PR, verify its base and head and review the committed range from their merge base. For a branch, use its merge base with the requested target or the repository’s default branch. For working changes, capture the effective files against HEAD, including staged, unstaged and untracked nonignored files. Account for renames and deletions. Report what you compared.

## Write the snapshot

Write one JSON object in a private temporary directory:

- `files`: every changed code and test file, and the unchanged tests and fixtures of the changed code. Each entry has a repository-relative `path`, a `role` of `code` or `test`, and the `before` and `after` texts. Use null for an absent side and identical texts for an unchanged file. Add `"context": true` to an unchanged file that only uses the changed code; the runner then sends the lines around each use. Leave Markdown out.
- `discussion`: what was asked for, as entries with `source` (`issue`, `pull_request`, `issue_comment`, `pull_request_comment` or `review_thread`), `url` and `text`. With neither an issue nor a pull request, leave it empty.
- `specs`: the spec statements that bear on the change, as entries with `path`, `heading`, `version` (`removed` or `proposed` for a statement the change takes out or puts in, `existing` for a shipped statement that names a changed file) and `text`. Never a whole spec.

A file that holds code and its own tests cannot be split by the runner: report that as a limitation and review it yourself.

## Run the review

```sh
node "$HOME/.re-cinq/lore/scripts/lore-review-readers.mjs" < "$snapshot"
```

The runner tells the story from the tests alone, checks the implementation against it, then checks the issue, the discussion and the specs against it. Each step is a separate Claude Code process that sees only its own files. Pass `--model` only to try another model.

It prints one JSON object: `status`, `incomplete` (the steps that gave no answer), `comment` (the story and the gaps, as the hosted review would post it) and `review` (the verdict and one finding per gap, with its file, line and proposal). If `status` is `incomplete`, report **Incomplete**, name the steps, and stop: your own reading cannot fill in a missing step.

## Report

Show `comment` as it is. Then list each finding of `review` under its file and line with its proposal, and give the verdict: changes are requested for any gap but an untold behaviour. Do not add findings of your own to the story or the gaps; put anything else you noticed under a separate heading, marked as yours.

## Help

<!-- lore-help:begin -->
**Summary.** Review a local change as one story told by its tests, with the gaps against the implementation and the issue and a proposed change for each.
**Usage:** `/lore-review`, `/lore-review <base>...<head>`, or `/lore-review <checked-out PR>`
<!-- lore-help:end -->

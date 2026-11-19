---
name: lore-review
description: Run Lore’s five-pass code review locally on working changes, a branch comparison, or a checked-out pull request. Use when a developer wants independent code and test readings, a comparison with intent, concrete test gaps and a product verdict.
---

# Review a local change

Return the report in the conversation. This command requires the three independent readings produced by the installed Lore runner. First locate `$HOME/.re-cinq/lore/scripts/lore-review-readers.mjs`. If it is unavailable, report **Incomplete — independent readers unavailable** and stop. Use read-only repository and GitHub operations. Keep temporary material outside the working tree. Leave publication, thread resolution and merge checks to the hosted reviewer.

## Fix the scope once

Use the requested comparison. With no arguments, review working changes if present, otherwise compare the current branch with the default branch. For a PR, verify its base and head and review the committed range from their merge base. For a branch, use its merge base with the requested target or the repository’s default branch. For working changes, capture the effective files against HEAD, including staged, unstaged and untracked nonignored files. Account for renames and deletions. Report what you compared. Read blobs at the recorded revisions. Capture working copies used as evidence once and reuse those bytes across passes. If the working files change before capture completes, repeat the capture.

## Give each independent reader only its evidence

The coordinator can read the checkout. Group the eligible changes by behavior and assign every changed file, including independent changes on a mixed PR. Find relevant unchanged consumers, registrations, tests and fixtures in the same snapshot. Filter both sides of a rename, diffs, surrounding source and follow-up reads by the receiving pass. Omit repository Markdown, issue-derived briefs, prior reviews and commit messages from blind packets. Split colocated test and implementation regions before sending them. Record ambiguous or unsplittable evidence as a limitation.

Write the selected snapshot as JSON in a private temporary directory. The input object has a `files` array. Each entry has a repository-relative `path`, a `role` of `code` or `test` and the `before` and `after` texts. Use null for an absent side or identical texts for an unchanged caller or fixture. Represent a rename crossing roles as a deletion and an addition. For mixed files supply separately filtered regions at their original line positions. Exclude conversation, issue text and filenames used only to hold instructions. Treat inaccessible material evidence as incomplete.

Execute the installed runner on this snapshot. It invokes the `lore-review-files` skill in three independent Claude Code processes with restricted mode, no tools, MCP, checkout instructions or shared history. Use `--reader-model` and `--reader-effort` only when selecting a configuration for the first two passes.

```sh
node "$HOME/.re-cinq/lore/scripts/lore-review-readers.mjs" < "$snapshot"
```

Use the runner’s JSON output. For a material follow-up request, add eligible files from the same snapshot, rerun the readers, and retain the original readings. If execution fails, the final status is incomplete, or a reading is missing, stop with **Incomplete** as the sole verdict. Identify the missing pass and retain any available readings. A coordinator’s own inspection cannot fill in a missing reading.

## Assemble the report

1. **Code.** Record the code reader’s two neutral sentences verbatim. With multiple groups, synthesize one two-sentence opening that covers independent changes and retain the group evidence. If the change contains only Markdown, record that there is no implementation to assess.
2. **Tests.** Record the test reading independently. Cite the assertions and their mock boundaries. Preserve both readings before comparing them with anyone’s description.
3. **Intent.** Compare the two readings with the linked issue and its comments, the PR title and body, conversation, inline threads and replies. Exclude Lore’s own summary as evidence of intent. An explicit scope decision in a reply matters. Verify a material discrepancy against its source or assertion. With neither a PR nor an issue, record that the intent comparison has no discussion evidence. Reserve repository documents for pass 5. Distinguish missing context from a failed lookup.
4. **Test gaps.** Use the independently recorded challenge. Check evidence outside the diff before reporting a missing test. Carry forward a concrete consequence and distinguishing assertion. Keep the original reading when another pass disagrees.
5. **Product.** Establish the relevant promises from the base specs and agreed scope first. Then compare them with the two readings and verified findings. Distinguish promises in the base revision from proposed spec edits. Verify specific source when needed. Name the affected user or workflow and any shipped promise at risk. Surface an unresolved product decision as a question. When recommending a test, take the expected outcome from the agreed promise. The blind challenge can identify two distinguishable outcomes without knowing which is correct.

Lead with the two-sentence code reading. Include the test reading, verified differences from intent, material gaps, product questions and a local verdict. Combine findings about the same behavior while retaining distinct code fixes and test remedies. A verified defect, broken shipped promise, or material gap supported by the challenge evidence can warrant changes. An unanswered question or deferred goal alone is advisory. An incomplete required pass yields an incomplete verdict.

## Help

<!-- lore-help:begin -->
**Summary.** Review a local change in five passes and get a report before or after opening a PR.
**Usage:** `/lore-review`, `/lore-review <base>...<head>`, or `/lore-review <checked-out PR>`
**Related:** `/lore-review-files`
<!-- lore-help:end -->

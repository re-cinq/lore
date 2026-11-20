---
adr_number: 55
title: "A public mirror is published by fast-forward"
status: in progress
date: 2026-11-20
deciders: ["Platform Engineering"]
domains: [release, github, ci, security]
---

# ADR-055: A public mirror is published by fast-forward

**Status**: Accepted on 2026-11-20
**Date**: 2026-11-20
**Deciders**: Platform Engineering

---

## Context

Security work has to happen in a private repository, and the code, the images and the release notes still have to reach people outside as versioned releases. The private repository's `main` is therefore published to a public repository, the mirror. The mirror holds what the private repository holds, so it also holds `.github/workflows/`, and those workflows must not do on the mirror what they do here: commit to `main`, release a second time, or post to Lore.

(ADR-054 is taken by a pull request that has not merged, so this record is ADR-055.)

## Decision

- One Actions variable, `LORE_MIRROR`, set to `true` on the public repository only, switches its workflows off. Every job of every workflow that a push, a tag, a schedule, a `workflow_run` or a release starts carries `vars.LORE_MIRROR != 'true'` in its `if`, alone or and-ed with the job's own condition, including a job that calls a reusable workflow. ([validated by every job of every workflow that push, schedule, workflow_run, release or a tag starts carries the LORE_MIRROR guard @4a1fd44e](../scripts/ci/mirror-guards.test.mjs#L211))
- The version is stamped at package time. `scripts/ci/package-install-chart.sh` writes the released version into the five image tags of the staged copy of `deploy/install/values.yaml`, so no commit is needed before a release tag. ([validated by stamping v9.8.7 sets the four image tags and the agent image to v9.8.7 @14a2fcc8](../scripts/ci/install-pins.test.mjs#L74))
- The pin check reads the packaged archive and nothing else. ([validated by the pin check passes on an archive stamped v9.8.7 for v9.8.7, with no checkout around it @56adb41d](../scripts/ci/install-pins.test.mjs#L104))
- The release workflow completes a GitHub Release that already exists, which the automated release line may have created with the summary, by appending the chart and image lines to its body, and creates the release when there is none. ([validated by the release job appends to a release that exists, creates one otherwise and keeps --verify-tag @7e019b21](../scripts/ci/deploy-workflows.test.mjs#L122))

## Rationale

The decisions of the release story that this repository's tests do not reach, because the release line and the push live in Lore's services:

- The public repository's `main` is the private repository's `main`: the same commits, moved by fast-forward and never forced. A public `main` that is not an ancestor of the private one fails the release and is never overwritten.
- Everything on the private `main` is published. There is no approval gate between the two.
- Images are built once, in the private repository. A release tags the digests our own cluster runs, and nothing is built from the public repository.

Why:

A fast-forward keeps one history. A force push would let a mistake on the public side be repaired by rewriting it, and would hide the difference between what was published and what was meant to be. Publishing everything keeps the rule small: the private repository is the place to hold work back, not a second review of what to publish. A variable is the least a workflow can read without a file that differs between the two repositories, since a file that differs is a commit that cannot be fast-forwarded.

## Consequences

- Commit messages, branch names in merge commits and `#123` references become public with the commit. A `#123` in a private message links to an unrelated public issue or pull request.
- A commit made on the public repository, by a person or by a workflow, blocks the next release until someone reconciles the two histories by hand. This is why every job that commits there is guarded.
- The first release publishes everything on the private `main`, history included. A secret scan comes before it.
- A release tag pushed to the public repository runs no release workflow there; the one run is the private repository's.
- `lore-ingest.yml` carries no guard: its content is the template Lore installs in every onboarded repo, so guarding it means a new template version for all of them. Until that is decided, the workflow is disabled in the public repository's Actions settings as a rollout step.
- The install guide names no version: its commands install the latest release, and a reader who wants another adds `--version`.

## Amendment 2026-11-20: commits flow both ways

Every commit on the public repository's `main` also arrives on the private repository's `main`; only the two default branches matter.

- The private default branch is the only place where the two histories are merged. Lore never pushes to it.
- When the public `main` holds commits the private `main` lacks, Lore copies the public `main` to the branch `sync/public-main` of the private repository, fast-forward only, and keeps one pull request open from it into the default branch. That pull request goes through the private repository's normal CI and review.
- It is merged with a merge commit. A squash or a rebase makes new commits, so the public head is still not an ancestor of the private `main` and the next release cannot fast-forward the public repository. When Lore finds the newest sync pull request merged that way, it comments once on it and opens a new one.
- A sync branch that holds commits the public `main` lacks is reported and left alone, never forced.
- The sync runs on the release tick's 15 minutes, at once on a push to the mirror's default branch (the one event of a mirror the stations drain no longer drops), and when a release finds the public `main` diverged, whose failure then names the sync pull request.
- The rest of the decision stands: the release still fast-forwards the public `main` to the private head and never forces it. After a merge commit the public head is an ancestor of the private `main`, so that fast-forward succeeds.


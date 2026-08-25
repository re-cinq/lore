#!/usr/bin/env bash
# Is this captured `helm upgrade` stderr the release lock, or a real failure?
#
# Reads stderr on stdin. Exit 0 = contention, retry. Exit 1 = a genuine failure
# the caller must surface.
#
# Its own file so it can be tested: the classification decides whether a deploy
# retries or is abandoned, and getting it wrong is silent. On 2026-08-25 it did
# get it wrong — `release: already exists` was read as a hard failure, the
# event-router deploy was abandoned while floor and stations shipped, and both
# crash-looped against a router that lacked the routes they had just started
# calling.
#
# Three spellings, one condition — another deploy holds the release:
#   - "another operation (install/upgrade/rollback) is in progress"
#     the plain lock, seen when helm takes the upgrade path.
#   - "release: already exists"
#     `--install` racing: helm reads a release with no DEPLOYED revision (the
#     other deploy's pending one), chooses INSTALL, and then finds it there.
#   - "cannot re-use a name that is still in use"
#     the older phrasing of the same collision.
set -euo pipefail

grep -qiE \
  'another operation \(.*\) is in progress|release: already exists|cannot re-use a name that is still in use'

# Backlog audit: the 175 open `priority:medium` tickets

Audited on 2026-11-13 against main at `b9d5e99f2`. Every ticket was read
against the code by one of eight readers, one per group of related specs; a
sample of 15 verdicts was then checked by hand and all 15 held. The verdicts
are a reading of the source, not of production.

## Result

| Verdict | Tickets | Meaning | Proposed action |
|---|---|---|---|
| retired | 39 | asks for something deleted or replaced on purpose | close |
| done | 28 | acceptance criteria are met on main, with a test | close |
| duplicate | 7 | another open ticket asks for the same thing | close |
| needs a person | 17 | code exists; what is left is live evidence or a decision | take out of the loop's queue |
| spec text | 22 | the code is right, the spec is stale | one spec edit per spec |
| test only | 14 | behaviour exists; a test or link is missing | one ticket per spec, or spec upkeep |
| real | 48 | behaviour is missing or wrong | keep, as about 20 pieces of work |

**74 of the 175 can be closed today** with no work. Another 53 are not work
for the implementation loop (a person, or a spec edit, or a missing test).
**48 are real, and they are about 20 pieces of work, not 48.**

Of the 110 tickets still in the loop's queue, 43 are retired, done or
duplicate: the loop would have opened a pull request for each.

## Why the pull requests are small

- The tickets were cut one per spec statement, from specs whose feature was
  already built. A ticket whose remainder is "add behavioural proof" yields a
  pull request with one test and one spec link. Of the last 60 merged loop
  pull requests, 23 changed no production file.
- The same remainder was filed more than once. Dependency-aware merge ordering
  is three tickets (#2709, #3302, #3892), the flaky guard is four (#3654,
  #3655, #3636, #3678), and the loop built `recomputeSpecFile` and the
  test-name resolution twice each (#4482/#4485, #4477/#4478).
- Where one change would settle many tickets, no ticket asks for it. In the
  spec traceability graph, drift checking and evidence tiers are written and
  tested but nothing calls them from ingest; ten tickets sit around that one
  missing call, and the loop has been adding tests to the uncalled functions.

## The real work, grouped

| # | Work | Tickets | Note |
|---|---|---|---|
| 1 | Call drift checking and evidence tiers from ingest (`driftCheckFile`, `projectTraceLinks`, `deriveStatementStatus` have no production caller), store chunk embeddings, show the tier in the UI | #3628 #3629 #3630 #3631 #3632 #3633 #3641 #3645 | decide first whether drift severity and tiers are still wanted |
| 2 | Read provenance (`// lore:validates`, `Lore-Validates:`) during ingest | #3622 #3624 | same question as 1 |
| 3 | Flaky guard before a statement is marked `violated` | #3654 #3678 | one red run marks it today |
| 4 | Inbox: floor-run sources, hide handled items, prune sweep, details pane with actions, keyboard | #3365 #3366 #3368 #3370 #3371 | the one story that is plain unfinished feature work |
| 5 | Local task runner lifecycle: exit code ignored, cancel leaves the process group, a refused requeue reported as done, config limits not applied, statusline count | #3775 #3776 #3780 #3781 #3782 | worth it only if the local runner is still used |
| 6 | Read cache: a failed cache write fails the read, entries not shape-checked, gateway caches to disk | #3714 #3716 #3717 | |
| 7 | query-trace: empty document answer, `depth` advertised but dropped, callers output is raw JSON | #3786 #3793 #3794 | |
| 8 | Repo base image (setting, resolution, UI) | #3942 #3943 #3944 | not built at all; needs a product decision |
| 9 | Onboarding: `/api/repos/available` is called by the web UI and not served; repo picker | #3251 #3260 | draft PR #4260 adds the route |
| 10 | Auto-merge: a behind pull request is never updated; tick reads only the newest 100 runs | #2710 #3358 | #2710 needs the merge-commit or rebase choice |
| 11 | Implementation loop: merging a partial pull request closes its issue; `lore_next_ready_issue` ignores the loop's gates | #3733 #3724 | |
| 12 | OpenAPI: wrong contract on the agent-definition PUTs; run graph and trace shapes undeclared | #3759 #3926 | |
| 13 | Cobertura parser needs `number` before `hits` | #3627 | |
| 14 | One failing file blocks its whole doc-delta batch | #3637 | or record it as intended |
| 15 | Digest posts a failed refine's file | #3076 | |
| 16 | `/lore-help` only finds skills named `lore-*` | #2870 | |
| 17 | Raw log lines are trimmed | #3747 | |
| 18 | `seed-secrets.sh` stores a pasted PEM as its first line | #3950 | |
| 19 | Orphaned-test guard ignores the runner's exclude list | #1510 | hand-written |
| 20 | tdd-round reports green under red CI | #2056 | hand-written |
| 21 | No alert on the `lore-db` volume | #4194 | hand-written |

## Open pull requests this touches

- #4488 (draft) works on #3626, which is already done on main: close it.
- #4244 (draft) works on #3248, whose fix merged as #4240: close it.
- #4260 (draft) works on #3251 and #3260, both real: finish it.

## Proposed cleanup

1. Close the 74 retired, done and duplicate tickets, each with a one-line
   comment naming the evidence in the table below.
2. Remove `priority:medium` from the 17 that need a person, so the loop stops
   picking them; close the ones that only ask for evidence nobody will record.
3. For the 22 spec-text and 14 test-only tickets: one ticket per spec
   ("bring spec X in line with main and link its unlinked statements"), close
   the originals. Twenty specs are affected.
4. Rewrite the 48 real tickets as the work items above, one ticket each, and
   close the originals against them.
5. Close a story once no task under it is open: #2887, #3330, #3912 and #4009
   can go at once; #2960 (Dark Factory), #3740 (job log streaming) and #3961
   (collaborative planning) follow once their one or few leftovers are moved.

## Counts per story

| Story | Spec | Tickets | real | test only | spec text | needs a person | done | retired | duplicate |
|---|---|---|---|---|---|---|---|---|---|
| none | (hand-written) | 5 | 3 |  |  | 1 | 1 |  |  |
| #2691 | protected-branch-merge | 4 | 1 |  | 1 | 1 | 1 |  |  |
| #2861 | org-skills | 2 | 1 |  |  |  | 1 |  |  |
| #2887 | utopia-graph-mirror | 1 |  |  |  |  |  | 1 |  |
| #2908 | utopia-graph-mirror | 1 |  |  | 1 |  |  |  |  |
| #2942 | implementation-loop | 9 | 2 | 1 | 1 | 2 | 2 |  | 1 |
| #2960 | 6-dark-factory | 11 |  | 1 |  |  |  | 10 |  |
| #3023 | context-assembly | 2 |  | 1 |  |  | 1 |  |  |
| #3064 | daily-digest | 2 | 1 |  | 1 |  |  |  |  |
| #3115 | auto-review-loop | 7 |  |  |  | 1 | 4 | 2 |  |
| #3151 | shared-utilities | 2 |  | 2 |  |  |  |  |  |
| #3244 | 4-ux-repo-onboarding | 7 | 2 | 1 |  | 2 | 2 |  |  |
| #3284 | protected-branch-merge | 4 | 1 |  |  | 1 |  |  | 2 |
| #3321 | 7-feature-planning | 3 |  |  | 1 |  | 2 |  |  |
| #3330 | platform-infrastructure | 1 |  |  |  |  |  | 1 |  |
| #3359 | inbox | 5 | 5 |  |  |  |  |  |  |
| #3527 | page | 13 |  |  | 1 | 4 |  | 7 | 1 |
| #3595 | github-issue-dispatch | 1 |  |  | 1 |  |  |  |  |
| #3604 | spec-traceability-graph | 23 | 12 | 1 | 1 | 2 | 2 | 4 | 1 |
| #3646 | project-test-interface | 5 | 2 |  | 2 |  |  |  | 1 |
| #3711 | local-read-cache | 11 | 3 | 3 | 1 |  | 3 | 1 |  |
| #3740 | job-log-streaming | 7 | 1 |  |  |  |  | 6 |  |
| #3755 | lore-api-openapi | 5 | 2 | 1 |  | 1 |  |  | 1 |
| #3771 | local-task-runner | 11 | 5 | 1 | 3 | 2 |  |  |  |
| #3785 | query-trace-tool | 5 | 3 | 1 |  |  | 1 |  |  |
| #3795 | turn-level-transcript-store | 7 |  | 1 | 2 |  | 4 |  |  |
| #3912 | context-evals | 1 |  |  |  |  | 1 |  |  |
| #3934 | lore-agents | 7 | 3 |  | 2 |  | 1 | 1 |  |
| #3946 | eso-gitops | 3 | 1 |  |  |  |  | 2 |  |
| #3961 | collaborative-feature-planning | 8 |  |  | 4 |  |  | 4 |  |
| #4009 | loop-pause | 2 |  |  |  |  | 2 |  |  |
| **all** | | **175** | **48** | **14** | **22** | **17** | **28** | **39** | **7** |

## Every ticket

`P` marks a ticket the loop already parked (`lore:blocked`). "Earlier" is the late-October assessment from #3971.

### Hand-written tickets · (hand-written)

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #1510 Guard against test suites that no CI job runs | P | real | partial | scripts/check-orphaned-tests.mjs:122-131 (adds `${dir}/**`, never reads the runner's include/exclude) | A test a workspace's Vitest config excludes still counts as covered. |
| #2056 tdd-round still reports 'nothing left' under a red verdic... | P | real | partial | libs/shared/src/agent-defaults/loop-tdd-round.md:164-166, 238 (prompt rule only); apps/stations/src/work/pr-ready-check/decide-ci.ts:29,157 (guard one step later) | Nothing in code stops a round reporting green under red CI with the head unchanged; each case costs a round. |
| #4194 Alert when a database disk passes 80% (Utopia, lore-db) |  | real | - | #4165 added the alert for the `utopia` namespace only, later moved to the Utopia chart; no PrometheusRule in this repo | Nothing alerts on the `lore-db` volume. |
| #4057 lore-api logs 'source extraction switch: utopia answered ... |  | human-only | - | auto-setup.ts:238; "Utopia re.28: a write token manages its push sources (#4087)" | Check production lore-api logs that the 401 line stopped. |
| #4056 Utopia arm follow-ups: a widened item repeats its heading... |  | done | - | context-assembly-utopia-sections.ts:30,59-64; context-assembly-query-terms.ts:85; mirror-coverage.test.ts:248 |  |

### #2691 · protected-branch-merge

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #2710 T015: Base-drift update by merge commit | P | real | partial | libs/shared/src/outbound/project/lib/platform-github-pulls-write.ts:226,257 (rebase, called only from the implementation loop); apps/stations/src/blocked-reason/derivation.ts:40 | Neither auto-merge nor blocked-reason updates a behind PR; choose merge commit (spec) or rebase (code) first. |
| #2708 T019: Run page and PR list show the blocked reason | P | spec-fix | missing | apps/web-ui/src/app/assembly-runs/[id]/BlockedReasonBanner.tsx:21; apps/lore-api/src/transport/routes/auto-merge/auto-merge.ts:36 | No repo PR-list page exists; the Loops board shows the reason. Change protected-branch-merge/spec.md:98. |
| #2711 T020: Verify existing spec behavior |  | human-only | operational verification | package.json:7-18 | Record a full suite run on a pinned commit. |
| #2709 T014: Dependency-aware merge ordering | P | done | partial | apps/stations/src/outbound/task-ordering.ts:45-67,262; apps/stations/src/blocked-reason/dependency-aware-merge.acceptance.test.ts:97-201 (#4336) |  |

### #2861 · org-skills

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #2870 T009: Verify /lore-help integration with synced skills | P | real | partial | .claude/skills/lore-help/SKILL.md:34 and :163 (only `lore-*` dirs are scanned) | An org skill synced under a name not starting with `lore-` never shows in /lore-help's index, detail or routing; no test covers sync-to-help. |
| #2868 T007: Validate Help block in Skills UI | P | done | partial | apps/web-ui/src/app/skills/SkillForm.test.tsx:31; apps/web-ui/src/app/skills/actions.test.ts:40 |  |

### #2887 · utopia-graph-mirror

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #4060 T023: T023: Move existing bases to new schema | P | retired | - | specs/utopia-graph-mirror/spec.md:287 (one-off move ran 2026-10-23) |  |

### #2908 · utopia-graph-mirror

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #2911 T006: T006: Auto-setup Utopia on first ingest | P | spec-fix | partial | apps/lore-api/src/work/utopia/setup/setup.ts:33-40 (two writes, base row first, base write is an upsert) | Narrow FR6.4's "nothing is stored" to the settings, or wrap both writes in one transaction. |

### #2942 · implementation-loop

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3724 T027: Add lore_next_ready_issue MCP tool |  | real | partial | apps/mcp-server/src/transport/tools/repo/next-ready-issue.ts:52-62 | The preview ignores the loop switch, onboarding and busy-repo gates, so it can name an issue the loop would not pick. |
| #3733 T030: Close ticket on PR merge with Lore-Task footer |  | real | partial | libs/shared/src/work/backlog/loop-merge-success.ts:129 (`closeIssue` on every merge) | Merging a partial-coverage loop PR still closes its issue. |
| #3726 T029: Pull request title and body recomposition |  | trivial | partial | apps/stations/src/implementation-loop/mark-ready/station.test.ts:63,104,117 | implementation-loop/spec.md:267,269 carry no links. |
| #3700 T026: Fail build on missing prompt_ref and throw on missi... |  | spec-fix | superseded | specs/implementation-loop/spec.md:174 names `buildNodePrompt`, `prompt_ref` (gone with apps/floor) | Remove or rewrite spec line 174. |
| #2957 T015: Implement blocked ticket handling and dependency or... | P | human-only | partial | libs/shared/src/work/backlog/loop-run-closed.test.ts:162,206,300 | The empty-branch guard is the floor's; only a live run shows it. |
| #3736 T033: Targeted CI fix execution and unchanged sha guard |  | human-only | partial | floor-ci-wait.test.ts:247,275; decide-ci.test.ts:139 | Only a live floor run shows the model receives the brief. |
| #3725 T028: Traceability graph queries in agents |  | done | partial | libs/shared/src/agent-defaults/loop-fix-ci.md:136; agent-defaults-content.test.ts:232,274 |  |
| #3734 T031: Implement anchor-rot check for changed markdown |  | done | partial | eslint.config.mjs:668-672; agent-defaults-content.test.ts:232,274 |  |
| #3892 T036: Implement dependency-aware merge ordering in blocke... |  | duplicate of #2709 | missing | apps/stations/src/blocked-reason/station.ts:151,317 |  |

### #2960 · 6-dark-factory

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #2966 T006: Implement `shared/src/commit-trailers.ts` exporting... | P | trivial | partial | libs/shared/src/domain/commit-trailers.ts:70 (`Number.parseInt` accepts "2abc") | Strict iteration parsing plus a malformed-iteration test. |
| #2963 T003: Add scaffolding directory `agent/src/workflows/` wi... | P | retired | superseded | specs/6-dark-factory/spec.md (FR1.6a retired); no `agent/` directory |  |
| #2964 T004: Implement schema migration in `scripts/infra/setup-... | P | retired | superseded | migration 0096_remove_dark_factory_settings.sql |  |
| #2976 T016: Add Zod schema for `dark_factory.*` settings in `mc... | P | retired | superseded | Dark Factory settings schema removed |  |
| #2982 T022: Notification gate in `agent/src/lib/notify.ts` `dec... | P | retired | superseded | Dark Factory notify routing deleted |  |
| #2987 T027: Audit emission on takeover | P | retired | superseded | supervisor/lease takeover belonged to the old engine |  |
| #2991 T031: `agent/src/workflows/implementation.yaml` | P | retired | superseded | in-process workflow YAML and walker removed |  |
| #2997 T036: Approval-required tasks force Issue creation (deliv... | P | retired | superseded | `decideIssueCreate` removed with the worker |  |
| #3004 T043: Verify quickstart Scenario E passes | P | retired | superseded | Scenario E tests the retired supervisor line |  |
| #3013 T052: Dark Factory dashboard panel on `repos/[owner]/[rep... | P | retired | superseded | Dark Factory tab removed |  |
| #3021 T060: 14-day measured-results memo vs SC1–SC8 | P | retired | operational verification | pilot memo measured deleted settings; no cohort left |  |

### #3023 · context-assembly

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3029 T006: Implement loadTemplates() | P | trivial | partial | libs/shared/src/outbound/project/knowledge/context-assembly-templates.ts:68-82; libs/server-core/src/work/context/context-assembly.test.ts:61-72 (asserts nothing) | Tests for cached lookup, distinct templates, unknown-name fallback; strike `section.filter` from the spec. |
| #3728 T030: Extract distinctive terms for keyword and graph search |  | done | partial | libs/shared/src/domain/key-terms.ts:63; context-assembly-fetchers-social.ts:41 |  |

### #3064 · daily-digest

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3076 T012: Implement legacy refine agent logic | P | real | partial | apps/stations/src/digest/post/station.ts (`refinedOf` passes `exitCode: null`); libs/shared/src/work/digest/deliver-digest.ts:98-109 | If refine fails after writing digest.md, that file is posted; the agent's upload is never stripped of the appendix. |
| #3075 T011: Implement legacy cron tick handler | P | spec-fix | partial | apps/stations/src/work/digest-tick/run.ts:9-17 vs specs/daily-digest/spec.md:128 | Remove the "Postgres-walked line" promise for no-floor deployments. |

### #3115 · auto-review-loop

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3127 T012: End-to-end test | P | human-only | operational verification | apps/stations/src/events/floor-review-handlers.test.ts | Run issue → PR → review on the live floor and time it. |
| #3350 T035: Implement fallback and recheck conditions | P | done | partial | libs/shared/src/work/review/code-review-decisions.ts:31; auto-review-loop/spec.md:105,175 |  |
| #3698 T036: Implement autoReviewEnabled gate and loop integrations |  | done | partial | apps/stations/src/events/floor-review-handlers.ts; spec.md:99 |  |
| #3699 T037: Implement Loops tab UI for code-review and queues |  | done | needs review | loops/board/board.test.ts; LoopTable.test.tsx; routes/code-review/code-review.ts |  |
| #3896 T038: Implement code-review line overhaul and webhook plu... |  | done | partial | code-review-decisions.ts:25-31; auto-review-loop/spec.md:99-125 |  |
| #3118 T003: Add PR_NUMBER env var support to entrypoint | P | retired | superseded | specs/external-floor/spec.md:212; floor-review-start.ts |  |
| #3121 T006: Pass GH_TOKEN env to Job pod for `gh` CLI auth | P | retired | operational verification | LoreTask Job deleted; pod credentials are the floor's |  |

### #3151 · shared-utilities

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3810 T094: Implement project.integration.ts |  | trivial | verification required | libs/shared/src/outbound/project/lib/project.integration.test.ts:31,40; test-integration.yml:133-141 | Live-Postgres test always skips in CI. |
| #3945 T097: Implement auth.ts |  | trivial | verification required | apps/web-ui/src/lib/api/auth.ts:22; auth.test.ts:40 | Test where a hung fetch is aborted at the deadline. |

### #3244 · 4-ux-repo-onboarding

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3251 T007: Create fetching route | P | real | partial | apps/web-ui/src/lib/api/repos.ts:65 calls `/api/repos/available`; lore-api registers no such route; `getAvailableRepos` (apps/lore-api/src/work/repo/repo-onboard.ts:88) has no caller | Add the lore-api route. (draft PR #4260 adds routes/repos/available.ts) |
| #3260 T016: Create onboard page | P | real | partial | apps/web-ui/src/app/onboard/page.tsx:11-17 (free-text slug field) | Picker of App-installation repos (needs #3251). (draft PR #4260) |
| #3262 T018: Add merge detection | P | trivial | needs review | apps/stations/src/work/merge-check/merge-check.ts:67-84; merge-check.test.ts:4-15 | Service-level test of the sweep: merged, open, closed unmerged. |
| #3248 T004: Create repo-onboard module | P | human-only | partial | "Fix decideScaffoldCommit to refresh Lore-owned files when drifted (#4240)"; libs/shared/src/work/onboard/enrol-repo.test.ts:110 | Proof from one real onboarding run on the floor. (draft PR #4244 is on this ticket) |
| #3273 T029: Remove redundant pages | P | human-only | partial | apps/web-ui/src/app/settings/page.tsx; apps/web-ui/src/app/specs/ | Decide whether any global page is redundant; ticket target does not match its FR. |
| #3246 T002: Run schema DDL | P | done | operational verification | scripts/infra/setup-repos-schema.sh:5-20, run in CI by test-integration.yml:83 and migrations.yml:60 |  |
| #3277 T033: Build and push images | P | done | operational verification | .github/workflows/_build-image.yml; rolling deploy commits |  |

### #3284 · protected-branch-merge

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3358 T021: Implement the auto-merge loop and station | P | real | partial | apps/stations/src/work/auto-merge-tick/run.ts:57-63 (`RUNS_READ = 100`, no paging) | A PR whose auto-merge run is older than the newest 100 can be picked again. |
| #3294 T008: Demo the protected branch auto-merge prototype | P | human-only | operational verification | "Mark ADR-051 accepted with demo date (#4275)" (an agent set the date; nobody recorded the demo) | Run and record the throwaway-repo demo. |
| #3302 T014: Implement dependency-aware merge ordering | P | duplicate of #2709 | missing | #4336 says `Refs #3302`; dependency-aware-arming.acceptance.test.ts:66,100 |  |
| #3303 T015: Implement base-drift update | P | duplicate of #2710 | partial | platform-github-pulls-write.ts:257; protected-branch-merge/spec.md:124 |  |

### #3321 · 7-feature-planning

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3324 T003: Implement plan store contract for feature plans | P | spec-fix | - | specs/7-feature-planning/spec.md:219 (FR-4.7 describes the deleted wizard) | Mark FR-4.7 superseded by ADR-047. |
| #3325 T004: T004: Implement lore-api feature routes | P | done | - | plans/new/actions.ts:56-76; actions.acceptance.test.ts:41, :62 |  |
| #4074 T019: Implement collaborative plan creation and editing l... |  | done | - | plans/new/actions.ts:56-76; plan-engine-routes.test.ts:136-211; register-planning.ts:96-106 |  |

### #3330 · platform-infrastructure

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3337 T007: Wire lore-reviewer credentials through ESO | P | retired | operational verification | no terraform in this repo; ESO owned by re-cinq/infrastructure |  |

### #3359 · inbox

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3365 T006: Add floor run sources to Inbox | P | real | - | apps/lore-api/src/transport/routes/inbox/inbox.ts:85-104 (reads plans and repos only) | Floor-run sources (`spec_pr`, `triage`, `failed_run`); a floor outage as an unavailable source, not a 500. |
| #3366 T007: Filter Inbox list by user state | P | real | - | inbox.ts:55-70 never reads `lore.inbox_item_state` | Filter out items the caller handled or snoozed; counts after the filter. |
| #3368 T009: Add stale inbox state housekeeping sweep | P | real | - | no sweep references `inbox_item_state` | 30-day prune of state rows for items that no longer exist. |
| #3370 T011: Implement Inbox details pane and actions | P | real | - | apps/web-ui/src/app/inbox/InboxView.tsx (list only) | Details pane and per-kind actions. |
| #3371 T012: Add Inbox keyboard shortcuts and session handled list | P | real | - | InboxView.tsx has no key handlers | j/k/Enter/e shortcuts and the session-handled list with undo. |

### #3527 · page

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3561 T134: F-format-tolerance | P | spec-fix | partial | spec.md:489 vs :429 contradict on mid-statement links | Settle allowed link formats; make the two statements agree. |
| #3545 T118: Implement backfill PR opener | P | human-only | partial | apps/stations/src/spec-upkeep/open-pr/station.ts:37-41; platform-github-pulls-write.ts:113 | Decide which labels an upkeep PR must carry. |
| #3555 T128: Manual e2e verification | P | human-only | operational verification | apps/stations/src/spec-upkeep/ | A person walks the current UI and upkeep PR flow on a real repo. |
| #3556 T129: Confirm zero legacy writes | P | human-only | operational verification | migrations/0008_drop_v2_spec_coverage_tables.sql | Production evidence that 0008 ran and nothing external writes the old tables. |
| #3562 T135: F-local-on-demand | P | human-only | verification required | .claude/skills/lore-suggest-links/SKILL.md | Run the skill once on a real spec and record it. |
| #3539 T112: Build PR-comment emitter | P | retired | superseded | specs/spec-test-coverage/spec.md:429 (validate pass no longer scheduled) |  |
| #3540 T113: Rename trigger endpoint | P | retired | superseded | spec.md:429; no `spec-coverage-validate` trigger route in apps/lore-api |  |
| #3541 T114: Update ingest fan-out | P | retired | superseded | spec.md:429 (post-ingest trigger removed; `spec-links` PR check took over) |  |
| #3542 T115: Rename linker to backfill | P | retired | superseded | spec.md:431 (backfill replaced by `spec-upkeep`, FR14) |  |
| #3543 T116: Build proposeLinkInsertions | P | retired | superseded | spec.md:431; helper survives only in libs/shared/src/domain/spec-judge.ts |  |
| #3547 T120: Update cron helm configuration | P | retired | superseded | spec.md:429,431 (crons not scheduled) |  |
| #3558 T131: F-coverage-integration | P | retired | missing | spec.md:495 ("not v3 scope") |  |
| #3544 T117: Unit tests for proposeLinkInsertions | P | duplicate of #3543 | superseded | tests for #3543's helper |  |

### #3595 · github-issue-dispatch

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3823 T004: Queue labeled issues into repository backlog |  | spec-fix | partial | no issue comment in implementation-loop/open-pr/station.ts; github-issue-dispatch/spec.md:139-140 | Spec still promises a task-id comment and `github_issue_body`; delete the lines or decide to build them. |

### #3604 · spec-traceability-graph

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3622 T221: Implement provenance parsing | P | real | partial | libs/shared/src/work/spec-trace/provenance.ts:8,55,79 (called only from its test) | Ingest never reads `// lore:validates` annotations or `Lore-Validates:` trailers; conflicts never logged. |
| #3624 T223: Test provenance evidence tier | P | real | partial | libs/shared/src/work/spec-trace/trace-link.ts:125 (`upsertTraceLink` called only from tests) | Nothing produces `generated-provenance` or promotes a link on merge. Depends on #3622. |
| #3627 T232: Create coverage processor in lore-code-trace |  | real | partial | apps/lore-code-trace/coverage.go:18 (regex needs `number` before `hits`) | A Cobertura report with `hits` before `number` yields no coverage. |
| #3628 T233: Implement coverage verification tiering |  | real | partial | verify-coverage.ts:17 called only by trace-link.ts:29 `projectTraceLinks`, which has no non-test caller | Verification tier never persisted from real coverage ingest. |
| #3629 T240: Implement drift check |  | real | partial | drift-check-file.ts:81 (`driftCheckFile` called only from tests) | Call `driftCheckFile` from the code-delta ingest. |
| #3630 T241: Detect link rot |  | real | partial | drift-check-file.ts:81 (link-rot branch, same function) | Same wiring as #3629. |
| #3631 T242: Test evidence tier hierarchy |  | real | partial | statement-status.ts:9, trace-link.ts:29 (tests only) | Same wiring as #3628. |
| #3632 T243: Grade drift severity |  | real | partial | drift-check-file.ts:81; project-code-file.ts writes no `CodeChunk.embedding` | Severity never reaches the graph (#3629, #3633). |
| #3633 T250: Embed chunks and statements |  | real | partial | no embedding in project-code-file.ts or ingest-test-report-chunks.ts | Code/test chunk embeddings never stored; only consumer is drift severity. |
| #3637 T270: Implement spec-trace file ingest |  | real | partial | apps/lore-api/src/transport/routes/ingest/ingest-doc-delta.ts:164; ingest-delta.test.ts:668 | A file that always fails blocks later files in its batch; isolate per file or record whole-batch retry as intended. |
| #3641 T274: Display drift badges in UI |  | real | partial | apps/web-ui/src/lib/trace-types.ts:67 (boolean `drifted` only) | UI shows no evidence tier; drift badge cannot light from real data until #3629/#3631. |
| #3645 T283: Validate language-agnostic E2E flow |  | real | partial | language-agnostic-e2e.test.ts calls `driftCheckFile` directly | Production re-ingest to drift path does not exist. |
| #3643 T281: Assert graph determinism |  | trivial | partial | libs/shared/src/work/spec-trace/determinism.test.ts:84 | Update the replay test for File/Feature nodes. |
| #3639 T272: Add local trace CLIs |  | spec-fix | missing | package.json:30; apps/lore-code-trace/main.go | spec.md:129-131, :279 list npm trace scripts the Go CLI replaced. |
| #3642 T280: Ensure full suite green |  | human-only | operational verification | .github/workflows/pr-checks.yml | Confirm a green full-suite run on main. |
| #3644 T282: Validate core E2E flow |  | human-only | partial | spec.md:299 | Manual session, only after drift wiring exists. |
| #3614 T212: Test projection idempotence | P | done | verification required | libs/shared/src/work/spec-trace/projection-hash-gate.test.ts:138, :198; unchanged-children.test.ts:153 |  |
| #3626 T231: Test coverage idempotency |  | done | partial | libs/shared/src/work/spec-trace/ingest-test-report-skip.test.ts:150, :217; ingest-coverage.test.ts:180 | (draft PR #4488 works on this ticket) |
| #3634 T251: Suggest links via vectors |  | retired | superseded | spec-traceability-graph/spec.md:305 (`similar_to` suggester removed in #1802) |  |
| #3635 T252: Implement LLM legacy fallback |  | retired | needs review | spec.md:305; lore-suggest-links skill |  |
| #3638 T271: Trigger trace from post-ingest |  | retired | superseded | spec.md:387 (`ingest-graph` answers 410) |  |
| #3640 T273: Surface spec-drift issues |  | retired | partial | libs/shared/src/work/spec-upkeep/findings.ts:40 (drift feeds spec-upkeep) |  |
| #3636 T260: Consume test interface payloads |  | real (same as #3654) | needs review | libs/shared/src/work/spec-trace/ingest-test-report-groups.ts:209 | No flaky guard: one red run raises `violated`. |

### #3646 · project-test-interface

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3654 T322: Implement flaky guard before raising violated |  | real | - | libs/shared/src/work/spec-trace/ingest-test-report.ts:140-173 (one failing report writes `violated` at once) | Add the consecutive-failures / re-run guard before `violated` is set. |
| #3678 F-flaky-policy: Make the flaky-guard threshold (N / re-ru... |  | real | - | no guard to configure (see #3654) | After #3654, per-repo threshold. |
| #3669 T371: spec-violated issue surfacing (reuse formatBrokenL |  | spec-fix | - | libs/shared/src/work/spec-upkeep/spec-drift-rules.ts:71-95 | Rewrite project-test-interface/spec.md:296, :318 (no `spec-violated` issue any more). |
| #3671 T373: Edits |  | spec-fix | - | specs/coverage-ingestion/ deleted | project-test-interface/spec.md:338 and plan.md:9 name a file that is gone. |
| #3655 T323: Flaky guard |  | duplicate of #3654 | - | same guard |  |

### #3711 · local-read-cache

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3714 T003: Implement proxy cache core functionality |  | real | - | libs/server-core/src/outbound/proxy-cache.ts:62-70 (entry cast, never shape-checked); :197-210 (writes through a symlink) | Validate entry/config shapes, refuse symlink writes, make cache I/O failures non-fatal. |
| #3716 T005: Add withReadCache wrapper |  | real | - | libs/server-core/src/outbound/proxy.ts:119-140 (no catch around `store`/`readFresh`) | A failing cache write turns a successful proxied read into a rejection. |
| #3717 T006: Wire lore_assemble_context to read cache |  | real | - | assemble-context.ts wired through `withReadCache`; no LORE_CACHE_ENABLED override in deploy/ | The HTTP gateway caches to disk too, against spec AC1; a spec-fix if that is intended. |
| #3718 T007: Wire memory and graph reads to read cache |  | trivial | - | memory-cached-read.ts; query-graph.ts:35 | Tool-level test of a repeated read served from cache. |
| #3719 T008: Wire lore-query-trace to read cache |  | trivial | - | spec-trace/query-trace.ts; query-trace.test.ts:23-24 (cache disabled in test) | Test with the cache enabled. |
| #3721 T010: Invalidate cache on memory mutations |  | trivial | - | write-memory.ts:47; delete-memory.ts:30 | Tool-level test that a write clears memory reads. |
| #3722 T011: Invalidate cache on pipeline and repo mutations |  | spec-fix | - | task lists are not read-cached; ingest-files.ts:61 invalidates | Drop "create task → task lists" from spec AC10. |
| #3712 T001: Retain active /mcp route |  | done | - | apps/mcp-server/src/transport/http-transport.ts:129,178; http-transport.test.ts:80-107 |  |
| #3715 T004: Test proxy cache core |  | done | - | libs/server-core/src/outbound/proxy-cache.test.ts:48-157 |  |
| #3723 T012: Update tool cache docs |  | done | - | docs/mcp-tools.md:26-29, :39-43 |  |
| #3713 T002: Update http-server tests for /mcp removal |  | retired | - | contradicts #3712 (/mcp kept on purpose) |  |

### #3740 · job-log-streaming

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3747 T007: T007: Implement core agent log parsing |  | real | partial | apps/web-ui/src/lib/agent-log-entries.ts:48-66 (`line.trim()`) | Raw and unknown-JSON log lines lose leading/trailing whitespace; spec says verbatim. |
| #3741 T001: T001: Stream pod logs to controller |  | retired | superseded | LoreTask controller removed; floor owns logs |  |
| #3742 T002: T002: Store logs in task_events DB |  | retired | superseded | LoreTask watcher removed |  |
| #3743 T003: T003: Return failed init container log in podLog |  | retired | superseded | kube-pod-logs path removed with the cluster agent |  |
| #3744 T004: T004: Extract pod failure cause from logs |  | retired | superseded | pod failure-cause helper deleted with the cluster agent |  |
| #3745 T005: T005: Attach failure cause to Agent CR |  | retired | superseded | Agent CR and ai-agents controller removed |  |
| #3746 T006: T006: Record errorText on station run |  | retired | superseded | node station runner removed |  |

### #3755 · lore-api-openapi

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3759 T004: Add domain route sidecar |  | real | - | apps/lore-api/src/transport/openapi/domain-routes.ts:20-28 vs apps/lore-api/src/work/agents/agents-schema.ts:143,185 | OpenAPI and generated schema.d.ts mark `name` required and include create defaults on both agent-definition PUTs; generated clients get the wrong contract. |
| #3926 T016: Declare response shapes for run-graph and trace-types |  | real | - | libs/shared/src/domain/models/assembly-run.ts:26 (`graph: z.custom<RunGraph>()`); hand mirrors apps/web-ui/src/lib/run-graph.ts, trace-types.ts | Run graph and trace response shapes have no declared contract, so web-ui's two hand-copied types cannot be replaced by generated ones. |
| #3763 T008: Test OpenAPI serving routes |  | trivial | - | apps/lore-api/src/transport/routes/openapi/openapi.test.ts:62-72 | Tests for /api/docs 401 without a token and 403 with a write-only token. |
| #3770 T010: External linter verification |  | human-only | - | scripts/check-openapi-drift.sh (drift guard only); no external linter in the repo | Run an external OpenAPI linter on the served document and record it, or decide to add it to CI. |
| #3761 T006: Test OpenAPI document builder |  | duplicate of #3759 | - | build-document.test.ts has no patch-optionality assertion | Contract test for patch optionality, lands with the #3759 fix. |

### #3771 · local-task-runner

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3775 T004: Implement monitorTask for local runner |  | real | partial | apps/mcp-server/src/work/pipeline/runner-local-commit.ts:55, :73-98 | A nonzero exit is never seen; a failed run is completed or committed and PR'd. |
| #3776 T005: Add explicit local task MCP tools |  | real | partial | runner-local-spawn.ts:248-253 (SIGTERM to the pid, not the group); runner-local-claude.ts:40 | Cancel does not stop the detached process group before removing the worktree. |
| #3780 T008: Implement stale task cleanup |  | real | partial | runner-local-stale.ts:93-98 (`action:"requeue"`, response ignored); apps/lore-api/src/transport/routes/tasks/task-post.ts:91-92 | Server refuses the requeue, runner reports "re-queued"; dead tasks never return to pending. |
| #3781 T009: Show local tasks in statusline |  | real | partial | scripts/lore-status-cache.sh:35-36 | Statusline counts worktree directories; failed tasks keep theirs, so the count stays too high. |
| #3782 T010: Add config tools for local runner |  | real | partial | runner-local-storage.ts:25-36; nothing reads `max_concurrent` | Partial config loses defaults; `max_concurrent` and `task_types` never enforced. |
| #3772 T001: Add local task runner columns |  | trivial | partial | scripts/infra/setup-pipeline-schema.sh:80-88; migrations/0043_tasks_late_columns.sql:29-30 | Fresh-database bootstrap run unproven. |
| #3774 T003: Implement spawnLocalTask module |  | spec-fix | partial | apps/mcp-server/src/work/pipeline/runner-local-storage.ts:12; local-task-runner/spec.md:95 vs :135 | Spec contradicts itself on `.lore-task.json`. |
| #3777 T006: Implement task poller and claim logic |  | spec-fix | missing | runner-local-notifier.ts; claim-and-run-locally.local.ts | Spec still describes the poller (spec.md:28,56-80,100-121). |
| #3778 T007: Add polling toggle tools |  | spec-fix | partial | local-runner/index.local.ts:8-14 | Spec names enable/disable_local_runner (spec.md:76-77,269). |
| #3773 T002: Apply local task runner DB migration | P | human-only | operational verification | migrations/0043_tasks_late_columns.sql:29-30 | Confirm columns in staging and prod. |
| #3779 T011: Delay GKE task claiming |  | human-only | operational verification | apps/lore-api/src/integration-tests/pipeline.test.ts:75-81,222-226 | Evidence from the external floor's worker. |

### #3785 · query-trace-tool

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3786 T001: T001: Implement trace document fetch and error hand... |  | real | - | libs/server-core/src/work/spec-trace/query-trace.ts:16-23 | With a selector, an empty document answers "No statement matches" instead of "no graph data". |
| #3793 T008: T008: Add trace-callers backend route |  | real | - | apps/lore-api/src/transport/routes/trace/trace.ts:150-156 drops `depth`; MCP schema advertises it | Walk `depth` or reject depth>1 with 400. |
| #3794 T009: T009: Add callers query to MCP tool |  | real | - | libs/server-core/src/work/spec-trace/query-trace.ts:215-229 returns raw JSON | Readable callers/callees formatter with an empty answer. |
| #3791 T006: T006: Add trace-failures-touching backend route |  | trivial | - | apps/lore-api/src/transport/routes/trace/trace-failures-touching.test.ts:55,65 (skipped without Dgraph); .github/workflows/test-integration.yml:130-141 | Run lore-api live-Dgraph route tests in the Dgraph CI job. |
| #3788 T003: T003: Wire up lore-query-trace tool |  | done | - | apps/mcp-server/src/transport/tools/spec-trace/query-trace.test.ts:12-31,72 |  |

### #3795 · turn-level-transcript-store

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3800 T5: Add PgAgentRunTurns Postgres adapter |  | trivial | needs review | agent-run-turns.test.ts:296 (Pg adapter tested through a fake pool only) | Integration test of `PgAgentRunTurns` against the migrated schema. |
| #3816 T17: Add FullTranscriptPanel component |  | spec-fix | partial | apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.tsx:64,81 vs turn-level-transcript-store/spec.md:57,152,161 | Update FR5: the panel opens and fetches on mount. |
| #3817 T19: Handle no-transcript in task page log viewer |  | spec-fix | partial | apps/web-ui/src/app/tasks is gone; spec.md:286-288 cites its message | Rewrite the amendment for the current run page. |
| #3796 T1: Add 0037_agent_run_turns.sql migration |  | done | operational verification | migrations/0037_agent_run_turns.sql; .github/workflows/migrations.yml applies and re-applies |  |
| #3797 T2: Add shared test suite for agent run turns adapters |  | done | partial | libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts:37-367 |  |
| #3801 T6: Export AgentRunTurns port from project index |  | done | partial | libs/shared/src/outbound/project/index.ts:85-94 |  |
| #3812 T14: Add 0042_agent_run_turns_dedup.sql migration |  | done | operational verification | migrations/0042_agent_run_turns_dedup.sql; migrations.yml:198-234 |  |

### #3912 · context-evals

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3913 T001: T001: Implement core document evaluation and model ... |  | done | - | apps/lore-api/src/work/context-evals/evaluate-document.test.ts:162, :254; evaluate-document.ts:12 |  |

### #3934 · lore-agents

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3942 T008: T008: Add Repo Base Image Settings API |  | real | - | no `base_image` anywhere in libs/ or apps/; specs/lore-agents/spec.md:211, :253 (spec says "not on main") | No repo `base_image` setting, no approved-image list, no 400 on an unapproved image. |
| #3943 T009: T009: Resolve Repo Base Image at Dispatch |  | real | - | libs/shared/src/outbound/project/agents/agent-defs-floor.ts has no base image layer; spec.md:212 | Repo base-image layer of image resolution at dispatch is missing (depends on #3942). |
| #3944 T010: T010: Build Repo Base Image UI Controls |  | real | - | spec.md:213-214; no selector in the repo Agents tab | No base-image selector and no effective image labelled by layer. |
| #3957 T012: T012: Implement floor prompt resolution |  | spec-fix | - | specs/lore-agents/spec.md:96-97 (FR11 yaml fallback); `scripts/task-types.yaml` deleted | Rewrite or remove FR11. |
| #4075 T016: T016: Implement Agent Definitions as Data Scope and... |  | spec-fix | - | specs/lore-agents/spec.md:31, :262 | Rewrite the Scope section and the migration 0015 statement as history. |
| #3941 T007: T007: Build Global Org Defaults Editor |  | done | - | apps/web-ui/src/app/agents/edit/[name]/page.tsx; apps/lore-api/src/transport/routes/agent-definitions/org-update.test.ts:69, :226 |  |
| #4073 T015: Implement remaining Agent Definitions missing behav... |  | retired | - | spec.md:76, :240; `lore.agent_definitions` dropped in migration 0122 |  |

### #3946 · eso-gitops

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3950 T004: Add secret seed and check scripts |  | real | - | scripts/infra/seed-secrets.sh:119-121 (`read -rs` reads one line) | A pasted multi-line PEM is stored as its first line; the rest spills into the next prompts. |
| #3949 T003: Install ESO and Workload Identity |  | retired | - | no ESO/Terraform here; owned by re-cinq/infrastructure |  |
| #3955 T009: Verify deploy and clean old secrets |  | retired | - | "Lore is a Helm chart only (#4197)" |  |

### #3961 · collaborative-feature-planning

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #3962 T001: Resolve Open Decisions and Write ADR | P | spec-fix | - | adrs/ADR-047-plans-hosted-by-lore-api.md:18; collaborative-feature-planning/spec.md still Draft | Close OD-1 by pointing at ADR-047; OD-2 needs a one-line product decision. |
| #3963 T002: Implement collaborative real-time backend service |  | spec-fix | - | apps/lore-api/src/app/register-planning.ts:46-50 | Mark the feedback-document / `lore.features` requirements superseded. |
| #3965 T004: Implement collaborative session and presence UI |  | spec-fix | - | ADR-047:18; PlanEditorPanel.tsx:39-48 | Defer presence to the external editor; unsure whether a live/offline indicator exists inside planning-editor. |
| #3967 T006: Ensure fallback for unavailable real-time service |  | spec-fix | - | PlanEditorPanel.tsx:46-48 | Rewrite Scenario 6 / FR-6.2: no planning path without the live service. |
| #3966 T005: Implement real-time co-editing for feedback inputs |  | retired | - | round-feedback inputs belonged to the deleted wizard |  |
| #3968 T007: Seal shared feedback on round actions |  | retired | - | targets the deleted `lore.features` round model |  |
| #3969 T008: Implement round transition UI |  | retired | - | round UI belongs to the deleted round model |  |
| #3970 T009: Render contributors in planning prompt |  | retired | - | `scripts/task-types.yaml` gone |  |

### #4009 · loop-pause

| Ticket | | Verdict | Earlier | Evidence | What is left |
|---|---|---|---|---|---|
| #4010 T001: Re-arm interrupted runs on loop resume |  | done | - | apps/lore-api/src/work/loops/resume-loop.ts; resume-loop.test.ts:38,90 |  |
| #4011 T002: Render paused loop pill and Resume button in Loops tab |  | done | - | loops/LoopPaused.tsx; LoopPaused.test.tsx:14,43,56 |  |

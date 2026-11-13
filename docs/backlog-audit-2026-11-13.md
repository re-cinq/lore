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
| real | 48 | behaviour is missing or wrong | keep, as 21 pieces of work |

**74 of the 175 can be closed today** with no work. Another 53 are not work
for the implementation loop (a person, or a spec edit, or a missing test).
**48 are real, and they are 21 pieces of work, not 48.**

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

## Cleanup as proposed (carried out the same day, see the pull request)

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

## Round two: the 311 tickets outside `priority:medium`

The same audit, run the same day over every other open ticket that is not a story or an epic. Most of these were written by people: bugs, debt and wishes from August to November. Twenty verdicts were checked by hand and held.

| Verdict | Tickets | What was done |
|---|---|---|
| retired | 57 | closed |
| done | 43 | closed |
| duplicate | 9 | closed |
| needs a person | 44 | labelled `needs-human` |
| not settled from the code | 5 | labelled `needs-human` |
| text stale | 11 | nine brought in line in this pull request and closed; one waits on a choice, one is a diagram to redraw |
| test only | 5 | four closed with the gap recorded here; one is dead code to delete and stays open |
| real | 137 | kept, each under a user story |
| **all** | **311** | |

Tickets that had no parent story are grouped under thirteen new user stories and six existing ones. The eight epics are user stories now, bar one that was retired and closed.

### Real (137)

| Ticket | By | Evidence | What is left |
|---|---|---|---|
| #523 Deploy Dgraph on GKE under ACL (memory-dgraph-migration AC9) | gedaiu | deploy/chart/templates/lore-dgraph.yaml:18 (a single StatefulSet with no `--acl` arg; the only `args:` at :111 belong to the alpine schema Job); libs/shared/src/outbound/memory-store.ts (backend switch) | Dgraph still runs without ACL, without a scoped runtime user or guardian bootstrap Job, and no CI test runs auditDgraphAcl over the rendered chart. |
| #1079 Scope the lore-mcp gateway to a read + memory-write token... | gedaiu | deploy/chart/charts/lore-mcp-helm/templates/deployment.yaml:39-49 (LORE_INGEST_TOKEN and LORE_MCP_AUTH_TOKEN both read ingestTokenSecret); deploy/chart/charts/lore-mcp-helm/values.yaml:51 | The gateway still uses the full-access ingest token for both roles; a read plus memory-write scoped token is needed, and its value must then be minted and put in place in operations. |
| #1103 No operational view of the event bus (dead letters, stuck... | gedaiu | `apps/web-ui/src/app/repos/[owner]/[repo]/events/page.tsx`. A search for dead-letter or delivery-failure views in apps/web-ui/src and apps/lore-api/src/transport/routes finds none (the dead-letter hits are only in floor-client types and stations handlers) | Operators still have no API or UI page that lists dead-lettered, exhausted or reaped-as-stuck deliveries with enough detail to act on; today there are only OTel counters. |
| #1106 No way to dry-run or test an assembly line definition | gedaiu | libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts (checks only the YAML edges); libs/assembly-lines/src/pipeline-lint.ts (static lint only, no simulator) | There is still no scripted dry-run or replay of a floor pipeline definition. |
| #1107 Repo-owned agent definitions as YAML, shipped to the station | gedaiu | CLAUDE.md:544 (agents are declared once in Lore's md files; per-repo overrides are floor `variants` saved via /agents); no loader for repo-committed agent YAML anywhere in libs/shared/src/outbound/project/agents/ | Nothing reads agent definitions from a repo checkout. The only repo override is a floor variant edited in the UI. This could also be a product decision to drop the wish. |
| #1109 A failed agent run is not diagnosable without archaeology | gedaiu | apps/lore-api/src/work/floor/floor-run-mapping.ts:282-285 (floor runs map to `failureClass: null`); libs/shared/src/lib/error-classify.ts:98 (no ImagePullBackOff matcher) | Floor run reads still show no failure class, and image-pull failures are not classified. |
| #1110 Define the spec standard: template, required sections, an... | gedaiu | .lore/spec-standard.md exists; eslint.config.mjs spec block enforces only require-intro-paragraph, require-statement-links (warn), require-status-matches-coverage and no-ungrounded-spec-name | No lint rule enforces a required/optional section set for spec.md. |
| #1111 Migrate the ~50 existing specs to the spec standard | gedaiu | specs/6-dark-factory/spec.md and others still use mixed heading vocabularies; blocked on #1110 | Migrate the corpus once the section rule from #1110 exists, keeping link anchors intact. |
| #1112 Spec-judge station: conformance, scope/split, cross-spec ... | gedaiu | libs/shared/src/domain/spec-judge.ts:1 is only the spec-test linker's judge; no spec-judge station under apps/stations/src | No station judges a spec for conformance, scope or split, cross-spec conflicts, quality or untestable statements. |
| #1113 44 of 50 specs are frozen at 'In Progress' — build spec-s... | gedaiu | specs/spec-status-upkeep/spec.md:83 "FR2 — Status-staleness detector (proposed follow-up)" | Build the periodic status-staleness detector, or retire it explicitly in the spec. |
| #1114 Every testable spec statement should be linked to a test | gedaiu | eslint.config.mjs (spec block) has `re-lint/require-statement-links: "warn"`; rot resistance is done via content-hash anchors (12462 of 12649 links in specs and adrs carry `@hash`) | Measure the linked fraction per spec and close or reconcile the unlinked testable statements. |
| #1117 Web UI auth is an unimplemented TODO (Google Workspace OIDC) | gedaiu | apps/web-ui/src/middleware.ts:10-18 (checks only that the cookie exists); apps/web-ui/src/app/layout.tsx:102 (session can be null and the page still renders) | Protected pages still let a forged or expired cookie through middleware: add a valid-session check (or show that every lore-api call rejects it) with tests. The ADR-053 GitHub mechanism stays. |
| #1118 Orphan page audit: enumerate unreachable routes, then lin... | gedaiu | apps/web-ui/src/components/shell/nav-groups.ts has no /context entry; apps/web-ui/src/app/context/ContextView.tsx:33 (only links to itself) | /context (and maybe other routes) still has no incoming link and no written link-or-delete decision. |
| #1120 Deploys can silently not ship: a merged fix never reaches... | gedaiu | scripts/ci/bump-image-tag.sh:1-4 (deploy is now an Argo CD tag-bump PR); .github/workflows/build-lore-api.yml:6 (push trigger still path-filtered) | A failed build is still never caught up by later path-filtered commits, and nothing checks that the running image matches main. |
| #1121 No supply-chain or dependency hygiene gate in CI | gedaiu | .github/workflows/pr-checks.yml (no npm audit or dependency-review job); docs/security/supply-chain-hardening.md:20-22 (allowlist "not yet done") | Add a PR check that fails on vulnerable or new dependencies, and write down the pinning and lockfile review policy. |
| #1122 The installed MCP silently goes stale (and fails as a bar... | gedaiu | scripts/lore-doctor.sh:26-28 (only checks that `dist/index.js` exists); apps/mcp-server/src/work/update/mcp-update.ts:49-51 (if the build marker is missing, it falls back to checkout HEAD) | Make doctor report the installed MCP's build SHA and how stale it is against origin/main, and flag a missing `~/.lore/mcp-build-head` instead of assuming HEAD. |
| #1124 Assembly line list needs filters: AI vs not, definition/t... | gedaiu | apps/web-ui/src/app/assembly-runs/page.tsx:6-17 (the page takes only repo, status and cursor) | The run list still lacks filters for AI or not, definition or type, PR and trigger. |
| #1135 100% LLM-node failure produced zero signal for two days | loredanamoanga | apps/lore-api/src/transport/routes/platform/llm-status.ts:12 (`ACCOUNT_WIDE = ["anthropic-credit"]`, only that failure class degrades the platform) | Nothing raises an alert when agent runs keep failing at boot, and the run page has no boot-phase badge or last-stderr line. |
| #1152 pr-checks checks out github.head_ref from the base repo —... | loredanamoanga | .github/workflows/pr-checks.yml:37, :266, :369 (`ref: ${{ github.head_ref }}`, no `repository:` override) | Check out the head repo (or skip fork PRs) and guard the format job's push to same-repo PRs. |
| #1202 Enrollment checklist probes 2 of the ~12 artifacts a Lore... | vvondruska | apps/web-ui/src/app/repos/[owner]/[repo]/page.tsx:146-155 (fetchOnboardingFiles still probes only AGENTS.md and lore-ingest.yml, existence only) | Probe the full artifact list from one shared source and give the repo page the same version status as the home page. The refusal half is fixed: actions.ts reonboard returns { error }. |
| #1205 Repo configuration is best-effort, unverified, and split ... | vvondruska | libs/shared/src/work/onboard/onboard-ingest-callback.ts (sets LORE_INGEST_TOKEN best-effort); nothing in apps/lore-api/src or libs/shared/src reads actions/secrets, actions/variables or actions/permissions | Add read-only enrolment checks that LORE_INGEST_URL and LORE_INGEST_TOKEN exist and that Actions may write checks. The dark-factory and webhook parts are retired. |
| #1227 Session-summary Stop hook never fires — `LORE_API_URL`/`L... | vvondruska | scripts/lore-merge-settings.js:208-214 (hook still reads only `${LORE_API_URL:-}`, ends in `\|\| true`, always runs `rm -f "$SESSION_FILE"`, installs only when the hook is absent) | Add the git-config credential fallback, report failures, delete the session file only after a successful POST, and upgrade hooks already installed. |
| #1233 Drop the AssemblyRun rollout scaffolds once the deploy ha... | gedaiu | deploy/chart/charts/ui-helm/migrations/0040_assembly_runs.sql (compat views); no later migration drops pipeline.assembly_lines or assembly_line_nodes; `fallbackGraph` is gone from libs and apps | Add a new migration that drops the two compat views (the Floor that read them is retired); the graph fallback half is already gone. |
| #1244 Post-#1097 residue: stale 'requires PostgreSQL' copy and ... | loredanamoanga | apps/mcp-server/src/transport/tools/graph/query-graph.ts:42, apps/mcp-server/src/transport/tools/context/assemble-context.ts:214 (also graph/write-episode.ts:44); specs/mcp-tools/cancel-task/spec.md:31 | Three MCP tools still say "requires PostgreSQL" instead of using `notConfiguredError`. Four specs still carry `(DB-only)`: cancel-task, retry-task, list-task-group and list-repos. |
| #1247 findMisplacedCoverageLinks undercounts stranded links: ba... | loredanamoanga | libs/shared/src/domain/spec-link-parser.ts:154 `.replace(/`[^`]*`/g, "")` runs before the link regex, so fully backticked continuation labels still disappear | Scan for links before stripping code spans, and add a regression with a multi-link stranded parenthetical. |
| #1251 Dedupe the twin upsertMemoryWithVersion implementations (... | loredanamoanga | libs/server-core/src/work/memory/memory.ts:87 (own copy of `upsertMemoryWithVersion`) next to libs/shared/src/outbound/postgres-memory-upsert.ts:27 | Make server-core use the shared upsert. |
| #1252 sharedWrite: use ON CONFLICT for the shared_pools get-or-... | loredanamoanga | libs/server-core/src/work/memory/memory-pools.ts:65-84 (SELECT then a plain INSERT, no ON CONFLICT) | Make pool creation conflict-safe (ON CONFLICT) and add a test for two concurrent first writes. |
| #1257 guard-main-pushes: push payload truncates at 20 commits, ... | loredanamoanga | .github/workflows/guard-main-pushes.yml:31 (`toJson(github.event.commits.*.id)`, no check against `size` and no compare API) | Notice a payload cut off at 20 commits, or list the full before...after range. |
| #1274 Rename the Floor run-walk internals: jobs/assembly-line/ ... | gedaiu | The `apps/floor/src/jobs/assembly-line` part is gone. TypeScript parameters still say `assemblyLineId` in `libs/shared/src/outbound/project/usage/usage-memory.ts` (11 hits) and `libs/shared/src/outbound/project/agent-run-events/agent-run-events-port.ts:33`, out of about 120 non-test hits in total | Rename the run-valued TypeScript parameters in the surviving ports and adapters, keep the SQL columns, or record that keeping the old name is deliberate (the port comment at line 8 hints that it is). |
| #1275 Rename web-ui run symbols: AssemblyLineRun* types/compone... | gedaiu | apps/web-ui/src/app/assembly-runs/[id]/NodeLogPanel.tsx:20,105-124; apps/web-ui/src/app/assembly-runs/[id]/node-pod-logs-presenter.ts:15 (props still named assemblyLineId) | Rename the local run-id props in NodeLogPanel, AgentAttemptCard and node-pod-logs-presenter (lib/run-turn-types.ts is a parse-side wire field and stays). |
| #1303 Consolidate the three duplicated LORE_UI_URL link builder... | loredanamoanga | libs/shared/src/domain/references.ts:102 (`replace(/\/$/, "")`, single slash, no scheme check) against `/\/+$/` in libs/shared/src/domain/feature-planning/plan-url.ts:9 and libs/shared/src/work/review/floor-review-start.ts:348 | Several UI-link builders are still copies of each other, and references.ts strips only one trailing slash; one shared helper that also checks the scheme is still missing. |
| #1305 LLM calls made outside agent pods leave no transcript (pr... | loredanamoanga | libs/shared/src/outbound/llm/ (llm.ts and the providers have no transcript or redaction hook; only usage is recorded) | Store redacted prompts and responses for service-side LLM calls, keyed by run or job. |
| #1349 floor: route episode writes through lore-api instead of a... | gedaiu | apps/stations/src/merge/merge-step/run.ts:91 and apps/stations/src/work/merge-check/merge-check.ts:186 still call writeEpisodeWithCuration (direct memory port) | Send the merge and rejection episode writes through the lore-api episode endpoint, keeping them non-throwing and redacted. |
| #1387 Retire the task-log GCS dual-write and read fallback afte... | loredanamoanga | apps/mcp-server/src/work/pipeline/runner-local-turns.ts:292 (POST /api/task-logs); apps/lore-api/src/transport/routes/tasks/task-logs.ts:267 (GCS read fallback) | The GCS write and read paths are still there; the soak check is a person's call, and the local runner writing to GCS is due to be removed anyway. |
| #1392 Remaining upstream-status masquerades: SSE stream, timeli... | loredanamoanga | apps/web-ui/src/lib/api-error.ts:22 (`upstreamError` passes `result.code` through, so 401/403 reach the viewer); apps/web-ui/src/lib/assembly-runs.ts:97 (any failure becomes null, answered as 404 at assembly-run-auth.ts:44) | Map backend 401/403 to 502 in `upstreamError`, and keep `fetchAssemblyRun` from turning a failure into "not found". |
| #1397 Events-history walk infers end-of-history from a client-s... | loredanamoanga | apps/web-ui/src/lib/run-stream-presenter.ts:4 and :44-46 (HISTORY_PAGE_LIMIT=1000, short page ends the walk); apps/lore-api/src/transport/routes/floor/run-events.ts has no hasMore | Have the events route return a hasMore flag (fetch one row past the page) and end the history walk on that flag. |
| #1398 Delete the turn-walk short-page fallback once the Floor h... | loredanamoanga | apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.ts:38 and :68 still fall back to page length; apps/lore-api/src/transport/routes/floor/run-turns.ts:17 now requires hasMore: z.boolean() | The server always sends the flag now, so delete the `hasMore === undefined` fallbacks and make parseHasMore required. |
| #1418 64 web-ui files still declare DB-shaped row types by hand | gedaiu | grep for snake_case interface members finds 57 non-test files under apps/web-ui/src (was 64) | Turn the remaining API-backed page-local row types into aliases of the generated schema types. |
| #1423 Flip PipelineTask to camelCase, readers-first (expand/con... | gedaiu | libs/shared/src/domain/types.ts:6-11 (PipelineTask is still snake_case on the wire, held by the WireKeysAreColumns guard); apps/lore-api/src/transport/routes/repos/station-task-routes.ts:90 open-like still serves it | Readers-first camelCase flip, if anyone still wants it. Low value now that the station pods are mostly gone. |
| #1505 717 validated-by link labels name a different line than t... | gedaiu | 9 links in specs/adrs still have a `` `x.test.ts:N` `` label whose N differs from `#L` (e.g. specs/2-agent-memory/spec.md, specs/6-dark-factory/spec.md, specs/1-lore-platform/spec.md) | Relabel the last 9: `withAnchorHash` drops stale line labels when it adds a hash, so running `eslint --fix` with hashAll should clear them. |
| #1509 [skip ci] inherited into squash merges silently deploys n... | gedaiu | .github/workflows/pr-checks.yml:107 `commit_message: "style: prettier [skip ci]"` | Remove `[skip ci]` from the auto-format commit (or have a person set the repo's squash message to PR_BODY) so merges to main always run the build and deploy workflows. |
| #1544 Settings page Ingest Token is disconnected from API auth ... | loredanamoanga | apps/web-ui/src/app/settings/page.tsx:56 and :145 (reads and writes the ingest_token org setting); apps/lore-api/src/transport/http/auth.ts:133 (auth checks only process.env.LORE_INGEST_TOKEN and hashed tokens) | Remove the unusable token and Regenerate button from settings (SettingsView.tsx:183-232) or connect them to real auth. |
| #1550 lore-tests instruction still teaches the '\|\| echo ::war... | loredanamoanga | libs/shared/src/lib/lore-tests-instruction.ts:9 still says to append `\|\| echo "::warning::Lore test ingest failed"` | Replace the soft-fail instruction with the hard-fail and status-check pattern from the ingest workflow. |
| #1585 Remove vestigial lore-api ANTHROPIC_ADMIN_KEY wiring afte... | loredanamoanga | deploy/chart/charts/lore-api-helm/templates/deployment.yaml:85-94; deploy/chart/charts/lore-api-helm/values.yaml:146; deploy/clusters/internal-cluster.values.yaml:241 | Remove anthropicAdminKeySecret and ANTHROPIC_ADMIN_KEY from lore-api and keep the stations wiring. |
| #1598 Flip specs/eso-gitops to Implemented (needs statement-lin... | gedaiu | specs/eso-gitops/spec.md:7 (Status still Draft); specs/eso-gitops/spec.md:224 (says so on purpose) | Add statement links and config-assertion tests (including the two ADR-046 invariants), then flip the status; ExternalSecret and Terraform claims may first need to move to re-cinq/infrastructure. |
| #1615 Add guard against uncovered test suites | lore-agent | scripts/check-orphaned-tests.mjs:122-131 (an `npm test -w` match marks the whole workspace dir/** as covered) | Use each runner's real include/exclude globs and add a test for a file a runner skips inside a covered workspace. |
| #1641 Merging a PR before its review finishes kills the review:... | gedaiu | `libs/shared/src/work/review/floor-review-start.ts:303` still passes `repo: gitItem(pr.repo, pr.branch)`; `head_sha` at :291 is only a separate value | Pin the read-only review and recheck checkout to `head_sha`, and make reply mode fail fast with a clear "branch deleted" error (this may need a change on the external floor or agent side). |
| #2092 Publish AssemblyRun cancellation, station retry and human... | nextlevelshit | apps/lore-api/src/transport/routes/floor/run-node.ts:23 (body is only requested_by) and :62-66 (the actor comes from the body); cancel-run.ts exists | Add retry and decision contracts bound to an exact visit, idempotency, the authenticated actor and action discovery, with OpenAPI contract tests. |
| #2102 lore-api aborts on V8 heap exhaustion at half its memory ... | loredanamoanga | deploy/chart/charts/lore-api-helm/values.yaml:53 (heap fix is done: NODE_OPTIONS --max-old-space-size=768); libs/shared/src/outbound/project/lib/platform-github-actions.ts:71 still reads the whole job log into one string | Cap the job-log read and add request logging (route, status, response bytes) so a crash can be traced to a request. |
| #2125 HALEngine has auto_review on and has never been reviewed;... | gedaiu | libs/shared/src/work/review/floor-review-start.ts:112-113 (`if (!pr \|\| !reviewGateOpen(pr, gate)) return null;` with no log or event) | Record every refused review with repo, PR and reason, then check HALEngine's live setup. |
| #2129 code-review-recheck: a review that reaches changes_reques... | gedaiu | apps/stations/src/code-review/post-review/post-review.ts:304-309 (`maybePostReview` returns null when the findings block will not parse) | An unparseable changes_requested review still loses its findings: there is no fallback post and no parse feedback on the retry. |
| #2146 Run init line says "(0 tools)" for every Gemini run, MCP ... | gedaiu | libs/shared/src/work/agent-stream/agent-run-events.ts:35-39 (`Array.isArray(ev.tools) ? ev.tools.length : 0`, always prints `(N tools)`) | When the init event has no tools array, show the count as unknown or leave it out, and add a test with a Gemini init event. |
| #2172 A root lockfile-only change rebuilds no image: every buil... | gedaiu | .github/workflows/build-lore-api.yml:6-38 and build-stations.yml:6-21 (no package.json or package-lock.json in paths); build-mcp-server.yml:6 the same | Add the root package.json and package-lock.json to every build-*.yml path filter. |
| #2178 GET /api/pr-status declares a camelCase contract but serv... | gedaiu | apps/lore-api/src/transport/routes/repos/pr-status.ts:28-48 declares url, checksStatus and computedStatus; apps/lore-api/src/outbound/github-client.ts:254-258 returns html_url and computed_status | Make the schema and toPrStatus agree, and add a wire-contract test. |
| #2205 Per-repo escalate paths for auto-merge, proof of concept ... | loredanamoanga | libs/shared/src/domain/models/repo-settings.ts:73 (auto_merge only has enabled/min_age); `escalate_paths` appears nowhere in libs or apps | Add escalate_paths to settings and UI and make a matching path block the merge with label, CODEOWNERS and comment; the pilot and ADR need a person. |
| #2206 Slack: announce every opened PR, explain failures with th... | loredanamoanga | libs/shared/src/domain/models/repo-settings.ts:65-80 (no pr_open subscription); no failure_threads table or PR-opened announcer anywhere in apps or libs | Build the PR-opened Slack notices and the same-day failure threads that use the error classifier. |
| #2266 Agent-definition edits record no actor or diff, and the A... | loredanamoanga | apps/lore-api/src/transport/routes/agent-definitions/org-update.ts:117 and agent-writes.ts:100,134 audit only { name } (or { name, ceremony }) | Record actor and field diff on agent writes. Divergence against a floor default is a product decision, since the shipped_default row went with the table. |
| #2333 Rebuild gap detection and gap filling as one weekly assem... | gedaiu | libs/assembly-lines/src/floor-pipelines has no gap pipeline; apps/stations/src has no gap family | The single weekly gap-detection and gap-filling line still has to be designed and built on the external floor. |
| #2350 Nothing stops an agent from editing CI workflows or other... | QuintinBotes | no `gateFilesTouched` or workflow-path diff check in libs/shared/src or apps/stations/src (grep finds only workflow-path constants such as libs/shared/src/work/trace-impact-workflow.ts) | Nothing flags or refuses agent commits that touch .github/workflows, CODEOWNERS or .claude, and no prompt rule against it was found. |
| #2351 Trust ladder only ever promotes, and trust settings chang... | QuintinBotes | apps/stations/src/work/lib/trust-ladder.ts:33 (only nextTrust, which only promotes; no demoteTrust); merge-check.ts:244 promoteTrust is the only writer | Add demotion on rejection. The min_trust two-key part is retired with Dark Factory. |
| #2356 Two-key approval honours a removed label and accepts any ... | QuintinBotes | commit "The two-key approval now needs the label still on the PR and a CLAUDE.md owner as approver (#2435)" fixes (a), (b) and (d) (approval-pr.ts:202-243); apps/lore-api/src/transport/routes/two-key.ts:23 still binds approval only via the X-Lore-Approval-PR header | Tie an approval PR to the patch it approves, or refuse reusing one PR across different patches. |
| #2359 CI deploy identity is effectively cluster-admin, and depl... | QuintinBotes | no workflow except migrations.yml touches the cluster (Argo CD deploys; RBAC lives in re-cinq/infrastructure); .github/workflows/pr-checks.yml:105 and build-stations.yml:63 use mutable tags (`git-auto-commit-action@v5`, `checkout@v5`); deploy/chart/charts/lore-api-helm/values.yaml:121 sets agentImage `:latest` | Pin actions to commit SHAs and stop using `:latest` image defaults; the cluster-admin RBAC and WIF part belongs to the infrastructure repo. |
| #2360 re-cinq/lore CODEOWNERS resolves no owners, and the suppl... | QuintinBotes | CODEOWNERS:9 (stale `/mcp-server/`; no `infra/**`, `libs/assembly-lines/**` or `.claude/**` entries); docs/security/supply-chain-hardening.md:24-26 | Fix the CODEOWNERS paths and owners; an org admin must check owner resolution and the real branch protection against the doc. |
| #2361 The CI verdict fails open when a commit has no check runs... | QuintinBotes | libs/shared/src/outbound/project/lib/platform-github-pulls-review-reads.ts:262-286 (statuses now read, but only one page and a 403 counts as no statuses); no `required_checks` setting; github-map.ts has no `status` event | Add required_checks where a missing context means pending, read statuses past one page or fail closed, and re-drive on `status` webhooks. |
| #2367 No way to offboard a repo or team: its chunks, graph, mem... | QuintinBotes | no "offboard" in apps, libs, docs or runbooks; no repo-wide purge route | Decide the purge and retention policy, then build the dry-run repo/team purge and the tenant teardown runbook. |
| #2372 External floor: lore-api boot reverts every edit made on ... | QuintinBotes | apps/lore-api/src/work/floor/seed-floor-pipelines.ts:124 (lines and stations are still put on every boot; only agent definitions are skipped when present); apps/lore-api/src/app/seed-floor.ts:28-45 (a failure is only logged, never retried) | Stop an unchanged seed from bringing an old line or station version back over a floor edit, and add a seed-status signal plus retry. |
| #2373 External floor: review history reads only the newest 200 ... | QuintinBotes | libs/shared/src/work/review/floor-review-runs.ts:21,65-67 (`RUNS_READ_PER_LINE = 200`, no cursor paging) | Page through all runs or query by PR subject, and add a test with more than 200 runs on the same line. |
| #2376 External floor review: a failed post re-posts the review,... | QuintinBotes | apps/stations/src/code-review/post-review/post-review.ts:45 (dedupe marker keyed on the visit); station.ts:76-85 (check-run upsert runs after the post); libs/shared/src/work/review/review-start-deps.ts:21 (calls `floorClient()` even with no floor, so the route returns 500) | Make post-review idempotent per run and head sha, and have review-start return 503 when no floor is configured. |
| #2377 web-ui: one shared pattern for actions, with pending stat... | QuintinBotes | apps/web-ui/src/app/repos/[owner]/[repo]/settings/page.tsx:74 (returns { saved: true } unconditionally); apps/web-ui/src/app/settings/page.tsx:150,170,182,198,241 (putOrgSettings results ignored) | Repo and org settings still swallow ApiResult failures, and there is no shared toast/action primitive or lint guard. Reonboard and webhook now return { error } (repos/[owner]/[repo]/actions.ts). |
| #2379 Plan editor tears down and rebuilds its collab session on... | QuintinBotes | apps/web-ui/src/app/repos/[owner]/[repo]/plans/[id]/usePlanRunLive.ts:68 (afterId "0", no catchup_complete guard before scheduleFactsRefresh); PlanEditorPanel.tsx:93-96 (stable connection already fixed) | Ignore replayed frames until catchup_complete before calling refreshRunFacts, and add a regression test for it. |
| #2383 lore-mcp gateway answers an unknown or expired MCP sessio... | QuintinBotes | apps/mcp-server/src/transport/http-transport.ts:26,267 (only the MAX_SESSIONS=1000 cap, no idle TTL); the 404 for an unknown session is fixed at :242,312 | Add an idle-TTL sweep plus a test for expire, then 404, then re-initialize. |
| #2385 PR outcome feedback is dead: nothing writes pipeline.task... | QuintinBotes | libs/shared/src/domain/pipeline-task-core.ts:153-177 saveContextRefs has no caller that passes contextRefs; apps/stations/src/work/merge-check/merge-check.ts:205-209 returns when refs are null | Save the refs that were actually packed into each run's context, keyed to the run, and have merge-check read them. |
| #2386 Hybrid search: the vector leg can silently vanish for spa... | QuintinBotes | libs/shared/src/outbound/project/knowledge/context-assembly-chunk-search.ts:165 still uses unnormalized ts_rank (ef_search and iterative_scan are fixed at :127-133); memory-search-queries.ts:32,77 vector legs have no `embedding IS NOT NULL` | Normalize the keyword rank, add the null guards on memory/fact embeddings, send embedding task_type and re-embed. |
| #2387 Progressive-disclosure context: L0/L1 summaries, an expan... | QuintinBotes | no context_nodes table and no expand tool; context-assembly still builds its trace only for debug and never stores it | All of it: L0/L1 summaries, the expand tool and a stored retrieval trajectory. |
| #2389 Daily digest: add a section that rolls up the day's run f... | QuintinBotes | libs/shared/src/domain/digest-settings.ts:3 `DigestSection = "implemented" \| "roadmap" \| "summary"` with no lore_runs | Add the lore_runs section: port, rendering, settings checkbox and spec FR. |
| #2391 One lint error hides among ~4,000 warnings and skips the ... | QuintinBotes | .github/workflows/pr-checks.yml:109-111 (format job runs exit 1); pr-checks.yml:115 (`needs: format` with no always()) | A format failure still skips the test matrix, and there is no errors-only lint or warning ratchet. |
| #2392 The lore-ingest workflow never retries a transient failure | QuintinBotes | .github/workflows/lore-ingest.yml:29 (diffs HEAD~1); lore-ingest.yml:97 (warns "next doc push retries" and stays green) | Diff against the last ingested commit, or retry and fail, in the workflow and in the libs/shared ingest-workflow template. |
| #2394 Root CLAUDE.md has stale and contradictory claims, and no... | QuintinBotes | CLAUDE.md:93 still holds the Key Components catalogue (file is 78 KB); scripts/check-declared-paths.mjs:2-11 checks only manifest and runtime paths, not backticked Markdown paths or symbols | Move the catalogue to one home, drop the hard counts and add a check for backticked paths and symbols. |
| #2395 Spend caps per run and per repo for agent work | QuintinBotes | no spend-cap, cost-cap or daily-cap code anywhere in apps/*/src or libs/*/src | Add a per-run token/cost cap and a per-repo daily cap checked at dispatch, shown on the run page (needs the external runner contract). |
| #2396 An outcome scorecard for agent work: merged vs closed age... | QuintinBotes | no scorecard or time-to-merge code in apps or libs; the auto-merge KPIs route reports different metrics | Build per-repo merged vs closed, rework rounds and time-to-merge metrics for the UI and the digest. |
| #2419 Broken test links in spec.md | lore-agent | These links are still in today's specs and their files are missing: specs/1-lore-platform/spec.md:1081 (event-reporter.test.ts L9, L26, L55); specs/api-routes/webhook-github/spec.md (apps/lore-api/src/work/webhook/webhook-manage.test.ts); specs/assembly-line-run-viz/spec.md (apps/web-ui/src/app/assembly-runs/[id]/RunWorkbenchLayout.test.tsx); specs/lore-agents/spec.md (agents/actions.test.ts, agents/RemoveOverrideButton.test.tsx); specs/project-test-interface/spec.md (apps/lore-api/src/transport/routes/dist/dist.test.ts, 9 links) | Re-point or drop the links to the missing test files. Also check the line-out-of-range links: specs/job-log-streaming/spec.md to LogEntriesView.test.tsx:231 (listed by all 8 reports), specs/external-floor/spec.md to code-review-decisions.test.ts:212, specs/hapi-request-validation/spec.md to zod-validate.test.ts:63. |
| #2428 Remove what the old Floor left behind: old line files, no... | gedaiu | libs/assembly-lines/src/assembly-lines/issue-triage.yaml:1-14 (an old-walk file with prompt_ref and station_ref; only a fixture string in libs/shared/src/work/feature-planning/issue-bodies.test.ts:211 names it); apps/cluster-agent is already gone | Delete the leftover old-walk file and the rest of the old Floor's shared ports and recipe rows; a person still has to confirm the Terraform apply and that satellites use the external floor. |
| #2439 The onboarding PR's title is a fixed 'lore: onboard <repo... | QuintinBotes | apps/stations/src/onboard/open-pr/station.ts:89 (`title: lore: onboard ${repo}`); :30 (the Why section opens with the tool) | Use a title and body that say what the PR adds, and cover both in station tests. |
| #2441 Ingest-workflow template rollout overwrites per-repo devi... | gedaiu | libs/shared/src/work/ingest-workflow.ts:128 now has persist-credentials: false, but there is no `permissions: contents: read`; apps/web-ui/src/lib/github-workflow-pr.ts:50 sends a bare body with no Why/What Changed/Testing | Add contents:read, keep per-repo customisations when the template is rolled out again, and write the PR sections each repo's checks require. |
| #2470 The Spend page's Billing Source and Cost by Cluster table... | gedaiu | apps/lore-api/src/transport/routes/analytics/spend-window-llm.ts:179-192 (readByCluster LEFT JOIN pipeline.cluster_agents); apps/web-ui/src/app/spend/SpendLlmBreakdowns.tsx:12 | The Cost by Cluster table is still built from the old station_runs and cluster_agents tables. It needs to be removed, labelled as history, or fed real attribution. |
| #2511 Strip "from plan" link groups from search and embedding text | gedaiu | libs/shared/src/domain/spec-link-strip.ts:6 and :9 (only `(?:validated or implemented) by`); deploy/chart/charts/ui-helm/migrations/0070_chunks_search_tsv_strip_links.sql | Ten specs carry `[from plan]` links, but neither the JS pattern nor the SQL pattern strips them, and no migration rebuilds the column. |
| #2512 Project plan citations into the trace graph | gedaiu | No derived_from edge anywhere in libs/shared/src; libs/shared/src/work/spec-trace/project-spec-file-links.ts adds only test, code and ADR links | Add derived_from edges from a spec statement to its plan block, plus reads for where a statement came from and what a plan change affects. |
| #2514 Plan validation and refine problems: stale checkout, lost... | loredanamoanga | Items 1 and 2 are fixed: libs/assembly-lines/src/floor-pipelines/feature-planning.yaml:15-54 (validate clones `base`) and the plan-findings station blocker. Not fixed: apps/lore-api/src/work/plans/refine-settled.ts:60 still marks every `uses` | Still open: telling the user why a second Refine was refused (3), wrong input marking and live contradictory edits (4 and 5, the same work as #2520), and losing long typed text (7). |
| #2518 Run page and run list mint live tokens through server act... | loredanamoanga | apps/web-ui/src/app/assembly-runs/AssemblyRunsLive.tsx:86 calls loadRunsPageAction with only try/finally (:105-110) and no stale-deployment catch; socket tokens are handled in lib/live-socket/stale-deployment.ts | Catch the stale-action error on the run-list page refresh and reload once, with a test. |
| #2519 A Refine reads the plan's spec branch, cut when the run s... | loredanamoanga | libs/assembly-lines/src/floor-pipelines/feature-planning.yaml:24-27 analyze still binds `target: repo` (the spec branch) | Give Refine the current default-branch code and keep access to the spec branch on the post-review path. |
| #2520 A Refine's edits should be a proposal to accept, and mark... | loredanamoanga | apps/lore-api/src/work/plans/refine-settled.ts:60 (finishRefine marks all ask.uses on success); libs/shared/src/agent-defaults/plan-analyze.md:118 (Refine edits go live through lore_plan_edit) | Choose between a proposal the user accepts and a report of the inputs actually used, then wire it in so success alone no longer marks every input used. |
| #2544 issue-triage: needs-reproduction tells the reporter nothi... | gedaiu | apps/stations/src/events/repo-handlers.ts:128-140 (a reply adds `triage: needs-triage` but never removes the waiting label); apps/stations/src/work/issue-triage-tick/issue-triage-tick.ts:35-42 (`awaitingTriage` accepts an issue only when needs-triage is its only triage label) | When the reporter replies, remove the needs-reproduction or unable-to-reproduce label (or relax the sweep) so the issue becomes eligible again, and test the full reply-to-new-run loop. The comment asking the reporter is already posted (triage-label/index.ts:100). |
| #2616 Review agent puts prose in a GitHub suggestion block; com... | gedaiu | libs/shared/src/work/review/conventional-comment.ts:28-29 (any suggestion is wrapped in a suggestion fence); apps/stations/src/code-review/post-review/post-review.ts:292 (`finding.suggestion` passed through unchanged) | Prose advice can still be posted as a one-click committable suggestion. A guard or a tighter prompt, plus a regression test, is still needed. |
| #2684 Task issues say "Depends on" as text, so the implementati... | gedaiu | libs/shared/src/work/feature-planning/issue-bodies.ts:207 (dependencies are written only as `**Depends on:**` text); the only blocked-by code is the read at libs/shared/src/outbound/project/lib/platform-github-issues.ts:66, with no call that creates one | Create GitHub's native blocked-by relation when task issues are filed, with a test in each filing station. |
| #2685 A definition-of-done visit that pushed nothing is settled... | gedaiu | apps/stations/src/implementation-loop/open-pr/station.ts:116-119 (returns failed with an "empty branch" message); libs/assembly-lines/src/floor-pipelines/implementation-loop.yaml:169-172 (open-pr retries itself once on failed) | Settle an empty branch as the dod outcome without spending the open-pr retry, and assert the comment on the ticket. |
| #2686 Decompose ignores the plan's delivery section: a plan tha... | gedaiu | libs/shared/src/agent-defaults/spec-tickets-decompose.md has no rule for a plan's delivery section or delivery.tickets; no code or prompt under libs or apps mentions it | Make decompose honour a plan's explicit ticket grouping and add the two-ticket regression. |
| #2720 Call graph: follow-ups to the first code projection slice... | gedaiu | apps/lore-api/src/transport/routes/trace/trace.ts:150 ("One hop: `depth` is not walked yet"); libs/shared/src/work/ingest-workflow.ts:14-21 (triggers only on doc paths) | All seven follow-ups remain open: source-push trigger, joining the impact hop to statements, depth above 1, resolution gaps, other languages, the unused INGEST_KINDS registry, and rebinding. |
| #2722 Case-sensitive lore.repos lookups by full_name scattered ... | gedaiu | apps/lore-api/src/transport/routes/repos/repo-settings.ts:110 and :153; repo-status.ts:78; context/chunk-schema-readers.ts:27; webhooks/webhook-incident.ts:305; backlog/backlog-repo.ts:48 (all `WHERE full_name = $1`) | Move these lookups onto one shared case-insensitive lookup, with a mixed-case test for each route. |
| #2723 Run page: a failed attempt with no turns shows an empty t... | gedaiu | apps/web-ui/src/app/assembly-runs/[id]/TranscriptView.tsx:66-72 (`emptyMessage` shows only the generic retention text; no failure detail reaches it) | Show the attempt's failure_detail and point to Pod logs and to older attempts that have turns when a failed attempt has zero turns. |
| #2724 GET /api/assembly-runs/floor-<visit id> answers 500 on a ... | gedaiu | apps/lore-api/src/work/floor/floor-backed-runs.ts:37-38 (local getById runs first for every id); libs/shared/src/outbound/project/assembly-runs/assembly-runs-pg-queries.ts:94-101 (raw id goes to `WHERE id = $1` on a uuid column) | Reject ids that are not uuids with a 404 (or resolve `floor-<visit>` names) before Postgres, with a regression test. |
| #2738 The implementation loop's pod should have the toolchain t... | loredanamoanga | deploy/chart/charts/lore-api-helm/templates/deployment.yaml:146 (one global LORE_AGENT_IMAGE); apps/agent-image/Dockerfile:47 (Temurin copied into the shared image as a stopgap) | Add a per-repository toolchain declaration and provisioning (or per-repo image selection), with a spec and tests. |
| #2749 Task notifier and local runner default to retired task types | gedaiu | apps/mcp-server/src/transport/tools/pipeline/enable-task-notifications.ts:6 and :19; apps/mcp-server/src/work/pipeline/runner-local-storage.ts:33 (defaults still runbook and gap-fill) | Remove the notifier and local-runner tools (CLAUDE.md marks the runner for removal) or give them live task types. |
| #2750 Onboarding still installs Review and General Task issue t... | gedaiu | libs/shared/src/work/onboard-content.ts:62 ("Lore: Review") and :84 ("Lore: General Task") | Drop or reword the two templates in the onboarding payload. |
| #2751 Delete unused allPathsMatch() and push-only agent default | gedaiu | libs/shared/src/lib/path-match.ts:10 with the export at libs/shared/src/index.ts:153 (no caller outside its own test); libs/shared/src/agent-defaults/push-only.md still ships | Delete allPathsMatch, its export and push-only.md, and check the seeder no longer writes a push-only row. |
| #2834 loop-tdd-round prompt makes Lore tools mandatory, so a ca... | gedaiu | libs/shared/src/agent-defaults/loop-tdd-round.md:138 ("BEFORE YOU EDIT A SYMBOL", lore-query-trace); libs/shared/src/agent-defaults/loop-tdd-round.md:70-71 (read CI from round-brief or `lore_get_ci_failures`); libs/shared/src/agent-defaults/loop-fix-ci.md:106,137 | The tdd-round and fix-ci prompts still read the Lore lookups as mandatory and say nothing about what to do when the tools are missing. |
| #2859 Spec Impact check posts blank 'coupled spec statement' an... | gedaiu | libs/shared/src/work/spec-trace/ingest-test-report-groups.ts:76 (`upsertByXid` on the anchor's Statement xid with no check that the node exists) | Skip and report anchors that match no existing Statement instead of creating a bare node, with regressions. |
| #3386 Serve every ingested document with a lifecycle status (ty... | gedaiu | apps/lore-api/src/transport/routes/context/search-context.ts (no status, authority or ingested_at in the response); no specs/lore-document-lifecycle directory | Build the lifecycle model, ranking and checks, with the synthetic fixtures. |
| #3387 Add a /lore-distill skill that drafts reviewable decision... | gedaiu | No lore-distill skill under .claude/skills or apps/mcp-server/agent-skills; no specs/lore-distill-transcripts directory | Build the skill, its fixture and the approval-gated ingest. |
| #3493 lore-api tests: run without per-file isolation (3x faster... | gedaiu | apps/lore-api/vitest.config.ts:7-16 (default isolation, no no-isolate mode or leak guard) | Find and reset the singletons that leak between test files, add a guard against new leaks, then turn on no-isolate only if the timing gain is worth it. |
| #3521 lore-api route tests boot the whole server: 96 files, a q... | gedaiu | 98 lore-api test files import app/build-server, e.g. apps/lore-api/src/transport/routes/repos/org-settings.test.ts:2; no route-only test harness exists | Build a test server that registers only the route under test plus its auth, and move the route tests onto it. |
| #3832 T006: Implement upsertEdge() — insert edge, invalidate co... | lore-agent | graph.ts retireContradictoryEdges (closes every active edge with the same source and relation and a different target); libs/server-core/src/work/memory/graph-edge.test.ts:40 | FR-3.3 says multi-target relations coexist, but today adding 'svc depends-on redis' closes 'svc depends-on postgres'. A relation policy (single-target relations such as uses or replaced-by versus multi-target ones such as depends-on or owns) and a test for it are needed. |
| #3851 T012: Define MemoryStore interface | lore-agent | libs/shared/src/domain/memory-store-types.ts:53-80 (interface has only write, read, delete and list; `persistFact`, `writeEpisode`, `upsertEdge`, `queryGraph` and `searchMemories` exist only on the Dgraph class); memory-store.test.ts:45-88 covers the throw on a missing backend | Add search, fact, episode and graph methods to `MemoryStore` and implement them on both backends. |
| #3855 T016: Refactor existing memory modules behind store | lore-agent | libs/shared/src/outbound/project/knowledge/memory-search.ts:327-364 and apps/lore-api/src/transport/routes/memory/episode.ts:81 still call pg directly; only CRUD goes through MemoryStoreBridge (project/memory/memory-store-bridge.ts) | Send search, facts, episodes and graph production paths through the selected store, so `LORE_MEMORY_BACKEND=dgraph` actually changes their backend. |
| #3857 T018: Repoint agent cron jobs to MemoryStore | lore-agent | apps/stations/src/outbound/queues.ts:14 (TTL, decay and consolidation sweeps use `PgMemoryLifecycle`, never the selected store) | Give the lifecycle sweeps a Dgraph implementation chosen by the same backend switch. |
| #3861 T023: Implement retrieval strengthening for Dgraph | lore-agent | grep finds no strengthening or `retrieval_count` code in libs/shared/src/outbound/dgraph-*.ts; Postgres has it at project/knowledge/memory-search.ts:327 | Add fire-and-forget retrieval strengthening to Dgraph search. |
| #3864 T026: Implement upsertEntity and upsertEdge | lore-agent | libs/shared/src/outbound/dgraph-memory-store.ts:76 (`upsertEdge` only); tests :496, :541; no `upsertEntity` anywhere | Add `upsertEntity` and a test that a duplicate edge creates nothing new. |
| #3865 T027: Implement multi-hop queryGraph | lore-agent | libs/shared/src/outbound/dgraph-graph-hops.ts with tests dgraph-memory-store.test.ts:612 (depth 2) and :659 (cycle); the `lore_query_graph` tool (apps/mcp-server/src/transport/tools/graph/query-graph.ts) still gets the Postgres one-hop answer | Route `lore_query_graph` to the store's `queryGraph` (the same wiring as #3855). |
| #3866 T028: Implement neighbors and allEntityNames | lore-agent | no `neighbors` or `allEntityNames` in libs/shared/src/outbound/dgraph-*.ts (plan.md:86-87 asks for them) | Add both on Dgraph with tests that match Postgres. |
| #3867 T029: Implement snapshot and audit parity | lore-agent | no snapshot or audit code in libs/shared/src/outbound/dgraph-*.ts (plan.md:129) | Add snapshot and audit_log support on Dgraph. |
| #3868 T030: Implement lifecycle data-access methods | lore-agent | libs/shared/src/domain/memory-store-types.ts:55-82 (the MemoryStore interface has only write, read, delete and list); libs/shared/src/outbound/dgraph-memory-store.ts | Add the lifecycle and cron data-access methods to the seam, implement them in Dgraph, and add Postgres parity tests. |
| #3870 T041: Implement backfill-memory-to-dgraph exporter | lore-agent | libs/shared/src/work/backfill-memory.ts:15-24 (migrates only memory.memories and memory.facts; facts lose valid_from) | Migrate memory_versions, episodes, fact_conflicts, edges and every field, keeping reruns idempotent. |
| #3871 T042: Implement parity verification gates | lore-agent | libs/shared/src/work/backfill-parity.ts:41-62 (pure evaluateParityGates); grep finds no caller, Job or CLI in apps, scripts or deploy | Write a backfill Job entrypoint that counts rows per table, computes top-K Jaccard and exits with the gate's exitCode. |
| #3873 T051: Implement ShadowMemoryStore | lore-agent | libs/shared/src/outbound/shadow-memory-store.ts:62-75 (readMemory awaits the shadow read before returning, so a slow shadow delays the response; only readMemory is shadowed) | Run shadow reads in the background and cover every agreed read (list and search). |
| #3874 T052: Test context-assembly resilient to memory store exc... | lore-agent | libs/shared/src/outbound/project/knowledge/context-assembly-pipeline.ts:99-103 (`catch {}` sets status "error" with no metric and no log) | Emit an error metric and a diagnostic when a section reader throws, plus a test. |
| #3876 T061: Define ACL bootstrap job | lore-agent | deploy/chart/templates/lore-dgraph.yaml (dgraph/standalone, no --acl, and its only Job applies the schema); libs/shared/src/outbound/dgraph-acl-policy.ts exists but no chart satisfies it | Add the ACL-enabled Dgraph and a pre-install guardian bootstrap Job that creates lore-memory-app. |
| #3877 T062: Wire Workload Identity for credentials | lore-agent | deploy/clusters/internal-cluster.values.yaml:31-35 and :220 (Dgraph reached with no credentials at all) | Wire the runtime user's credentials through ESO, Secret Manager and Workload Identity; this depends on #3876. |
| #3878 T063: Add backup CronJob | lore-agent | deploy/chart/templates/lore-dgraph.yaml (kinds: Service, StatefulSet, PDB, ConfigMap, Job; no CronJob) | Add a Dgraph export or backup CronJob to the chart. |
| #3883 T073: Enable LORE_MEMORY_SHADOW for soak period | lore-agent | libs/shared/src/outbound/project/lib/project-factory.ts:55 (selectMemoryStore only; ShadowMemoryStore is never constructed); grep finds no LORE_MEMORY_SHADOW anywhere | Wire a LORE_MEMORY_SHADOW flag that wraps the primary store in ShadowMemoryStore, and add it to the cluster values. |
| #3889 F-asof: Expose temporal as-of graph queries | lore-agent | grep finds no as_of or asOf in apps/mcp-server/src tools or in libs/shared/src/outbound/project/knowledge (only the generated schema.d.ts:5750) | Add an as-of parameter to the graph or search tools that filters on fact validity. |
| #3903 Embeddings: a second EmbeddingProvider for clients not on... | gedaiu | libs/shared/src/outbound/embeddings/select-embedding-provider.ts:7-9 (only "vertex" is registered) | Add an OpenAI-compatible or Azure 768-dimension EmbeddingProvider that `LORE_EMBEDDING_PROVIDER` can select, plus a way to re-embed existing rows. |
| #3904 setup-*.sh schema scripts need a psql path for a managed ... | gedaiu | scripts/infra/setup-db.sh:94 (still `kubectl exec ... psql`); docs/INSTALL.md:254 describes the psql shim only in prose; setup-local-schema.sh:29 bootstraps as a superuser | Ship and document a psql-only bootstrap that works with managed-Postgres privileges and no CNPG pod. |
| #3905 Chart gaps: lore-stations pull secret; Cloud Trace role i... | gedaiu | deploy/clusters/internal-cluster.values.yaml:144-158 (no ghcr-pull-secret for the lore-stations namespace) while deploy/chart/charts/stations-helm/values.yaml:19-20 still asks for it | Mirror ghcr-pull-secret into lore-stations; the Cloud Trace role is a grant to apply in re-cinq/infrastructure, outside this repo. |
| #3909 Install Lore on a client's Kubernetes cluster with Helm a... | gedaiu | the open children #3903 and #3904 (above); rough-edges list at docs/INSTALL.md:427-435 | Land #3903, #3904 and #3905, then verify an install on a non-GKE cluster (a person has to do that part). |
| #4113 A pull request's opened event starts no review on re-cinq... | gedaiu | libs/shared/src/work/review/floor-review-start.ts:112-113 (`reviewGateOpen` false still returns null with no log; compare skipped() at :353) | Log the reason when `startReview` declines, and find out which gate held for the three pull requests. |
| #4124 A statement keeps its name when a statement is inserted a... | gedaiu | libs/shared/src/domain/utopia/names.ts:11-17 (`statementName` is still `#s` plus the ordinal); libs/shared/src/domain/spec-trace/spec-anchor.ts:1 (`path#ordinal`) | Name statements by FR label or text hash in names.ts, the Dgraph xids and the test anchors, all in one change. |
| #4125 A test covers the lines it ran, not the lines its file ran | gedaiu | apps/lore-code-trace/coverage.go:22 ("Per-test (TN:) grouping is dropped") | Attribute coverage per test, from TN records or per-test runs, and measure the CI cost. |
| #4127 Context assembly reads code coupling from Utopia's entity... | gedaiu | libs/shared/src/outbound/utopia/utopia-reads.ts:24-26 (only `search` and `documentByExternalId`; no /entities calls anywhere) | Add `entityByName` and `entityFacts` and use them for the coupling and code sections, once Utopia ships exact name lookup. |

### Test only (5)

| Ticket | By | Evidence | What is left |
|---|---|---|---|
| #1201 onboard: existence checks run against a top-level-only tr... | vvondruska | `libs/shared/src/work/onboard/onboard-scaffold.ts` (`decideScaffoldCommit` checks each exact path). `libs/shared/src/work/onboard/onboard-scaffold.test.ts:23-35` covers absent → commit and repo-owned present → skip | The specific regression tests are missing: nested path present or absent, the four ISSUE_TEMPLATE files under an existing `.github`, and a PR when only `lore-ingest.yml` is missing. |
| #3837 T012: Implement graph_augment parameter in lore_search_me... | lore-agent | libs/shared/src/outbound/project/knowledge/memory-search-graph-augment.ts:23-28 (graph hits scored at half the worst direct score); libs/shared/src/outbound/project/knowledge/memory-search.test.ts:223,246 | The tests check that graph rows appear and that false skips the query, but nothing asserts graph rows score below direct hits (FR-5.3). |
| #3841 T015: Delete static-graph.ts and remove references to gra... | lore-agent | libs/server-core/src/work/memory/graph.ts:276-282 (re-exports static-graph.ts); libs/server-core/src/work/memory/graph-handlers.test.ts:13 | static-graph.ts and graph-handlers.test.ts are dead: no app imports graphSearchHandler or getDomainSummaryHandler. Delete both and the re-export. |
| #3853 T014: Test PostgresMemoryStore base operations | lore-agent | libs/shared/src/outbound/postgres-memory-store.test.ts:38 and :160 (real-Postgres write and read); `audit_log` shows up only in cleanup | Add real-Postgres assertions for version 2 after a second write and for the audit_log row. |
| #3860 T022: Implement searchMemories for DgraphMemoryStore | lore-agent | libs/shared/src/outbound/dgraph-search.ts; dgraph-memory-store.test.ts:315 (keyword), :342 (vector) | Add a test that runs one shared fixture against both backends and compares the rankings. |

### Text stale (11)

| Ticket | By | Evidence | What is left |
|---|---|---|---|
| #1105 ADR: run all background work on assembly lines, and use G... | gedaiu | adrs/ADR-019-scheduled-job-runtime-split.md:313-319 (disposition table for the batch jobs); ADR-024 lists service stations | The ADRs need one written place that covers all nine old crons and the GitHub Actions decision, including that `github_action` is retired. |
| #1206 Onboarding docs describe an onboarding that does not exist | vvondruska | docs/using-lore/platform-engineer.md:51 ("After the PR merges, the agent automatically configures ingest secrets"); docs/using-lore/platform-engineer.md:99 (Trust Level still names an `implementation` task type) | Fix the secret-timing sentence, the generated-file table and the stale trust-level row. The `get_context` code fix and the INSTALL webhook step are done (libs/shared/src/work/onboard-content.test.ts:42, docs/INSTALL.md:327). |
| #1390 get-task-logs spec Behavior section describes the retired... | loredanamoanga | specs/mcp-tools/get-task-logs/spec.md:43-84 (still describes `getTask`, the `LORE_DB_HOST` branch and a direct GCS read) | Rewrite Behavior, Output and Dependencies and the docs/mcp-tools-reference.md line for the API-proxy-only handler, and recheck the untested markers. |
| #2307 A stale plan.md upload survives on the cluster and turns ... | loredanamoanga | specs/floor-on-ai-subsystem/spec.md:47 (still requires keeping `output.watch`); the upload and watch path is gone (ADR-047) | Change the spec text so it no longer requires keeping the retired output.watch. |
| #2573 Retired specs still read Status: Shipped, so the review l... | gedaiu | specs/6-dark-factory/spec.md:12 (Status In Progress, and the banner says its policy is "unchanged"); specs/running-stations-in-any-k8s-cluster/spec.md:7 is already Retired | The dark-factory spec needs a Retired header and a deletion notice, and the remaining specs need an audit for the same problem. |
| #2752 PM flow diagram may show the retired feature-request flow | gedaiu | badges/flow3-pm.svg:18 (`"New Task" (Feature Request)`), used by docs/using-lore/product-manager.md:13 | Redraw the PM diagram for the Plans flow. |
| #3831 T005: Implement upsertEntity() — insert or update entity,... | lore-agent | libs/server-core/src/work/memory/graph.ts upsertEntity (ON CONFLICT ... DO UPDATE SET updated_at = now() RETURNING id); graph.test.ts:27 (name normalisation) | Extraction yields only {name,type}, so there are no properties to update. Change FR-1.3 to say 'touches updated_at', or decide to extract properties. |
| #3833 T007: Implement extractAndUpdateGraph() — LLM entity extr... | lore-agent | apps/lore-api/src/transport/routes/memory/episode.ts:115-135 (graph extraction is a separate, fire-and-forget LLM call after fact extraction); graph-edge.test.ts:116,163 (failure isolation) | FR-2.1 says 'same LLM call' and NFR-1 sets a 500ms budget. The code deliberately makes a separate async call that adds no latency to the write, so the spec text needs to match. |
| #3834 T008: Implement queryLiveGraph() — query entities/edges w... | lore-agent | libs/shared/src/outbound/project/knowledge/live-graph.ts:23-34 (one hop, no depth); apps/mcp-server/src/transport/tools/memory/shared/memory-tools-schemas.ts:124-147 (no depth param) | FR-4.2 (depth default 1, max 3) is not implemented anywhere. Unsure: either drop it from the spec, or, if multi-hop is still wanted, this becomes real. |
| #3844 T001: Add lore-dgraph standalone container | lore-agent | infra/compose.yaml:14-16 and :44 (Dgraph HTTP on host 8081 on purpose, with a healthcheck); specs/memory-dgraph-migration/tasks.md:11 and plan.md:33-34 still say :8080 and `scripts/dev-local.sh` | Change tasks.md and plan.md to say compose, host port 8081 (`DGRAPH_HTTP_PORT`) and :9080. |
| #3902 Helm-only install: ingresses, Dgraph, ExternalSecrets and... | gedaiu | commit "Lore is a Helm chart only (#4197)"; deploy/chart/templates/{ingresses,externalsecrets,lore-dgraph,lore-db}.yaml and deploy/chart/charts/lore-mcp-helm/templates/agent-egress.yaml | The chart now renders these, but docs/INSTALL.md:66 ("Only a manifest, no chart") and rough edge 1 at docs/INSTALL.md:431 still describe the old gap and need rewording. |

### Needs a person (44)

| Ticket | By | Evidence | What is left |
|---|---|---|---|
| #1094 code-review-recheck: "recheck" agent node crashes the lin... | gedaiu | libs/assembly-lines/src/floor-pipelines/code-review-recheck.yaml:25-32 (recheck retries once, then fails the check); the Haiku crash path on the old Floor is gone | A person has to decide whether a recheck that still fails after its retry should turn the check red (current FR5.7) or post a failed review verdict, as the ticket asked. |
| #1115 trace_impact never shipped its Phase 0 infrastructure | gedaiu | .github/workflows/lore-trace-impact.yml (wired: posts a sticky report and annotations) | Someone has to show a real PR run in this repo with coupled statements and orphans annotated against the deployed endpoint. |
| #1116 Investigation: are agents actually using the knowledge gr... | gedaiu | apps/mcp-server/src/transport/tools/graph-episode-tools.ts (the tool exists; no measurement anywhere) | Someone has to measure graph usage in production telemetry and write up the finding and recommendation. |
| #1123 Make local agent runs easy to set up: one command from cl... | gedaiu | scripts/install.sh:88; scripts/lore-doctor.sh | Someone new has to do a recorded clean-machine walkthrough of the one-command setup, and the minikube/station assumptions have to be dropped from the ticket. |
| #1147 Carry assembly-line identity in agent events instead of i... | loredanamoanga | libs/shared/src/outbound/project/usage/usage-pg.ts:64-80 (a run id stated in the event, `$11`, wins over the CR-name lateral); libs/shared/src/outbound/project/agent-run-events/agent-run-events-pg.ts:93-122 | Lore's side is in place. Someone has to confirm the external floor actually sends run/node/iteration in its events, and that is outside this repo. |
| #1148 Consolidate agent run output behind the agent-events API;... | loredanamoanga | `adrs/ADR-037-sse-run-observability.md` retires the archive. A search for `LORE_AGENT_EVENTS_BUCKET` and `archiveRaw` in apps, libs and infra finds nothing. `apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.tsx` shows the turns | Someone has to confirm the deployed release no longer sets the bucket env var and that old `__agent_events__/` objects have aged out. |
| #1155 /audit?op=write hangs indefinitely while unfiltered /audi... | loredanamoanga | apps/web-ui/src/app/audit/page.tsx:46-63 (now fetched through lore-api; an API failure renders an empty page) | Someone has to reproduce or rule out the hang on the live `/audit?op=write`; there is no regression test for it. |
| #1237 station_run_id has no consumer: subsystem should stamp it... | gedaiu | libs/shared/src/outbound/project/run-identity/carried-run-identity.ts (Lore already prefers the carried run identity) | Check that the external floor/subsystem stamps the identity on every pod, then decide when to retire the fallback. |
| #1318 code-review recheck: verdict lost when the pod is GC'd be... | loredanamoanga | specs/external-floor/spec.md (review runs on the external floor; the GC race is in ai-agent-subsystem) | Check upstream that output survives pod GC, or replay a GC'd Succeeded run on the live system. |
| #1320 lore-api /api/context timeouts make agents run cold (six ... | loredanamoanga | the Floor's hydration fetch is gone (CLAUDE.md); context now comes through apps/mcp-server/src/transport/tools/context-tools-assemble.ts | Measure /api/context latency in production and decide whether to alert on cold runs. |
| #1388 Job-run logs (__job_runs__/) are GCS-only — decide their ... | loredanamoanga | apps/lore-api/src/transport/routes/tasks/job-run-logs.ts:63 (still dynamically imports `@google-cloud/storage`) | Someone has to decide where historical job-run logs live, or that they are dropped, before the GCS read route can go. |
| #1631 code-review line fails at exactly 26m10s without reaching... | gedaiu | `libs/assembly-lines/src/floor-pipelines/code-review.yaml:89-100` (25-minute budget). `apps/stations/src/code-review/run-settled/station.ts:121-138` fails the check when no verdict arrives | The original 26m10s cause can only be found from run and pod evidence, and the required branch-protection checks are a repo setting someone has to change. |
| #2020 Run page shows BackoffLimitExceeded when an agent pod was... | gedaiu | No non-test OOMKilled handling exists in apps/ or libs/. The old producer (cluster-agent) is deleted, so the termination reason now has to come from the external floor. | Someone has to get the external floor to report OOM, eviction and deadline reasons plus limits. Lore only forwards the failure detail it is given. |
| #2104 Pods intermittently fail to clone with 'Repository not fo... | loredanamoanga | apps/lore-api/src/transport/routes/floor/git-credential.ts has no info/refs readiness probe; the root cause was never measured | Correlate live mint and clone failures to confirm the cause, then decide on the probe-and-retry fix. |
| #2348 Agent pods can reach any host on :443 and run with tool p... | QuintinBotes | the infra/ tree holds only chart-ci-values and compose.yaml, so the ai-agents helm NetworkPolicy is gone; permission mode is now a floor setting (`permissionMode?: "auto" or "bypass"` in the floor-contracts wire types) | An egress allowlist and a non-bypass permission mode have to be applied in floor/cluster infrastructure, outside this repo. |
| #2357 GitHub read routes proxy any repo the App can see, onboar... | QuintinBotes | commit "GitHub reads answer 404 for a repo that was never onboarded to Lore (#2434)" (onboardedProject is used in every repos/* GitHub read); cross_repo is limited to cross_repo_repos (libs/shared/src/outbound/project/knowledge/context-assembly-fetchers-social.ts:92) | Binding tokens to a repo or team needs an ADR, i.e. a product decision. |
| #2368 Retention covers telemetry only; content stores have no p... | QuintinBotes | docs has no data-inventory file; no DELETE on memory.episodes, memory_versions, audit_log or pipeline.audit_log outside tests | Retention periods are a product and legal decision; once decided, the inventory doc and prune jobs still need writing. |
| #2381 A node that is still running says its turns were 'pruned ... | QuintinBotes | apps/web-ui/src/app/assembly-runs/[id]/TranscriptView.tsx:68 (running wording fixed); apps/web-ui/src/app/onboard/page.tsx:38 (redirects to the repo with no banner) | Onboarding success still shows no confirmation or link to the run, which is a small code fix; the rest needs production: fixing the HALEngine row and retesting the runs tab. |
| #2397 An evaluation gate for context quality | QuintinBotes | specs/context-evals/spec.md:11,19 makes evals manual and not in CI; scripts/context-evals/run.mjs exists; no workflow runs it | A person has to decide between the manual-eval spec and a mandatory CI gate. |
| #2440 docs ingest (lore-code-trace docs --post --force) times o... | gedaiu | apps/lore-code-trace/ingest.go:74 (deltaRequestTimeout = 30 min); ingest_test.go:617 TestPostIngestDeltaNeverRetriesItsOwnTimeout | Re-run the full HALEngine --force docs backfill and confirm it finishes. |
| #2542 issue-triage: nothing creates the eight triage:* labels (... | gedaiu | libs/shared/src/work/onboard/enrol-repo.ts:48 calls createDispatchLabels; onboard-audit.ts:81 onward defines the triage labels (new onboardings are covered) | Backfill the eight labels into repositories that were onboarded earlier, and confirm they are there. |
| #2669 Gemini dod pod refused git add, git commit and prettier b... | gedaiu | The refusal comes from the deployed ai-agent v0.11.10 policy, not from Lore code; apps/mcp-server/agent-skills/skills/lore-context/guard-tests.sh | Replay git add, git commit and prettier on the deployed ai-agent image and check its tool policy. |
| #2759 Plan: give implementation-loop rounds the repository's de... | gedaiu | libs/shared/src/agent-defaults/loop-tdd-round.md:177-178 (npm ci allowed only for formatting); no plan document found | Someone must choose the dependency strategy and measure install time and disk on Lore and on one non-Node repository. |
| #2766 Retire Dgraph: mirror the code-to-spec graph in Utopia, s... | gedaiu | libs/shared/src/work/utopia/docs/mirror-document.ts:103-115 (`unmirrorDocument` now tombstones every statement of a deleted document; tested in mirror-document.test.ts:219-225) | Check the live Utopia setup and NetworkPolicy access. |
| #3384 Finish onboarding ai-agent-subsystem: first ingest, team ... | gedaiu | Live data only; apps/lore-api/src/transport/routes/repos/repo-settings.ts supports the settings write | Run the first ingest, set team and auto_ingest_graph through the API, record how, and run the listed queries. |
| #3388 ADR: org branch-protection rules and the review window fo... | gedaiu | adrs/ADR-051-protected-branch-approver.md:31 and :35 (branch rule described, auto_merge.min_age_hours is a minimum age only) | A person must decide and record the no-review window and whether it closes or escalates, name who accepted the agent-approval risk, and quote the live org branch settings. |
| #3827 T001: Create memory.entities table with unique index on (... | lore-agent | scripts/infra/setup-memory-schema.sh:156-167 (table plus unique index on name, entity_type, COALESCE(repo,'')); libs/server-core/src/work/memory/graph.ts upsertEntity relies on ON CONFLICT against that index | Someone has to run the schema script on the real database and confirm the table and index exist there. No test runs the DDL. |
| #3828 T002: Create memory.edges table with temporal validity co... | lore-agent | scripts/infra/setup-memory-schema.sh:170-181 (memory.edges with REFERENCES memory.entities(id), valid_from/valid_to, provenance columns) | Someone has to confirm on the real database that the table and its foreign keys exist. |
| #3829 T003: Add partial indexes for active edges (valid_to IS N... | lore-agent | scripts/infra/setup-memory-schema.sh:183-188 (three partial indexes WHERE valid_to IS NULL) | Someone has to run EXPLAIN on a real database to show the active-edge queries use these indexes. |
| #3880 T070: Verify full suite green and typecheck clean | lore-agent | libs/shared/src/outbound/memory-store.ts:30 (default postgres); libs/shared/src/outbound/memory-store.test.ts | Someone has to confirm a fully green CI run on main. |
| #3881 T071: Manually verify end-to-end against local Dgraph | lore-agent | libs/shared/src/outbound/memory-store.ts:32 (dgraph branch); libs/shared/src/outbound/project/lib/project-factory.ts:55 | Manual MCP run against a local Dgraph; it is only meaningful once #3868 and #3870 land. |
| #3882 T072: Run and verify backfill Job in staging | lore-agent | libs/shared/src/work/backfill-memory.ts; no Job exists in deploy/chart | A staging run, which is blocked until the #3870 and #3871 Job exists. |
| #3884 T083: Monitor production shadow metrics | lore-agent | libs/shared/src/outbound/shadow-memory-store.ts (divergence metric) | Watch production divergence for 7 days after #3873 and #3883. |
| #3885 T074: Cutover to Dgraph as primary backend | lore-agent | libs/shared/src/outbound/memory-store.ts:26-44; memory-store.test.ts:74 (flip test) | An operator flips LORE_MEMORY_BACKEND=dgraph in deploy/clusters values once the soak passes. |
| #3886 T084: Monitor production cutover | lore-agent | specs/memory-dgraph-migration/spec.md:252 | Watch production through the rollback window. |
| #3887 T075: Decommission Postgres memory schema | lore-agent | CLAUDE.md:237 (memory still lives in Postgres); libs/shared/src/outbound/postgres-memory-store.ts | Gated on the cutover and on the #3890 decision; then remove the Postgres memory code and schema. |
| #3888 F-replica: Evaluate scaling Dgraph to a replica group | lore-agent | deploy/chart/templates/lore-dgraph.yaml:25 (replicas: 1); spec.md:262 | A capacity decision someone has to make. |
| #3890 F-pg-retire: Decide Postgres code sunset date | lore-agent | specs/memory-dgraph-migration/spec.md:263 (still an open question) | The owner has to pick and record a sunset date. |
| #3996 Story: change an agent in one place and see that it runs | gedaiu | Slice 1 is done (#3995, above); slices 2 and 3 live in re-cinq/ai-agent-subsystem#335 and re-cinq/floor#60 | Someone has to confirm the two other repos' slices landed and that runs share one AgentDefinition in the cluster. |
| #4021 Return the whole requirement around a Utopia hit, not a c... | gedaiu | libs/shared/src/outbound/project/knowledge/context-assembly-utopia-sections.ts:1,31 (`widenedChunks`, FR13.10) | Reader side is done; the Utopia search-side half and the 20-document eval rerun on lore and Otto remain. |
| #4095 A node upgrade can still take Dgraph offline for 40 minut... | saadahmed95 | deploy/chart/templates/lore-dgraph.yaml:68 (a PodDisruptionBudget only, with no note accepting the risk) | Find out why the disk stayed attached for about 40 minutes, then either fix that or write an accept-the-risk note next to the budget, now in the chart. |
| #4150 Re-projecting a spec rewrites every statement in it, so a... | saadahmed95 | commit "Write only the statements a re-projection changes (#4174)"; libs/shared/src/work/spec-trace/project-spec-file-skip.test.ts:105,122 | Code and tests are in; what remains is the post-deploy `[ingest-delta]` timing for a one-statement edit to 7-feature-planning. |
| #4195 Remove dead Utopia sources (test-coverage-unused and olde... | gedaiu | an operational purge of Utopia sources; no code involved | Check each dead source's last push and document count, then delete the dead ones with a Job. |
| #4315 Spec planning cannot finish on a large spec whose stateme... | saadahmed95 | libs/shared/src/work/spec-tickets/settled-statements.ts plus settled-statements.test.ts:99-346; apps/stations/src/spec-tickets/load-tickets/station.ts:123 | Settling is built and tested; acceptance criterion 8 (the large private spec gets through a run) needs a live run. |

### Not settled (5)

| Ticket | By | Evidence | What is left |
|---|---|---|---|
| #1104 Audit lore-api for leanness and duplication against libs/ | gedaiu | apps/lore-api/src/transport/routes/** (no audit artifact found); open-ended "audit for leanness" with no checkable criterion | Someone has to pick concrete route-to-lib moves, or close it as too vague. |
| #1345 floor: move episode auto-curation into the retrospective ... | gedaiu | libs/shared/src/work/episode-writer.ts; apps/stations/src/code-review/run-settled/run-episode.ts | The retrospective station is gone. run-settled writes episodes, and merge and rejected-PR curation write lessons, so someone has to decide whether that replaces auto-curation. |
| #2175 The spec-write pod never sees spec-plan.json: analyse-spe... | gedaiu | libs/assembly-lines/src/floor-pipelines/feature-planning.yaml:514-634 (`spec_plan` is wired as spec-plan.json into several steps) | The analysis file now reaches draft and rework. I did not confirm that the staged per-section writer receives it or obeys it. |
| #2256 Plan editor's delete proposal shows only "This paragraph ... | loredanamoanga | apps/web-ui/package.json:23 pins planning-editor-dist-v0.14.0; the card is rendered inside the external planning-station package, which is not vendored here | Someone has to check upstream planning-station InlineChanges for v0.14.0. Nothing in this repo can fix or show the bug. |
| #2378 web-ui: pages after an action and the run lists never upd... | QuintinBotes | apps/web-ui/src/app/assembly-runs/AssemblyRunsLive.tsx + useRunsChannel.ts (run list is now live); task page deleted; usePlanRunLive.ts folds frames without router.refresh | Not checked whether the Loops tab, the overview enrollment section and the requested live activity line now update live. |

### Done (43)

| Ticket | By | Evidence | What is left |
|---|---|---|---|
| #1108 Agent config has three sources of truth (task-types.yaml,... | gedaiu | CLAUDE.md:101 (`withAgentDefinitions` in libs/shared/src/outbound/project/agents/pipeline-agents.ts; `pipelineProblems` fails a pipeline that inlines `agent_definitions` or names an agent with no md file); CLAUDE.md:544 (`lore.agent_definitions` dropped in migration 0122, the floor is the only store) |  |
| #1203 vars.LORE_WEBHOOK_URL is never set — every scaffolded lor... | vvondruska | `libs/shared/src/lib/lore-tests-instruction.ts:8` now binds `LORE_API_URL` from `secrets.LORE_INGEST_URL` or the vars and says "Do not pass LORE_WEBHOOK_URL". Test at `libs/shared/src/lib/lore-tests-instruction.test.ts:38` |  |
| #1204 CLAUDE.md is promised by onboarding in four places and ge... | vvondruska | Option B was taken. `libs/shared/src/work/onboard-content.ts:224` says "Do not author CLAUDE.md". `libs/shared/src/work/onboard-content.test.ts:109,173`. Root `CLAUDE.md:407` now says "the owner authors CLAUDE.md" |  |
| #1246 ADR-037 has fused-paragraph stranded test links (same cla... | loredanamoanga | adrs/ADR-037-sse-run-observability.md:71-78 (each statement is now its own paragraph with a trailing hashed link); commit "Spec link parser: a test link in any trailing link group counts (#3517)" |  |
| #1338 floor: move the onboard handler out of the Floor process ... | gedaiu | libs/assembly-lines/src/floor-pipelines/onboard.yaml; apps/stations/src/onboard |  |
| #1346 floor: move memory consolidation (the Haiku half) into a ... | gedaiu | apps/stations/src/work/consolidation/manifest.ts:4-15 and consolidation.ts:30-39 (nightly sweep, 7-day window of 50 facts, grouped by repo, model call, memory write) |  |
| #1395 spec-link parser: a period inside a backticked link label... | loredanamoanga | libs/shared/src/domain/spec-sentence-split.ts:31 (`OPEN_BACKTICK_LINK_LABEL`); libs/shared/src/domain/spec-link-parser.acceptance.test.ts:29 (Number.MAX_SAFE_INTEGER regression) |  |
| #1404 Nothing validates that a [validated by] link points at a ... | gedaiu | apps/lore-code-trace/links_run_test.go:107 TestRunLinksAgainstABaseReportsASpecWhoseTestFileTheChangeDeleted; apps/lore-code-trace/links_test.go:72,83 (missing file, line past end of file) |  |
| #1453 memory_ttl CronJob dispatches a job the runner does not k... | loredanamoanga | apps/stations/src/work/memory-ttl/memory-ttl.ts; deploy/chart/charts/stations-helm/values.yaml:129-133 (the memory-ttl courier replaces the Floor CronJob, and apps/floor is gone) |  |
| #1593 no-dead-spec-links cannot see an anchor that rotted onto ... | gedaiu | node_modules/@re-cinq/eslint-plugin-re-lint/dist/rules/no-stale-spec-links.mjs:1-11 (content-hash anchors follow the test by its line content and re-anchor by title); no-rotten-spec-links.mjs:2-5 (reports an anchor on a blank or closing line); eslint.config.mjs:670 |  |
| #1842 Onboard this repo into Lore: add missing baseline scaffol... | vvondruska | CLAUDE.md, AGENTS.md and .github/PULL_REQUEST_TEMPLATE.md all exist in this repo, plus CI workflows |  |
| #2069 Backlog loop re-runs a ticket whose fix already merged: a... | gedaiu | libs/shared/src/work/backlog/loop-merge-success.ts:118-130 (on merge of the loop branch's PR: task set to `merged`, issue closed); loop-merge-success.test.ts:104 |  |
| #2124 Deploy failed: lore-stations is running an older image th... | github-actions | `deploy(lore-stations): 4b69d3c (#4508)` on 2026-11-12. The reporting script still exists at scripts/ci/report-deploy-failure.sh |  |
| #2299 Approve starts a second spec pass when the plan's line is... | loredanamoanga | libs/shared/src/work/feature-planning/floor-plan-runs.ts:110,134-137 (an open run always has a node: last visited, or analyze); test at floor-plan-runs.test.ts:119 |  |
| #2300 A Refine on a plan whose line ended could start a fresh p... | loredanamoanga | apps/lore-api/src/work/plans/floor-plan-line.ts:132-162 (Refine starts analyze by hand on any run, or opens a new run via startRunToRefine) |  |
| #2353 Cancelling a task ends its runs but leaves the agent pod ... | QuintinBotes | apps/lore-api/src/work/floor/cancel-run.ts (run-page cancel calls `floor.runs.cancel`); apps/lore-api/src/work/plans/floor-plan-line.ts:273-274 (plan reopen cancels the floor run) |  |
| #2355 API rate limiter is one global bucket per route class, ru... | QuintinBotes | commit "The API rate limiter counts each caller separately, so an anonymous flood can no longer lock out everyone else (#2438)"; apps/lore-api/src/transport/http/rate-limit.ts:48-75 (per-principal, post-auth); apps/lore-api/src/work/assembly-line-station/upgrade-gate.ts:9-10 (socket caps) |  |
| #2358 The automerge label gives merge authority to anyone who c... | QuintinBotes | commit 8758e6210 "chore(T018): retire the auto-merge label workflow (#2743)"; .github/workflows/auto-merge.yml no longer exists |  |
| #2369 Post line-review findings to the PR, so Lore-authored PRs... | QuintinBotes | libs/shared/src/work/review/code-review-decisions.ts:31 (`start: author === loreAppLogin or not a bot`, so Lore's own PRs get reviewed: option b) |  |
| #2375 Planning prompts exist twice: the floor pipeline YAML run... | QuintinBotes | libs/assembly-lines/src/floor-pipelines/feature-planning.yaml:361 (`agent_definition: plan-analyze`, no inline prompts left; `grep -c prompt` gives 0); CLAUDE.md:101 (`pipelineProblems` guard) |  |
| #2380 Cancel, Request revision and Run now are unreachable for ... | QuintinBotes | apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunView.tsx:154 (CancelTaskButton on the run page, with CancelTaskButton.test.tsx); task page and revision form deleted on purpose |  |
| #2400 Deploy failed: lore-ui is running an older image than main | github-actions | `deploy(lore-ui): b0ecd40 (#4491)` on 2026-11-12. .github/workflows/build-ui.yml:90 still reports deploy failures |  |
| #2458 Every assembled context warns it is stale: nothing update... | gedaiu | apps/lore-api/src/transport/routes/ingest/ingest.ts:63 (content ingest calls markIngested); ingest-delta-deps.ts:181; test ingest.acceptance.test.ts:53-80 |  |
| #2589 A lint rule should enforce a spec's Status row, not a rob... | gedaiu | eslint.config.mjs:649 enables re-lint/require-status-matches-coverage; spec-status-flip.ts is gone (apps/stations/src/work/merge-check has no flip step) |  |
| #2639 Deploy failed: lore-api is running an older image than main | github-actions | `deploy(lore-api): 4b69d3c (#4510)` on 2026-11-12 |  |
| #2656 Deploy failed: lore-mcp-gateway is running an older image... | github-actions | `deploy(lore-mcp-gateway): 4b69d3c (#4509)` on 2026-11-12 |  |
| #3830 T004: Implement parseGraphExtraction() — parse LLM output... | lore-agent | libs/server-core/src/work/memory/graph.ts:33 parseGraphExtraction; libs/server-core/src/work/memory/graph.test.ts:5,39,54,73 (JSON parse, code fence, cap at 10, missing fields filtered) |  |
| #3835 T009: Register lore_query_graph MCP tool with entity, rel... | lore-agent | apps/lore-api/src/transport/routes/graph/graph.test.ts:31,55,71,77,84; apps/mcp-server/src/transport/tools/graph/query-graph.test.ts:23,50; libs/shared/src/outbound/project/knowledge/knowledge-memory.test.ts:22 |  |
| #3836 T010: Wire graph extraction into lore_write_episode handl... | lore-agent | apps/lore-api/src/transport/routes/memory/episode.ts:129 extractAndUpdateGraph(...).catch; apps/lore-api/src/transport/routes/memory/episode.test.ts:116,175 |  |
| #3838 T011: Unit tests for graph extraction parsing and edge in... | lore-agent | libs/server-core/src/work/memory/graph-edge.test.ts:40,86,116,163 (drives the real extractAndUpdateGraph through a scripted pool) |  |
| #3845 T002: Write setup-memory-dgraph-schema.sh | lore-agent | scripts/infra/setup-memory-dgraph-schema.sh; libs/shared/src/outbound/setup-memory-dgraph-schema.test.ts:42 |  |
| #3846 T003: Test Dgraph schema setup idempotency | lore-agent | libs/shared/src/outbound/setup-memory-dgraph-schema.test.ts:42 (HNSW and xid indexes) and :57 (a second apply is idempotent) |  |
| #3847 T004: Build dgraph-client.ts | lore-agent | libs/shared/src/outbound/dgraph-client.ts (configured from `LORE_DGRAPH_HTTP`, query and mutate go through `newTxn`); dgraph-client.test.ts:5 |  |
| #3848 T005: Test dgraph-client.ts | lore-agent | libs/shared/src/outbound/dgraph-memory-store.test.ts:201 (live write then read through the real client) |  |
| #3850 T011: Extract pure memory ranking functions | lore-agent | libs/shared/src/domain/memory-ranking.ts (shared `rrfMerge` and diversification, used by dgraph-search.ts and project/knowledge/memory-search.ts); memory-ranking.test.ts |  |
| #3854 T015: Implement PostgresMemoryStore | lore-agent | libs/shared/src/outbound/postgres-memory-store.ts; postgres-memory-store.test.ts:38, :81, :117, :278-464 |  |
| #3856 T017: Wire memoryStore registration in mcp-server | lore-agent | libs/shared/src/outbound/project/lib/project-factory.ts:55-57 (`selectMemoryStore` registered as the memory port); memory-store-bridge.test.ts, memory-store.test.ts |  |
| #3858 T020: Implement read/write for DgraphMemoryStore | lore-agent | libs/shared/src/outbound/dgraph-memory-store.test.ts:201, :223 (version 2), :243 (expired TTL excluded) |  |
| #3859 T021: Implement soft-delete and list for DgraphMemoryStore | lore-agent | libs/shared/src/outbound/dgraph-memory-store.test.ts:278 (soft delete), :293 (list total and live keys); same cases in postgres-memory-store.test.ts:81 and :117 |  |
| #3862 T024: Implement persistFact and contradiction detection | lore-agent | libs/shared/src/outbound/dgraph-fact-contradictions.ts; dgraph-memory-store.test.ts:65 and :137 (near-duplicate invalidated, FactConflict recorded) |  |
| #3863 T025: Implement writeEpisode with deduplication | lore-agent | libs/shared/src/outbound/dgraph-fact-episode.ts; dgraph-memory-store.test.ts:409 (same content twice gives one Episode) |  |
| #3995 Agents live on the floor: Lore reads and writes them ther... | gedaiu | libs/shared/src/outbound/project/agents/agent-defs-floor.ts:1 (floor reads and writes, per-repo variants); apps/lore-api/src/work/floor/seed-floor-pipelines.ts:124 (seeds only when the floor holds none); libs/assembly-lines/src/pipeline-lint.ts:92-99 |  |
| #4069 A renamed or removed test stays in main's graph, because ... | saadahmed95 | commit "A test report replaces its files' rows, and a full ingest drops test files the tree no longer holds (#4094)"; libs/shared/src/work/spec-trace/prune-test-files.ts:50 plus prune-unreported-tests.test.ts |  |

### Retired (57)

| Ticket | By | Evidence | What is left |
|---|---|---|---|
| #1119 repos/<owner>/<repo>/features is broken — test and finish it | gedaiu | CLAUDE.md (planning wizard replaced by live plans; lore.features dropped); apps/web-ui/src/app/repos/[owner]/[repo]/ has no features/ directory |  |
| #1138 Floor never creates the task branch for general tasks — f... | loredanamoanga | `apps/floor` is gone (ls apps: no floor); `general` task type and creating tasks from a description were deleted on purpose (CLAUDE.md) |  |
| #1144 fork-and-rerun has no trigger surface: run-page "rerun fr... | loredanamoanga | specs/external-floor/spec.md (fork-from-node and starting a run by definition name were removed on purpose; retries happen on the external floor) |  |
| #1221 DecompositionProgressCard shows no time budget and no tok... | gedaiu | No DecompositionProgressCard anywhere under apps/web-ui/src; planning wizard/decompose tail removed (CLAUDE.md) |  |
| #1265 builtin-definitions-drift guard is vacuous: it regenerate... | gedaiu | scripts/ has no check-builtin-definitions-drift.sh, and package.json and .github have no gen:builtin-definitions |  |
| #1267 UI-authored agent recipes carry no resources.secrets — no... | gedaiu | agentDefToCrds and apps/floor are gone; nothing in apps/ or libs/ matches |  |
| #1269 Floor run routes never got the AssemblyRun rename: /api/a... | gedaiu | The Floor HTTP routes (`apps/floor/...assembly-line-reads.ts`, agent-events-stream) are gone with apps/floor. `specs/external-floor/spec.md` describes the new run-read path |  |
| #1270 assembly_run.* events still carry params.assemblyLineId —... | gedaiu | The readers (`apps/floor/src/jobs/assembly-line/start-event-handler.ts` and `resume-event-handler.ts`) are deleted, so a readers-first flip has nothing to flip against |  |
| #1291 Agent pods sit minutes in Pending: node pool at memory sa... | gedaiu | CLAUDE.md (agent pods run on the external floor); apps/floor deleted |  |
| #1321 Reaper's per-task-token writes conflict on agent-secrets ... | loredanamoanga | KubeSecretKeyWriter and the reaper were deleted with apps/floor (CLAUDE.md) |  |
| #1332 Per-Station history limits do not bound the namespace tot... | gedaiu | CLAUDE.md lists the Agent custom resource and Lore's controller and per-task Stations as deleted on purpose |  |
| #1339 floor: move the feature-request handler out of the Floor ... | gedaiu | CLAUDE.md lists the `feature-request` task type as deleted; apps/floor is gone |  |
| #1340 floor: move context reindex onto the ingest assembly line | gedaiu | ADR-019:313-319 marks reindex retired; apps/floor and its ingest line are deleted |  |
| #1342 floor: move the promptfoo eval-runner into a station | gedaiu | adrs/ADR-019-scheduled-job-runtime-split.md:314 (`eval_runner` deleted 2026-10-02 and replaced by a nightly GitHub Actions job, #2443) |  |
| #1343 floor: move the context-core-builder into a station | gedaiu | ADR-019 disposition table (the context-core-builder was deleted along with the Floor's CronJobs) |  |
| #1344 floor: PR/Issue copy generation belongs in the agent's ou... | gedaiu | apps/floor and its `jobs/lib/artifact-copy.ts` are deleted; copy now comes from a deliberate station-side LLM call in apps/stations/src/implementation-loop/ready-for-review/station.ts:53-63 (the FR12.21 design the reconciliation note cites) |  |
| #1347 floor: move the six read-only REST routes to lore-api | gedaiu | CLAUDE.md:101 (apps/floor deleted 2026-10-02); run reads served by apps/lore-api/src/transport/routes/floor/ |  |
| #1352 floor: move the ci-ingest and ci-tests ingest routes to l... | gedaiu | Floor routes are gone with apps/floor (CLAUDE.md:101); apps/lore-code-trace/main.go no longer contains a webhook/ci-tests fallback |  |
| #1354 floor: split merge-check — keep merge authority, move out... | gedaiu | apps/floor deleted; the merge reactions now live in apps/stations/src/work/merge-check/merge-check.ts:244 (promoteTrust) and merge-step |  |
| #1368 prompt_ref: push-only resolves to nothing — buildPrompt s... | gedaiu | the old walk's prompt_ref and buildPrompt were removed in #2454; push nodes and the general recipe no longer exist |  |
| #1369 A failed / needs-human-help planning run is invisible on ... | gedaiu | Feature page, FailureBlock and the planning wizard were deleted on purpose (CLAUDE.md: planning wizard became live plans) |  |
| #1378 ai-agents crd-upgrade hook image is gone from Docker Hub ... | loredanamoanga | infra/terraform/modules/gke-mcp/lore-platform/charts/ no longer exists, and no `crdUpgrade` or `bitnami` reference is left in infra |  |
| #1394 Relay retry still double-counts llm_calls and duplicates ... | loredanamoanga | apps/lore-api/src/transport/routes/tasks/task-turns.ts:112 (only `PgAgentRunTurns.insertBatch`; the fan-out to llm_calls and agent_run_events left with the Floor) |  |
| #1405 builtin-definitions-drift guards an untracked file nothin... | gedaiu | scripts/check-builtin-definitions-drift.sh is gone; no `builtin-definitions` in .github/workflows or package.json |  |
| #1452 Floor crash-loops on missing pipeline.tasks.dark_factory_... | loredanamoanga | deploy/chart/charts/ui-helm/migrations/0043_tasks_late_columns.sql added the column; 0099_drop_dark_factory_overrides.sql drops it along with Dark Factory |  |
| #1454 A failed task-worker poll kills the whole Floor process —... | loredanamoanga | apps/floor is deleted (CLAUDE.md); worker.ts pollOnce no longer exists |  |
| #1463 Legacy planning prompt embeds the prior round's full GapR... | gedaiu | CLAUDE.md (lore.features and the wizard dropped); no composePlanningPrompt anywhere in apps or libs |  |
| #1502 TaskLogs turn-cap test is flaky: 10,000-row fixture again... | gedaiu | No apps/web-ui/src/app/tasks directory; TaskLogs no longer exists |  |
| #1503 recheck node records failed when its agent returned CHANG... | gedaiu | The watcher that recorded the outcome left with apps/floor and the Agent CR. `adrs/ADR-049-external-floor.md:38-39` |  |
| #1506 Orphaned def-gate and def-github_action rows in lore.agen... | gedaiu | deploy/chart/charts/ui-helm/migrations/0122_drop_agent_definitions.sql; 0098_remove_station_recipes.sql |  |
| #1512 Finish the planning extraction: kickPlanning still lives ... | gedaiu | no kickPlanning anywhere in apps or libs; planning runs on the floor (apps/lore-api/src/work/plans/floor-plan-line.ts) |  |
| #1514 Finish the Floor split: escalation to a station, the pure... | gedaiu | The internal Floor split targets deleted code: apps/floor jobs and Dark Factory are removed. `specs/station-consolidation/spec.md:18` |  |
| #1538 Per-task GH_TOKEN keys leak into agent-secrets until the ... | gedaiu | The per-task GH_TOKEN_* producer is gone (no GH_TOKEN_ in apps or libs); credentials now come from apps/lore-api/src/transport/routes/floor/git-credential.ts |  |
| #1547 Validate station fails every run: lint/build execute in a... | gedaiu | the validate station is gone (apps/stations/src/work has no validate; removed in #2447) |  |
| #1592 Reaper cannot resolve a dropped event for a satellite-exe... | gedaiu | The reaper, `decideNodeRecovery`, the cluster-agent complete route and satellite nodes were all deleted. Recovery now belongs to the external floor (`adrs/ADR-049-external-floor.md:38-39`) |  |
| #1618 Satellites need a scoped station credential so they can s... | gedaiu | apps/cluster-agent and the satellite or station recipes are deleted; adrs/ADR-049-external-floor.md |  |
| #1621 62 ingest station nodes sit queued past 30m unclaimed whi... | gedaiu | The claim loop, cluster-agent tags and the ingest node station were deleted (node stations are removed per CLAUDE.md) |  |
| #1653 stationOutcomeForRunOutcome maps an unrecognised run outc... | gedaiu | stationOutcomeForRunOutcome no longer exists in apps/ or libs/ (the apps/floor watcher was deleted) |  |
| #1654 A paused cluster-agent is indistinguishable from an idle ... | gedaiu | apps/lore-api/src/api/routes/cluster-agents is gone (Lore's cluster-agent and reaper were removed) |  |
| #1657 terraform helm_release uses --wait, which CI proved wedge... | gedaiu | infra/ holds only compose.yaml and chart-ci-values; no Terraform helm_release in the repo; Argo CD deploys deploy/chart |  |
| #2068 Deploy failed: lore-floor is running an older image than ... | github-actions | No build workflow for lore-floor in .github/workflows/ and no `deploy(lore-floor)` commits. The ticket's own reconciliation cites adrs/ADR-049-external-floor.md:38 (Lore's own Floor deployment removed) |  |
| #2106 A /agents row can be reset to its shipped default | gedaiu | CLAUDE.md: the lore.agent_definitions table and the Agent custom resource were deleted |  |
| #2107 The org agent-definition PUT refuses a promptless claude-... | gedaiu | apps/lore-api/src/transport/routes/agent-definitions/org-update.ts:121 ("Only the patched fields change on the floor"); CLAUDE.md:544 (lore.agent_definitions table gone, migration 0122) |  |
| #2108 The catalog sync prunes CRs no definition row names | gedaiu | apps/cluster-agent no longer exists (apps/ has agent-image, lore-api, lore-code-trace, mcp-server, stations, vscode-extension, web-ui); the catalog sync went with it |  |
| #2109 /agents shows a cluster that has never synced its catalog | gedaiu | The cluster-agent catalog and sync design is gone (no cluster-agents app dir; agent definitions deleted) |  |
| #2135 run-station retires the source run without its close hook... | gedaiu | no retireIfOpen or run-station anywhere; start-by-hand reopens the floor run (apps/lore-api/src/work/floor/run-node-by-hand.ts) |  |
| #2192 A spec-write attempt committed spec-review-result.json in... | gedaiu | libs/assembly-lines/src/floor-pipelines/feature-planning.yaml:611-614 (spec_review is a floor `produces` artifact, not the old apps/floor watch/sink) |  |
| #2208 Spec ingest dies at its deadline, so the spec graph stays... | loredanamoanga | .github/workflows/lore-ingest.yml:128-138 (the graph job now fails loudly); the ingest agent pod with a deadline was replaced by synchronous lore-code-trace ingestion |  |
| #2214 validate station runs the checks unscoped over the whole ... | loredanamoanga | the validate station was deleted (#2447) |  |
| #2370 A transient PR-open failure parks an implementation-loop ... | QuintinBotes | the code it cites (apps/floor/src/work/assembly-run/finish-node.ts, spec-pr.ts) is gone; opening PRs and stamping them now happens on the external floor |  |
| #2371 Floor reliability: findings to carry into the extracted F... | QuintinBotes | every finding is about apps/floor (worker, drain loop, shutdown, recoverStaleTasks, launch-node), which was deleted; the ticket itself says to carry them to the extracted floor |  |
| #2374 Auto-merge's review-in-flight gate fails open when the ex... | QuintinBotes | apps/floor/src/work/merge/pr-policy.ts and auto-merge.ts are deleted; the new merge path (apps/stations/src/auto-merge/station.ts, floor-pipelines/auto-merge.yaml) has no try/catch on a review-in-flight check that could fail open |  |
| #2388 Operator alerts go to whichever repo failed first and use... | QuintinBotes | billing-alert.ts, agent-config-alert.ts and the node-event handler lived in apps/floor, which is deleted; no billing or ops-alert throttle exists under apps/*/src or libs/*/src |  |
| #2486 Deploy failed: lore-event-router is running an older imag... | github-actions | No `deploy(lore-event-router)` commits and no build workflow for it in .github/workflows/. specs/1-lore-platform/spec.md:617 says lore-api now writes pipeline.events itself, so the event-router is gone |  |
| #3839 T013: Write one-time migration script for graphrag/graph.... | lore-agent | graveyard/agent-prompts/graphrag-build.md (the offline graph build is in the graveyard); no graphrag/ directory on main |  |
| #3840 T014: Run migration script on production database | lore-agent | same as 3839: there is no graph.json producer or file left to import |  |
| #3906 Terraform hardcodes re-cinq values and keeps a dead module | gedaiu | commit "Lore is a Helm chart only (#4197)": infra/terraform, the dead module and the hardcoded state bucket and deployer are gone from the repo |  |

### Duplicate (9)

| Ticket | By | Evidence | What is left |
|---|---|---|---|
| #1965 Broken test links in spec.md | lore-agent | Same rotting links still carried, e.g. specs/1-lore-platform/spec.md:1081 still links libs/shared/src/outbound/project/events/event-reporter.test.ts, and that file is missing | Fixed by working #2419. |
| #2182 Broken test links in spec.md | lore-agent | Same set: 30 listed links still sit in the specs and point to missing files | Fixed by working #2419. |
| #2281 Broken test links in spec.md | lore-agent | Same set as #2182 | Fixed by working #2419. |
| #2298 Broken test links in spec.md | lore-agent | Same set as #2182 | Fixed by working #2419. |
| #2316 Broken test links in spec.md | lore-agent | Same set as #2182 | Fixed by working #2419. |
| #2320 Broken test links in spec.md | lore-agent | Same set as #2182 | Fixed by working #2419. |
| #2412 Broken test links in spec.md | lore-agent | Same set as #2419, filed the same day | Fixed by working #2419. |
| #3869 T040: Test backfill data exporter | lore-agent | libs/shared/src/work/backfill-memory.test.ts (covers memories and facts only) | Fixtures covering the full schema are the test half of #3870. |
| #3872 T050: Test ShadowMemoryStore | lore-agent | libs/shared/src/outbound/shadow-memory-store.test.ts | Tests for slow or hung shadows and for every shadowed operation belong with #3873. |

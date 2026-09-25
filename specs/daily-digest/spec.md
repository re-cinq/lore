# Feature Specification: Daily Digest to Slack

| Field    | Value                                         |
|----------|-----------------------------------------------|
| Feature  | Daily Digest to Slack                         |
| Branch   | feat/daily-digest-core                        |
| Status   | In Progress                                   |
| Created  | 2026-09-25                                    |
| Owner    | Platform Engineering                          |

The daily digest tells a project's Slack channel, once a day, what changed in its repos and who is working on what, so people stop stepping on each other's tasks and the stand-up can be about blockers instead of reports. Lore collects the facts from GitHub, an agent writes a fresh intro and a fresh ending around them, and the whole thing lands as a reply in that week's thread.

## Problem Statement

Otto is three repos (lore, ai-agent-subsystem, planning-station) worked by a
few people and several agents. Nobody has an overview of what merged yesterday
or who holds which issue without opening every repo. The Slack thread that
prompted this (2026-09-25) settled on: one channel per project, a daily post
per channel, per-repo sections in it, the week's posts collected in one thread
so messages to humans are not buried, and an agent-written intro and closing
line so the post reads like a colleague wrote it and never the same twice.

Nothing in Lore holds this today: human merges are not stored (webhook events
are pruned after seven days), the GitHub port has no "merged since", "closed
since" or assignee reads, no Slack post has ever used a thread, and no setting
carries a time of day.

## Shape

An assembly line with one agent node, `refine`, and the exit marker. The
Floor's cron emitter `daily_digest` ticks every 15 minutes; the tick handler
decides per repo whether its digest is due and starts one run per Slack
channel. The refine agent's input file, `digest-draft.md`, is served by a Floor
route that collects the repos' changes from GitHub on the fly and stores the
draft on the run. The agent uploads `digest.md`, and the Floor's upload receiver
posts it to Slack. A failed or dead agent still gets the draft posted.

## FR1 — Settings

- A repo opts in through `settings.digest` next to its `slack_channel_id`: `enabled`, `time` (`HH:MM`), `days` (JS weekdays, Sunday 0), `timezone` (IANA), `sections` (any of `implemented`, `roadmap`, `summary`, `morale`) and `group_by` (`person` or `area`). ([validated by `digest-settings.test.ts:5`](libs/shared/src/domain/digest-settings.test.ts#L5))
- An absent field takes its default: disabled, 09:00, Monday to Friday, Europe/Berlin, every section, grouped by person; a partial block keeps what it says and fills the rest. ([validated by `digest-settings.test.ts:16`](libs/shared/src/domain/digest-settings.test.ts#L16), [`digest-settings.test.ts:27`](libs/shared/src/domain/digest-settings.test.ts#L27))
- The settings API refuses a malformed digest block with 400 and writes nothing, and merges a well-formed one like any other setting. ([validated by `repo-settings.test.ts:216`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L216), [`repo-settings.test.ts:231`](apps/lore-api/src/transport/routes/repos/repo-settings.test.ts#L231))

## FR2 — When a digest is due

- A repo's digest is due when it is enabled, the local weekday is one of its days, the local time of day has reached its time, and nothing was posted for it yet that local day. ([validated by `decide-due.test.ts:9`](libs/shared/src/work/digest/decide-due.test.ts#L9), [`decide-due.test.ts:19`](libs/shared/src/work/digest/decide-due.test.ts#L19), [`decide-due.test.ts:29`](libs/shared/src/work/digest/decide-due.test.ts#L29), [`decide-due.test.ts:39`](libs/shared/src/work/digest/decide-due.test.ts#L39), [`decide-due.test.ts:49`](libs/shared/src/work/digest/decide-due.test.ts#L49), [`decide-due.test.ts:59`](libs/shared/src/work/digest/decide-due.test.ts#L59))
- Local date, weekday and time are read in the repo's own timezone, so a post at 09:05 Berlin is due at 08:05 UTC after the October clock change. ([validated by `decide-due.test.ts:69`](libs/shared/src/work/digest/decide-due.test.ts#L69), [`decide-due.test.ts:81`](libs/shared/src/work/digest/decide-due.test.ts#L81))

## FR3 — What is collected

- The implemented window opens at the repo's last digest post, or 24 hours back on the first run.
- Implemented changes are the PRs merged in the window, read newest first from GitHub's closed listing, which stops paging once it passes the cutoff, and the issues closed in the window with their assignees. ([validated by `platform-github.test.ts:225`](libs/shared/src/outbound/project/lib/platform-github.test.ts#L225), [`platform-github.test.ts:254`](libs/shared/src/outbound/project/lib/platform-github.test.ts#L254), [`platform-github.test.ts:267`](libs/shared/src/outbound/project/lib/platform-github.test.ts#L267), [`platform-github.test.ts:280`](libs/shared/src/outbound/project/lib/platform-github.test.ts#L280), [`platform-github.test.ts:302`](libs/shared/src/outbound/project/lib/platform-github.test.ts#L302))
- Roadmap is every open issue that has at least one assignee; an unassigned open issue says nothing about who is busy. ([validated by `group.test.ts:69`](libs/shared/src/work/digest/group.test.ts#L69))

## FR4 — One change, one line

- An issue that a merged PR closes through its body (`closes`, `fixes`, `resolves`) or names in its title is listed once, as the PR. ([validated by `dedupe.test.ts:6`](libs/shared/src/work/digest/dedupe.test.ts#L6), [`dedupe.test.ts:15`](libs/shared/src/work/digest/dedupe.test.ts#L15), [`dedupe.test.ts:21`](libs/shared/src/work/digest/dedupe.test.ts#L21), [`dedupe.test.ts:30`](libs/shared/src/work/digest/dedupe.test.ts#L30))
- An issue no PR references keeps its own line. ([validated by `dedupe.test.ts:38`](libs/shared/src/work/digest/dedupe.test.ts#L38))

## FR5 — Grouping

- Grouped by person, a PR sits under its author and an issue under each of its assignees. ([validated by `group.test.ts:6`](libs/shared/src/work/digest/group.test.ts#L6), [`group.test.ts:46`](libs/shared/src/work/digest/group.test.ts#L46), [`group.test.ts:57`](libs/shared/src/work/digest/group.test.ts#L57))
- Grouped by area, a change sits under each `area:*` label it carries, without the prefix; a change with none goes under `unlabeled`. ([validated by `group.test.ts:25`](libs/shared/src/work/digest/group.test.ts#L25), [`group.test.ts:37`](libs/shared/src/work/digest/group.test.ts#L37))

## FR6 — The message

- Each repo is a bold header followed by its enabled sections, each group a bold sub-header, each change a Slack link with its number. ([validated by `render.test.ts:32`](libs/shared/src/work/digest/render.test.ts#L32), [`render.test.ts:37`](libs/shared/src/work/digest/render.test.ts#L37), [`render.test.ts:70`](libs/shared/src/work/digest/render.test.ts#L70), [`render.test.ts:53`](libs/shared/src/work/digest/render.test.ts#L53))
- A roadmap group shows at most 10 issues and counts the rest; an empty implemented list says so. ([validated by `render.test.ts:42`](libs/shared/src/work/digest/render.test.ts#L42), [`render.test.ts:60`](libs/shared/src/work/digest/render.test.ts#L60))
- A repo whose GitHub read failed renders as its own section naming the error, so one broken repo never hides the others. ([validated by `render.test.ts:64`](libs/shared/src/work/digest/render.test.ts#L64))
- The draft the agent receives places an intro marker before the sections and an ending marker after them, only for the creations some repo asked for, titled with the date, and carries an appendix of the last intros and endings posted in the channel. ([validated by `render.test.ts:92`](libs/shared/src/work/digest/render.test.ts#L92), [`render.test.ts:100`](libs/shared/src/work/digest/render.test.ts#L100), [`render.test.ts:110`](libs/shared/src/work/digest/render.test.ts#L110), [`render.test.ts:117`](libs/shared/src/work/digest/render.test.ts#L117))
- Posting the draft itself strips the appendix and any marker the agent never filled. ([validated by `render.test.ts:123`](libs/shared/src/work/digest/render.test.ts#L123), [`render.test.ts:127`](libs/shared/src/work/digest/render.test.ts#L127))
- The intro is the message's first paragraph and the ending its last, when they are prose; a paragraph opening with a header is a section. ([validated by `render.test.ts:135`](libs/shared/src/work/digest/render.test.ts#L135), [`render.test.ts:145`](libs/shared/src/work/digest/render.test.ts#L145))

## FR7 — The weekly thread

- Each channel has one thread per ISO week, keyed `YYYY-Www` in the repo's timezone; its parent names the week and the repos. ([validated by `iso-week.test.ts:5`](libs/shared/src/work/digest/iso-week.test.ts#L5), [`iso-week.test.ts:14`](libs/shared/src/work/digest/iso-week.test.ts#L14), [`iso-week.test.ts:20`](libs/shared/src/work/digest/iso-week.test.ts#L20), [`render.test.ts:155`](libs/shared/src/work/digest/render.test.ts#L155))
- The first digest of a week posts the parent; every digest replies in it with `reply_broadcast` so the day's post still shows in the channel. ([validated by `deliver-digest.test.ts:57`](apps/floor/src/work/digest/deliver-digest.test.ts#L57), [`deliver-digest.test.ts:90`](apps/floor/src/work/digest/deliver-digest.test.ts#L90), [`slack-poster-http.test.ts:25`](libs/shared/src/outbound/project/notify/slack-poster-http.test.ts#L25), [`slack-poster-http.test.ts:46`](libs/shared/src/outbound/project/notify/slack-poster-http.test.ts#L46))
- Every post is recorded per repo in `lore.digest_posts` with its thread and the intro and ending it carried; the repo's last finished post is its watermark and the channel's last 14 ride into the next drafts. ([validated by `deliver-digest.test.ts:119`](apps/floor/src/work/digest/deliver-digest.test.ts#L119), [`digest-posts.test.ts:13`](libs/shared/src/outbound/project/digest-posts/digest-posts.test.ts#L13), [`digest-posts.test.ts:19`](libs/shared/src/outbound/project/digest-posts/digest-posts.test.ts#L19), [`digest-posts.test.ts:29`](libs/shared/src/outbound/project/digest-posts/digest-posts.test.ts#L29), [`digest-posts.test.ts:43`](libs/shared/src/outbound/project/digest-posts/digest-posts.test.ts#L43), [`digest-posts.test.ts:122`](libs/shared/src/outbound/project/digest-posts/digest-posts.test.ts#L122), [`digest-posts.test.ts:137`](libs/shared/src/outbound/project/digest-posts/digest-posts.test.ts#L137))
- A run is claimed in that table before Slack is called, so the upload receiver and the run-closed fallback racing for one run post once; a claim whose Slack call failed is released so the next tick may try again. ([validated by `deliver-digest.test.ts:131`](apps/floor/src/work/digest/deliver-digest.test.ts#L131), [`deliver-digest.test.ts:142`](apps/floor/src/work/digest/deliver-digest.test.ts#L142), [`digest-posts.test.ts:59`](libs/shared/src/outbound/project/digest-posts/digest-posts.test.ts#L59), [`digest-posts.test.ts:66`](libs/shared/src/outbound/project/digest-posts/digest-posts.test.ts#L66), [`digest-posts.test.ts:93`](libs/shared/src/outbound/project/digest-posts/digest-posts.test.ts#L93), [`digest-posts.test.ts:114`](libs/shared/src/outbound/project/digest-posts/digest-posts.test.ts#L114))
- Slack is reached through one poster that reads the answer's `ok` and fails with Slack's own error; the notifier posts through the same one. ([validated by `slack-poster-http.test.ts:54`](libs/shared/src/outbound/project/notify/slack-poster-http.test.ts#L54), [`slack-poster-http.test.ts:62`](libs/shared/src/outbound/project/notify/slack-poster-http.test.ts#L62), [`notify-slack.test.ts:39`](libs/shared/src/outbound/project/notify/notify-slack.test.ts#L39))

## FR8 — One run per channel, one message per channel

- Every 15 minutes the tick reads every onboarded repo's settings in one query, keeps the enabled repos with a channel whose digest is due, and starts one run per channel carrying every due repo, hosted by the first repo by name and keyed on the channel and the local day. ([validated by `settings.test.ts:63`](libs/shared/src/outbound/project/settings/settings.test.ts#L63), [`fan-out.test.ts:42`](apps/floor/src/work/digest/fan-out.test.ts#L42), [`fan-out.test.ts:53`](apps/floor/src/work/digest/fan-out.test.ts#L53), [`fan-out.test.ts:104`](apps/floor/src/work/digest/fan-out.test.ts#L104))
- The run's args carry each repo's window (from its last finished post, or 24 hours back), sections and grouping as `digest_repos`, which one codec wraps and unwraps, plus `ref` set to the host repo's default branch since the run's own branch is only a lease key. ([validated by `fan-out.test.ts:69`](apps/floor/src/work/digest/fan-out.test.ts#L69), [`fan-out.test.ts:90`](apps/floor/src/work/digest/fan-out.test.ts#L90), [`codec.test.ts:15`](libs/shared/src/work/digest/codec.test.ts#L15), [`codec.test.ts:19`](libs/shared/src/work/digest/codec.test.ts#L19))
- A channel whose run for the day is in flight is skipped, and a channel starts at most three runs a day; a tick that cannot start the run fails the job_run it minted; `params.repo` narrows the tick and `params.force` skips the due check. ([validated by `fan-out.test.ts:112`](apps/floor/src/work/digest/fan-out.test.ts#L112), [`fan-out.test.ts:125`](apps/floor/src/work/digest/fan-out.test.ts#L125), [`fan-out.test.ts:139`](apps/floor/src/work/digest/fan-out.test.ts#L139), [`fan-out.test.ts:150`](apps/floor/src/work/digest/fan-out.test.ts#L150))
- A message over Slack's limit is posted as consecutive replies in the thread, broken by line and never inside a line, only the first one broadcast. ([validated by `split-for-slack.test.ts:5`](libs/shared/src/work/digest/split-for-slack.test.ts#L5), [`split-for-slack.test.ts:9`](libs/shared/src/work/digest/split-for-slack.test.ts#L9), [`split-for-slack.test.ts:16`](libs/shared/src/work/digest/split-for-slack.test.ts#L16), [`split-for-slack.test.ts:22`](libs/shared/src/work/digest/split-for-slack.test.ts#L22), [`split-for-slack.test.ts:26`](libs/shared/src/work/digest/split-for-slack.test.ts#L26), [`deliver-digest.test.ts:103`](apps/floor/src/work/digest/deliver-digest.test.ts#L103))

## FR9 — The refine agent

- The line is one agent node, `refine`, on the `digest-refine` station, and the exit; a failed refine still reaches the exit. ([validated by `daily-digest-line.test.ts:18`](libs/assembly-lines/src/daily-digest-line.test.ts#L18), [`daily-digest-line.test.ts:26`](libs/assembly-lines/src/daily-digest-line.test.ts#L26), [`daily-digest-line.test.ts:30`](libs/assembly-lines/src/daily-digest-line.test.ts#L30))
- The draft is served as the pod's input file `digest-draft.md`: collected from GitHub for every repo of the run when the pod first asks, kept on the run so a retry downloads the same draft, and 404 for a run that is not a digest run. ([validated by `serve-draft.test.ts:52`](apps/floor/src/work/digest/serve-draft.test.ts#L52), [`serve-draft.test.ts:67`](apps/floor/src/work/digest/serve-draft.test.ts#L67), [`serve-draft.test.ts:81`](apps/floor/src/work/digest/serve-draft.test.ts#L81), [`serve-draft.test.ts:97`](apps/floor/src/work/digest/serve-draft.test.ts#L97), [`serve-draft.test.ts:108`](apps/floor/src/work/digest/serve-draft.test.ts#L108), [`agent-files-digest.test.ts:79`](apps/floor/src/transport/http/routes/agent-files-digest.test.ts#L79), [`agent-files-digest.test.ts:92`](apps/floor/src/transport/http/routes/agent-files-digest.test.ts#L92))
- The agent keeps every fact and link and replaces only the intro and ending markers with one paragraph and one closing line that differ from every entry in the appendix.
- The uploaded `digest.md` is posted on a zero exit; a non-zero exit, an empty upload, or a run that closed without uploading posts the stored draft without its appendix; a run whose pod never downloaded a draft posts nothing. ([validated by `deliver-digest.test.ts:72`](apps/floor/src/work/digest/deliver-digest.test.ts#L72), [`deliver-digest.test.ts:81`](apps/floor/src/work/digest/deliver-digest.test.ts#L81), [`deliver-digest.test.ts:163`](apps/floor/src/work/digest/deliver-digest.test.ts#L163), [`deliver-digest.test.ts:154`](apps/floor/src/work/digest/deliver-digest.test.ts#L154), [`agent-files-digest.test.ts:102`](apps/floor/src/transport/http/routes/agent-files-digest.test.ts#L102), [`agent-files-digest.test.ts:122`](apps/floor/src/transport/http/routes/agent-files-digest.test.ts#L122))

## FR10 — Settings page

- The repo settings page carries a Daily digest section with the enable switch, time of day, weekdays, timezone, sections and grouping, always sent whole.

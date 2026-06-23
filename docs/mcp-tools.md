# Lore Tools — What They Do (Plain-Language Guide)

When you use Claude Code with Lore installed, Claude gains a set of **tools** —
little actions it can take on your behalf, like "look up our team's
conventions" or "remember this decision." This page lists those tools in plain
language: what each one is for, and where the work happens.

New to Lore? Start with the [README](../README.md). Engineers wanting the wiring
details can read the source under `apps/mcp-server/src/mcp/tools/`.

Want the per-tool reference — parameters, returns, and disambiguation between
similar tools? See [mcp-tools-reference.md](./mcp-tools-reference.md).

## How to read this page

Two simple labels tell you where each tool does its work:

- ☁️ **Cloud** — it talks to the shared Lore service over the internet. This is
  how every developer sees the same org-wide knowledge.
- 💻 **Your computer** — it runs locally on your machine (for example, running
  your project's tests, or noticing which repo you're in).

And one label about speed and offline use:

- ⚡ **Cached** — recent results are saved on your computer for a short while
  (a few minutes for most reads; finished-job logs up to a day), so repeat
  lookups are instant and still work if the cloud is briefly unreachable.
  (Saving and changing things is never cached.)

---

## Getting knowledge & context

The reason Lore exists: Claude starts each session already knowing your org.

| Tool | What it does | Where | |
|---|---|---|---|
| `lore_assemble_context` | Gathers everything relevant to your task — conventions, past decisions, memories — into one briefing. Claude calls this first, every session. | ☁️ Cloud | ⚡ Cached |
| `lore_search_context` | Plain keyword search across the team's documents. | 💻 Your computer | |
| `lore_search_memory` | Searches everything the org has learned and remembered, by meaning (not just keywords). | ☁️ Cloud | ⚡ Cached |
| `lore_query_graph` | Explores how things connect — which service uses which, who owns what. | ☁️ Cloud | ⚡ Cached |
| `lore-query-trace` | Shows which parts of a spec are actually covered by tests or code. | ☁️ Cloud | ⚡ Cached |

## Remembering things (memory)

Lore keeps a shared, long-term memory across the whole org.

| Tool | What it does | Where | |
|---|---|---|---|
| `lore_read_memory` | Reads back a specific saved note. | ☁️ Cloud | ⚡ Cached |
| `lore_list_memories` | Lists saved notes for the repo you're in. | ☁️ Cloud | ⚡ Cached |
| `lore_write_memory` | Saves a note (a decision, a convention, a lesson) for everyone. | ☁️ Cloud | |
| `lore_delete_memory` | Removes a saved note. | ☁️ Cloud | |
| `lore_write_episode` | Drops in raw text (a conversation, a review) and lets Lore extract the useful facts automatically. | ☁️ Cloud | |
| `lore_agent_stats` | Shows memory/activity statistics. | ☁️ Cloud (service-side) | |

Saving or deleting a memory automatically refreshes the cached lookups it
affects, so you never read your own change stale.

## Delegating work (the task pipeline)

Hand a job to Lore's background agents; they open a pull request for review.

| Tool | What it does | Where | |
|---|---|---|---|
| `lore_create_pipeline_task` | Asks Lore to do a job (implement something, write docs, review a PR). | ☁️ Cloud | |
| `lore_get_pipeline_status` | Checks how a job is going. | ☁️ Cloud | |
| `lore_list_pipeline_tasks` | Lists recent jobs. | ☁️ Cloud | |
| `lore_list_pending_tasks` | Shows jobs waiting to be picked up. | ☁️ Cloud | |
| `lore_get_task_logs` | Reads a job's output log. | ☁️ Cloud | ⚡ Cached (once the job finishes) |
| `lore_get_job_logs` | Reads a scheduled background job's log. | ☁️ Cloud | ⚡ Cached |
| `lore_get_pr_status` | Checks a pull request's status on GitHub. | ☁️ GitHub | |
| `lore_cancel_task` / `lore_retry_task` | Stops or retries a job. | ☁️ Cloud (service-side) | |
| `lore_list_task_group` | Tracks a group of related jobs across repos. | ☁️ Cloud (service-side) | |
| `lore_sync_tasks` / `lore_ready_tasks` / `lore_claim_task` / `lore_complete_task` | Coordinate spec-driven tasks and their dependencies. | ☁️ Cloud (service-side) | |

## Running work on your own machine

These use your local checkout and (optionally) your own Claude subscription.

| Tool | What it does | Where |
|---|---|---|
| `lore_run_task_locally` | Runs a job on your machine instead of the cloud. | 💻 Your computer |
| `lore_claim_and_run_locally` | Picks up a waiting job and runs it locally. | 💻 Your computer |
| `lore_enable_task_notifications` / `lore_disable_task_notifications` | Start or stop a local poller that surfaces new pending jobs in your statusline, so you can grab one to run locally. | 💻 Your computer |
| `lore_skip_task` | Dismiss a pending-job notification locally (the cloud job is unaffected). | 💻 Your computer |
| `lore_list_local_tasks` / `lore_cancel_local_task` | See or stop your local jobs. | 💻 Your computer |
| `lore_configure_local_runner` | Settings for the local runner. | 💻 Your computer |
| `lore_list_tests` / `lore_run_test` | Lists and runs your project's own tests. | 💻 Your computer |

## Managing repositories

| Tool | What it does | Where |
|---|---|---|
| `lore_list_repos` | Lists repos onboarded to Lore. | ☁️ Cloud (service-side) |
| `lore_onboard_repo` | Adds a new repo to Lore. | ☁️ Cloud (service-side) |
| `lore_ingest_files` | Makes specific files searchable in Lore. | ☁️ Cloud |
| `lore_ingest_graph` | Refreshes the spec/test/decision knowledge graph. | ☁️ Cloud (service-side) |

## Usage & analytics

| Tool | What it does | Where |
|---|---|---|
| `lore_my_usage` | Your personal task and token usage. | ☁️ Cloud (service-side) |
| `lore_get_analytics` | Org-wide throughput and success rates. | ☁️ Cloud (service-side) |

---

### A note for engineers

"☁️ Cloud" tools reach the Lore backend over `LORE_API_URL`. "Cloud
(service-side)" tools only run when the server has a direct database
connection, so they're effectively backend-only. The ⚡ cache lives at
`~/.lore/cache/` and can be turned off with `LORE_CACHE_ENABLED=false`; design
in [specs/local-read-cache/](../specs/local-read-cache/spec.md). For how the
local↔cloud split works, see
[mcp-transport-options.md](mcp-transport-options.md).

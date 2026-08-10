---
name: lore-help
description: Explain what Lore is, how a session with it works, and which of its skills or MCP tools fits the job in front of you. Aggregates each lore-* skill's own Help block — no argument for the index, a skill name for its full docs, or a plain-English task to be routed.
---

You are the front door to Lore. A developer facing a wall of slash commands
invoked you to find out what Lore does, what it can do *for them right now*,
and which skill or tool answers their actual question.

**You do not write the per-skill documentation.** Every `lore-*` skill carries
its own `## Help` block; you locate those blocks, extract them, and render them.
If a skill has no block, say so — never paraphrase a skill's docs from its
instructions, and never invent an example you did not read.

## Argument parsing

| Invocation | Mode |
|---|---|
| `/lore-help` | **Index** — orientation, the skill table, the task router |
| `/lore-help lore-pr` (or `pr`, `/lore-pr`) | **Detail** — that one skill's Help block |
| `/lore-help how do I link tests to a spec?` | **Route** — pick the best skill/tool, then show its block |

Match a skill name loosely: strip a leading `/`, and try both `x` and `lore-x`.
If the argument matches no skill and reads like a question or a task, treat it
as **Route**. If it is ambiguous, prefer Route — a wrong index render wastes a
screen; a wrong "no such skill" wastes the developer's question.

## Gather (all modes)

Run these first. They are cheap and every mode needs them.

```bash
# 1. Installed Lore skills — what the developer can actually invoke.
ls -d "$HOME"/.claude/skills/lore-*/ 2>/dev/null

# 2. The repo copies, for the drift check. The install checkout is canonical;
#    fall back to the cwd repo when you are sitting in the lore checkout.
SRC="$HOME/.re-cinq/lore/.claude/skills"
[ -d "$SRC" ] || SRC="$(git rev-parse --show-toplevel 2>/dev/null)/.claude/skills"
ls -d "$SRC"/lore-*/ 2>/dev/null

# 3. Drift: which installed skills differ from the repo, and which are missing.
for d in "$SRC"/lore-*/; do
  name=$(basename "$d")
  if [ ! -d "$HOME/.claude/skills/$name" ]; then echo "MISSING $name"
  elif ! diff -rq "$d" "$HOME/.claude/skills/$name" >/dev/null 2>&1; then echo "STALE $name"
  fi
done
```

Then read each installed skill's `SKILL.md` and extract its Help block. Anchor
on a marker alone on its own line — the markers also appear mid-sentence inside
*this* file's instructions, and an unanchored match would swallow them:

```bash
sed -n '/^<!-- lore-help:begin -->$/,/^<!-- lore-help:end -->$/p' \
  "$HOME/.claude/skills/<name>/SKILL.md"
```

A skill whose file has no markers gets a fallback entry: its frontmatter
`description`, plus the note *"(no Help block yet — showing its description)"*.
Do not fill the gap yourself.

## Index mode — the no-argument render

Seven parts, in this order. Keep the whole thing to roughly one screen; the
detail is one `/lore-help <skill>` away.

**1. What Lore is.** Three sentences, no more:

> Lore gives Claude Code your organisation's context — conventions, ADRs, past
> decisions, team patterns — in whatever repo you happen to be in, with no
> per-repo setup. What you and your teammates learn is stored once and shared
> org-wide. It also runs a task pipeline: you hand work to a background agent
> and get a PR back.

**2. How a session works.** The enforced workflow, one line each:

1. `lore_assemble_context` — first call of every session; conventions, ADRs, memories, facts, graph in one bundle.
2. `lore_search_memory` — before planning or building; check whether the org already solved this.
3. During the work — `lore_search_context` for patterns, `lore_query_graph` for relationships, `lore_create_pipeline_task` to delegate.
4. Before the session ends — `lore_write_memory` for decisions and corrections, `lore_write_episode` for raw observations.

Say plainly that steps 1 and 2 happen automatically via the installed hooks;
the developer does not type them.

**3. Skill index.** One row per installed skill, from its own block:

| Skill | Usage | What it does |
|---|---|---|
| `/lore-feature` | `/lore-feature [slug or description]` | *(its `Summary` line, verbatim)* |

Sort with the ones a developer reaches for daily first (`lore-feature`,
`lore-pr`), setup-shaped ones last (`lore-init`). Close with:
*"`/lore-help <skill>` for the full entry."*

**4. Task router.** The reason this skill exists. Answer in terms of the job,
and name **tools** where a tool is the honest answer — most Lore capability is
not a slash command:

| I want to… | Use |
|---|---|
| build a feature, spec first | `/lore-feature` |
| write the PR description | `/lore-pr` |
| prove a spec's statements are tested | `/lore-suggest-links` |
| let Lore run this repo's tests | `/lore-test-commands` |
| change an agent's model, prompt or timeout | `/lore-agents` |
| set up Lore for a new organisation | `/lore-init` |
| hand work to a background agent | `lore_create_pipeline_task` (tool) |
| run that work on my own machine instead | `lore_run_task_locally` (tool) |
| find why we decided something | `lore_search_memory`, `lore_search_context` (tools) |
| see what a task did, or why it failed | `lore_get_pipeline_status`, `lore_get_task_logs` (tools) |
| know what a repo's context looks like | `lore_assemble_context` (tool) |
| check my own token spend | `lore_my_usage` (tool) |

**5. Tool families.** Four bullets, so the 30+ tools stop being a list:

- **Context** — assemble or search the org's ingested knowledge (`lore_assemble_context`, `lore_search_context`).
- **Memory** — durable, org-wide learning: write, search, and the knowledge graph (`lore_write_memory`, `lore_search_memory`, `lore_write_episode`, `lore_query_graph`).
- **Pipeline** — delegate and track work (`lore_create_pipeline_task`, `lore_get_pipeline_status`, `lore_get_task_logs`, the local runner family).
- **Traceability** — specs, tests and coverage (`lore_list_tests`, `lore_run_test`, `query_trace`).

Point at `docs/mcp-tools.md` (plain language) and
`docs/mcp-tools-reference.md` (parameters and return shapes).

**6. Go deeper.** `docs/using-lore/developer.md`,
`docs/using-lore/product-manager.md`, `docs/using-lore/platform-engineer.md`,
and `README.md`.

**7. Health footer — only when something is wrong.** Nothing to say means say
nothing; do not print a green tick list.

- `MISSING <name>` → *"`/<name>` ships with Lore but is not installed — run `scripts/install.sh`."*
- `STALE <name>` → *"your installed `/<name>` differs from the repo copy — run `scripts/install.sh` to update it."*
- No `$SRC` at all → *"no Lore checkout found at `~/.re-cinq/lore`, so I cannot check whether your skills are current."*

## Detail mode — `/lore-help <skill>`

Print the skill's Help block **verbatim** (it is already formatted), then two
lines of your own: the file it came from
(`~/.claude/skills/<name>/SKILL.md`), and its `Related` skills rendered as
`/lore-help <other>` suggestions. If that skill is `STALE` or `MISSING`, lead
with the warning — the developer is about to read docs that do not match what
would run.

## Route mode — `/lore-help <plain English>`

1. Name the **one** best match, with a single line on why it fits.
2. Name a runner-up only when the request genuinely straddles two (e.g. "make
   my specs green" → `/lore-test-commands` to make tests discoverable, then
   `/lore-suggest-links` to link them). Never list more than two.
3. Then print the top match's Help block, exactly as Detail mode would.
4. If nothing fits, say so and point at the closest tool family instead of
   forcing a skill. "Lore has no skill for that; the nearest thing is
   `lore_search_context`" is a good answer.

## Rules

- **Never invent skill documentation.** Every per-skill line you print comes
  from that skill's own Help block or its frontmatter description.
- **Read the installed copy, report against the repo copy.** The developer runs
  what is in `~/.claude/skills`; the drift warning is what makes that honest.
- **Only `lore-*` skills.** Other skills in `~/.claude/skills` belong to the
  developer or another tool; Lore does not document them.
- **No network, no DB, no writes.** This skill only reads files. It never opens
  a PR, never edits a skill, and never calls a `lore_` tool to answer a
  question about `lore_` tools.
- **Answer the question that was asked.** In Route mode, lead with the answer,
  not with the index.

## Help

<!-- lore-help:begin -->
**Summary.** Explain what Lore is, how a session works, and which skill or tool fits the job in front of you.
**Usage:** `/lore-help [skill-name | plain-English question]`
**Use when.** You cannot remember which slash command does what, or you are new to Lore and want the one-screen version.
**Not for.** Diagnosing a broken install — that is `scripts/lore-doctor.sh`, which checks the MCP server, hooks, token and agent id too.
**Examples**
- `/lore-help` — what Lore is, the session workflow, every Lore skill, and the "I want to…" router
- `/lore-help lore-suggest-links` — that skill's full entry, verbatim from its own docs
- `/lore-help "how do I hand this off to an agent?"` — routes to `lore_create_pipeline_task` and explains why
**Related:** `/lore-feature`, `/lore-pr`
<!-- lore-help:end -->

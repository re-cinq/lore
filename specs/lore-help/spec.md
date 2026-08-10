# Feature Specification: `/lore-help`

| Field    | Value                                                        |
|----------|--------------------------------------------------------------|
| Feature  | `/lore-help` skill + the per-skill Help-block convention      |
| Status   | Draft                                                        |
| Created  | 2026-08-08                                                   |
| Owner    | Platform Engineering                                         |
| Skill    | `.claude/skills/lore-help/SKILL.md`                          |
| Scope    | shared                                                       |

`/lore-help` is Lore's front door in the terminal: it explains what Lore is, how a session with it works, and which skill or MCP tool fits the job in front of the developer — assembling the per-skill documentation from each skill's own `## Help` block rather than keeping a second copy that can rot.

## Problem Statement

Lore ships seven Claude Code skills and 30+ MCP tools with no index. A developer
sees a wall of slash commands and cannot tell which one fits the task at hand,
and nothing in the terminal explains what Lore itself does or where it helps.
The written guides (`docs/using-lore/*.md`, `docs/mcp-tools.md`) live outside the
session, so they are read at onboarding and never again.

A naive fix — one skill that describes all the others — creates a second source
of truth that drifts the first time a skill changes. The documentation has to
stay with the skill it documents.

## What it does

`/lore-help` runs in three modes:

- **Index** (no argument) — what Lore is, the enforced session workflow, a table
  of every installed `lore-*` skill, an "I want to…" task router, the four MCP
  tool families, and links to the deeper guides.
- **Detail** (`/lore-help <skill>`) — that skill's Help block, verbatim.
- **Route** (`/lore-help <plain English>`) — names the one or two best
  skills/tools for the described job, with a reason, then shows the top match.

The router answers with **tools as well as skills**, because most Lore
capability is not a slash command: delegating work is `lore_create_pipeline_task`,
finding a past decision is `lore_search_memory`.

## The Help-block convention

Every `.claude/skills/*/SKILL.md` ends with a `## Help` section whose body is
fenced by `<!-- lore-help:begin -->` / `<!-- lore-help:end -->` markers alone on
their own lines. The block carries a required `**Summary.**` and `**Usage:**`,
plus the optional `**Use when.**`, `**Not for.**`, `**Examples**` and
`**Related:**` lines.

Markers are matched anchored to the start of a line, because `lore-help`'s own
instructions mention them mid-sentence; an unanchored match would swallow that
prose.

`lore-help` extracts and renders these blocks; it never paraphrases a skill's
instructions into documentation, and never invents an example. A skill with no
block degrades to its frontmatter `description` with a note saying the block is
missing.

`scripts/check-skill-help.sh` enforces presence and shape in CI, so a new skill
cannot ship invisible to the index.

## Reading installed, reporting against the repo

`/lore-help` reads `~/.claude/skills` — what the developer can actually invoke —
and compares each skill against the checkout at `~/.re-cinq/lore/.claude/skills`
(falling back to the current repo when that is the lore checkout). Skills that
are missing or that differ are reported in a health footer, and only then.

This closes a real trap: `install.sh` used to skip any skill directory that
already existed, so a skill edited upstream never reached a machine that had
installed once. Install now refreshes a changed skill (`Updated /x`) instead of
skipping it, and `lore-doctor` fails its skills check when any installed skill
is absent or differs.

## Out of Scope

- Documenting non-Lore skills in `~/.claude/skills` — they belong to the
  developer or another tool, and carry no Help block to read.
- Duplicating the MCP tool reference; `/lore-help` names the families and links
  to `docs/mcp-tools.md` and `docs/mcp-tools-reference.md`.
- Diagnosing a broken install (MCP server, hooks, token, agent id) — that is
  `scripts/lore-doctor.sh`.
- Any write path: `/lore-help` reads files and calls no `lore_` tool, no API,
  and no database.

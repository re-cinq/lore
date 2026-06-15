# Glossary — the execution model

The canonical vocabulary used across Lore's specs and code. Decision record:
[ADR-024](../adrs/ADR-024-ubiquitous-language-execution-model.md). Lore is an
autonomous software **factory** (Dark Factory, ADR-016, is a *mode* of it).

**Hierarchy: Factory ⊃ Floor(s) ⊃ AssemblyLines ⊃ Stations ⊃ Agents.**

| Term | Definition | Cardinality |
|---|---|---|
| **Factory** | The whole platform — Lore itself. | 1 |
| **Floor** | The long-running coordinator runtime: dispatches Agents onto Stations, runs the AssemblyLines, runs the cron jobs, reaps leases. | 1 → N (per team / cluster / trust tier) |
| **AssemblyLine** | A workflow of Stations with distinct responsibilities that hand off to / wait on each other. | per task |
| **Station** | The unit that runs exactly one Agent — a Kubernetes Job pod (cluster) or a local sandbox/worktree (local runner). | per task-run |
| **Agent** | A single ephemeral run of the Claude CLI/API + a prompt (context + task). | per Station |

## Usage rules

- **"Agent" is reserved** for the Claude-plus-prompt run. It is *never* the pod
  that hosts it (a **Station**), the coordinator that dispatches it (the
  **Floor**), or the workflow that sequences it (an **AssemblyLine**).
- **Factory** is the whole platform — never a single deployment.
- A **Floor** may be one of several (per team / cluster / trust tier); write
  "the Floor" for the local/default one, "a Floor" when multiplicity matters.

## Mapping to today's code

| Term | Today |
|---|---|
| Floor | `apps/floor` (the `lore-floor` deployment) |
| AssemblyLine | the `workflow` YAML + supervisor graph in `@re-cinq/lore-runner` |
| Station | the `claude-runner` Job pod / the local runner sandbox |
| Agent | the `claude --print` / `Llm` invocation |

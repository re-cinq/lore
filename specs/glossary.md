# Glossary — the execution model

The canonical vocabulary used across Lore's specs and code. Decision record:
[ADR-024](../adrs/ADR-024-ubiquitous-language-execution-model.md). Lore is an
autonomous software **factory** (Dark Factory, ADR-016, is a *mode* of it).

**Hierarchy: Factory ⊃ Floor(s) ⊃ AssemblyLines ⊃ Stations ⊃ Agents.**

| Term | Definition | Cardinality |
|---|---|---|
| **Factory** | The whole platform — Lore itself. | 1 |
| **Floor** | The long-running coordinator runtime: dispatches Agents onto Stations, runs the AssemblyLines, runs the cron jobs, reaps leases. | 1 → N (per team / cluster / trust tier) |
| **AssemblyLine** | A graph of Stations with distinct responsibilities that hand off to / wait on each other. | per task |
| **Station** | The unit that runs exactly one Agent — a Kubernetes pod (an `Agent` CR on the ai-agent-subsystem, ADR-031) or a local sandbox/worktree (local runner). | per task-run |
| **Agent** | A single ephemeral run of the Claude CLI/API + a prompt (context + task). | per Station |
| **Agent definition** | The stored *config* an Agent runs from — model, timeout, prompt, execution image — resolved per repo (project row → org default → `task-types.yaml`). One definition; many Agents run from it. | per task-type (× repo) |

## Usage rules

- **"Agent" is reserved** for the Claude-plus-prompt run. It is *never* the pod
  that hosts it (a **Station**), the coordinator that dispatches it (the
  **Floor**), or the graph that sequences it (an **AssemblyLine**).
- An **Agent definition** is *config, not a run* — the recipe a Station
  instantiates into an Agent. Say "Agent definition" (or just "definition") for
  the stored row; never call a definition "an Agent". A "session" is the
  developer/operator identity an Agent runs under (the `agent_id` on tasks and
  memories), distinct from both the definition and a single run.
- **Factory** is the whole platform — never a single deployment.
- A **Floor** may be one of several (per team / cluster / trust tier); write
  "the Floor" for the local/default one, "a Floor" when multiplicity matters.

## Mapping to today's code

| Term | Today |
|---|---|
| Floor | `apps/floor` (the `lore-floor` deployment) |
| AssemblyLine | the YAML definitions + graph library (loader, `nextTransition`) in `@re-cinq/lore-assembly-lines`, walked event-driven by the Floor (`apps/floor/src/jobs/assembly-run/advance.ts`) |
| Station | one `Agent` CR pod per node on the ai-agent-subsystem — `claude` for agent nodes, the `exec`-vendor `lore-station` image for non-agent nodes — or the local runner sandbox |
| Agent | a single `Agent` CR run (Claude Code in the pod); locally, the `claude --print` / `Llm` invocation |
| Agent definition | the `lore.agent_definitions` table, reached via `project.agentDefs` (ADR-024) |

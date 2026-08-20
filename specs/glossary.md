# Glossary — the execution model

The canonical vocabulary used across Lore's specs and code. Decision record:
[ADR-024](../adrs/ADR-024-ubiquitous-language-execution-model.md). Lore is an
autonomous software **factory** (Dark Factory, ADR-016, is a *mode* of it).

**Hierarchy: Factory ⊃ Floor(s) ⊃ AssemblyLines ⊃ Stations ⊃ Agents** — the design
side. Its runtime shadow is **AssemblyRun ⊃ StationRuns ⊃ Agents**: what was
authored, and what actually ran.

| Term | Definition | Cardinality |
|---|---|---|
| **Factory** | The whole platform — Lore itself. | 1 |
| **Floor** | The long-running coordinator runtime: dispatches Agents onto Stations, runs the AssemblyLines, runs the cron jobs, reaps leases. | 1 → N (per team / cluster / trust tier) |
| **AssemblyLine** | The **blueprint** — an authored, versioned, content-hashed graph of Stations that hand off to / wait on each other. Not a run. | per task type |
| **AssemblyRun** | One **execution** of an AssemblyLine, carrying a CLONE of the blueprint it runs, so an edit cannot change the graph under a walk already in flight. | per attempt |
| **StationRun** | One **visit** to a Station within an AssemblyRun — `(run, node, iteration)`, identified by a `station_run_id`. | per node-run |
| **Station** | The unit that runs exactly one node's work — a Kubernetes pod (an `Agent` CR on the ai-agent-subsystem, ADR-031), a local sandbox/worktree, *or* a **human station** whose worker is a person and whose `route` names the page they work on. | per node |
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
- **A blueprint is not a run.** "AssemblyLine" once named both the authored graph
  and one execution of it, so every sentence about either had to disambiguate
  itself — and the code could not: a run referenced its blueprint by NAME and
  re-read the file at every step, which let an edit change the graph mid-walk and
  left a renamed blueprint's own history undrawable. Say **AssemblyLine** (or
  "blueprint") for the authored thing and **AssemblyRun** for one execution;
  **StationRun** for one visit within it. The blueprint side deliberately keeps
  the old names — `libs/assembly-lines`, the YAMLs, the loader, the transition
  kernel — because that is now all they mean.
- **"Definition" is Agent-definition's word.** It once doubled as a synonym for a
  blueprint, which is why the blueprint side needed its own name at all. An
  AssemblyLine is a blueprint; `lore.agent_definitions` holds definitions.
- **Factory** is the whole platform — never a single deployment.
- A **Floor** may be one of several (per team / cluster / trust tier); write
  "the Floor" for the local/default one, "a Floor" when multiplicity matters.

## Mapping to today's code

| Term | Today |
|---|---|
| Floor | `apps/floor` (the `lore-floor` deployment) |
| AssemblyLine | the YAML blueprints + graph library (loader, `nextTransition`) in `@re-cinq/lore-assembly-lines` |
| AssemblyRun | a `pipeline.assembly_runs` row, reached via `project.assemblyRuns`, walked event-driven by the Floor (`apps/floor/src/jobs/assembly-run/advance.ts`) |
| StationRun | a `pipeline.station_runs` row; its `station_run_id` is what telemetry and cost rows key on |
| Station | one `Agent` CR pod per node on the ai-agent-subsystem — `claude` for agent nodes, the `exec`-vendor `lore-station` image for non-agent nodes — or the local runner sandbox |
| Agent | a single `Agent` CR run (Claude Code in the pod); locally, the `claude --print` / `Llm` invocation |
| Agent definition | the `lore.agent_definitions` table, reached via `project.agentDefs` (ADR-024) |

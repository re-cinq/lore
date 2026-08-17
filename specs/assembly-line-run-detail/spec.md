# Feature Specification: Assembly Line Run Detail — Information Hierarchy

| Field     | Value                                                              |
|-----------|--------------------------------------------------------------------|
| Feature   | Assembly Line Run Detail — Information Hierarchy                   |
| Branch    | `lore/feature-planning/what-s-wrong-assembly-lines-id-3a7a7bd2`   |
| Status    | Draft                                                              |
| Created   | 2026-08-13                                                         |
| Owner     | Platform Engineering                                               |
| Builds on | [specs/assembly-line-run-viz](../assembly-line-run-viz/spec.md)    |

The `/assembly-runs/[id]` page is the main window into what the platform is doing in the background, but its components were added incrementally and never reconciled into a hierarchy. This refactor imposes two levels — line and node — so a developer can navigate to a node's detail without already knowing where to click.

## Problem Statement

The current page under `apps/web-ui/src/app/assembly-runs/[id]/` has seven view components and two levels of information that do not compose:

**Line-level** (about the whole run): `RunGraphView`, `RunTimelineView`, `ReplayScrubberView`, `FileHeatmapView`, `AssemblyRunView` (header + static step list)

**Node-level** (about one execution pod): `RunNodeDetail`, `NodeTranscriptView`, `NodePodLogs`

The problem is that `NodePodLogs` is rendered at the page level in `page.tsx` alongside the line-level `AssemblyRunView`, completely detached from the selected-node state owned by `RunVisualizationPanel`. A developer who wants to correlate the graph state with a pod's log output has to know that the log section is two pages below the graph. There is no navigation signal connecting them.

A secondary problem is that `AssemblyRunView` renders a static `<ol>` step list whose information content duplicates the interactive `RunGraphView`. The interactive graph supersedes the static list; keeping both gives the page two competing answers to the same question.

The three imported components from `apps/web-ui/src/app/tasks/[id]/` (`EventTimeline`, `LlmCallsTable`) are task-level accounting — they report on cost and status transitions for the backing task, not on individual node executions — and belong at the page bottom as a separate grouping.

## FR1 — The static step list is deleted

- `AssemblyRunView` renders only the metadata facts table (definition name, status, repo, branch, outcome, reason, duration, task link, PR link). The `<ol>` step list produced by `stepViews()` is removed.
- The interactive `RunGraphView` is the sole visual answer to "what did this run do and in what order." The two are not duplicated.
- Any tests that cover only the step list rendering are deleted with it.

## FR2 — Node detail pane is the container for all per-node content

- `RunVisualizationPanel` opens a node detail pane when a node is selected and closes it when the selection is cleared.
- The node detail pane renders, in order: `RunNodeDetail` (the summary card), `NodeTranscriptView` (the agent transcript), and the pod-log section for that node.
- The pod-log section displays the pod log for the selected node only. When no node is selected the section is absent.
- `NodePodLogs` is no longer rendered at the `page.tsx` level. `page.tsx` passes the full `logNodes` list to `RunVisualizationPanel` so the panel can look up the selected node's `agentCrName` without an additional server round-trip.
- `NodePodLogs` receives a single `node: NodeLogTarget | null` prop (instead of `nodes: NodeLogTarget[]`) and returns `null` when `node` is null. This change is contained inside the panel; the `NodeLogTarget` shape is unchanged.

## FR3 — Line-level views remain at line level

- `RunGraphView` is always visible at the top of the visualization section, before any node detail.
- `ReplayScrubberView` and the "Back to live" control remain at line level (below the graph), because the scrubber controls the replay cursor for the whole run.
- `RunTimelineView` remains at line level as the coarse lifecycle overview.
- `FileHeatmapView` remains at line level. It tallies file touches across all nodes, not just the selected one, and its value is answering "what did this run touch?" not "what did this node touch?".

## FR4 — Task accounting stays at page bottom, visually grouped

- When `run.taskId` is present, `EventTimeline` and `LlmCallsTable` (imported from `apps/web-ui/src/app/tasks/[id]/`) remain on the page, grouped under a "Task accounting" heading below the visualization panel.
- When `run.taskId` is absent, the "Task accounting" section is omitted and the existing explanatory paragraph ("This run has no backing task…") is removed with it. A run without a task is not a degraded state that requires explanation — it is a normal case for detection lines.

## FR5 — No new components; redundant paths are deleted

- The refactor moves and resizes existing components. It does not introduce new component files.
- `NodePodLogs.tsx` prop signature changes (FR2) but its rendering logic is unchanged.
- `AssemblyRunView.tsx` loses the step list and `stepViews()` helper. The component is not deleted — its header rendering is still server-rendered above the visualization panel.
- `TriggerReviewButton` placement is unchanged (below the header, gated on `code-review` definition and PR number).

## Alternatives Rejected

- **Keep both graph and step list, reconcile their state.** The step list is server-rendered and the graph is client-driven; synchronizing them requires lifting state that is currently cleanly owned by `RunVisualizationPanel`. The graph is the more capable view and the step list adds no information a selected graph node does not already surface via `RunNodeDetail`.

- **Show all nodes' pod logs simultaneously.** `NodePodLogs` already renders one collapsible `<details>` per node; the issue is not collapsed vs expanded but the section being disconnected from node selection. Showing all logs outside the graph makes the quantity of log content worse, not better, when a line has many nodes.

- **Move `FileHeatmapView` into the node detail pane and scope it per-node.** The heatmap's value proposition is the run-level picture of what files the agent worked on. Scoping it per-node fragments that view into a per-node read/write count that `RunNodeDetail` already surfaces as a scalar ("files touched"). Per-node heatmap is a future affordance, not a prerequisite here.

- **Dissolve `RunVisualizationPanel` and lift its state to `page.tsx`.** The panel's reducer, SSE connection, and clock are client-only concerns that `page.tsx` (an `async` server component) cannot hold. The panel stays as the client-side state boundary; this refactor only changes which children it renders and how it passes props.

## Out of Scope

- Transcript source quality. The `NodeTranscriptView` is only as useful as `pipeline.agent_run_events` underneath it (`specs/turn-level-transcript-store`). That dependency is separate and not addressed here.
- Fork-and-rerun affordance in the node detail pane (`specs/fork-rerun-from-node`). The "Rerun from here" button that spec deferred is a natural tenant of the node detail pane introduced here; it is not added in this refactor.
- Per-node file heatmap.
- Log streaming for station nodes (non-agent pods that emit no `agent_cr_name`). `NodePodLogs` returns `null` for those today; this refactor does not change that.

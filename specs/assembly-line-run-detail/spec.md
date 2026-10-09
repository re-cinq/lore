# Feature Specification: Assembly Line Run Detail — Information Hierarchy

| Field     | Value                                                           |
| --------- | --------------------------------------------------------------- |
| Feature   | Assembly Line Run Detail — Information Hierarchy                |
| Branch    | `lore/feature-planning/what-s-wrong-assembly-lines-id-3a7a7bd2` |
| Status    | In Progress                                                     |
| Created   | 2026-08-13                                                      |
| Owner     | Platform Engineering                                            |
| Builds on | [specs/assembly-line-run-viz](../assembly-line-run-viz/spec.md) |

The `/assembly-runs/[id]` page is the main window into what the platform is doing in the background, but its components were added incrementally and never reconciled into a hierarchy. This refactor imposes two levels — line and node — so a developer can navigate to a node's detail without already knowing where to click.

## Problem Statement

The current page under `apps/web-ui/src/app/assembly-runs/[id]/` has seven view components and two levels of information that do not compose:

**Line-level** (about the whole run): `RunGraphView`, `RunTimelineView`, `ReplayScrubberView`, `FileHeatmapView`, `AssemblyRunView` (header + static step list). _(Amended 2026-09-09: `RunTimelineView` and `ReplayScrubberView` were retired — `specs/assembly-line-run-viz` Retired Requirements.)_

**Node-level** (about one execution pod): `RunNodeDetail`, `NodeTranscriptView`, `NodePodLogs`

The problem is that `NodePodLogs` is rendered at the page level in `page.tsx` alongside the line-level `AssemblyRunView`, completely detached from the selected-node state owned by `RunVisualizationPanel`. A developer who wants to correlate the graph state with a pod's log output has to know that the log section is two pages below the graph. There is no navigation signal connecting them.

A secondary problem is that `AssemblyRunView` renders a static `<ol>` step list whose information content duplicates the interactive `RunGraphView`. The interactive graph supersedes the static list; keeping both gives the page two competing answers to the same question.

The task-accounting components (`EventTimeline`, `LlmCallsTable`, which live beside the run page since the task page was deleted on 2026-10-05) are task-level accounting — they report on cost and status transitions for the backing task, not on individual node executions — and belong at the page bottom as a separate grouping.

## FR1 — The static step list is deleted

- `AssemblyRunView` renders the header alone (the trail, the definition name and the status), which the visualization panel draws at the top of its left column, above the graph; the metadata facts table (branch, outcome, reason, duration, task link, PR link) is `RunFacts`, drawn by the visualization panel in its left column under the graph rather than in the header. The `<ol>` step list produced by `stepViews()` is removed. _(Amended 2026-10-09.)_ ([leaves the facts card out of the header](apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunView.test.tsx#L39), [draws the header above the graph, the run details under it and the task notice after the attempt, outside the aside](apps/web-ui/src/app/assembly-runs/[id]/RunVisualizationPanel.test.tsx#L670), [draws the header above the graph and the issue card below the facts, all outside the aside](apps/web-ui/src/app/assembly-runs/[id]/RunLiveShell.test.tsx#L226))
- _(Amended 2026-09-09; 2026-10-09)_ The facts table is framed as an open collapsible card titled `Run facts`, the same surface every other detail page gives its summary block — the header facts were the one card-shaped block on this page still rendering as bare markup. ([renders the run facts as an open collapsible card titled Run facts](apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunView.test.tsx#L111))
- _(Amended 2026-09-09)_ The backing task's GitHub Issue is the last fact in the card, under the PR link: a run with an issue links it as `#<number>`, a run without one omits the row entirely, the same shape the PR fact already has. The issue rides the run-row enrichment's existing task join (`issue_url`/`issue_number`), not a second read. ([validated by](apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunView.test.tsx#L169), [omitted when absent](apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunView.test.tsx#L178), [carried by the row mapper](apps/web-ui/src/lib/assembly-runs.test.ts#L51), [and by the enrichment query](apps/lore-api/src/integration-tests/assembly-run-enrichment.test.ts#L106))
- The interactive `RunGraphView` is the sole visual answer to "what did this run do and in what order." The two are not duplicated.
- Any tests that cover only the step list rendering are deleted with it.

## FR2 — Node detail pane is the container for all per-node content

- `RunVisualizationPanel` opens a node detail pane when a node is selected and closes it when the selection is cleared.
- _(Amended 2026-10-09, run-viz FR4.1g/FR4.14.)_ The pane is two columns: `RunNodeDetail` (the summary card, with the attempt history) in a right-hand panel whose left edge drags, and under the graph the attempt column — the `Show`/`Attempt` selects, then the chosen attempt's transcript or pod logs, then its Needs and Input cards. ([names the selected-node panel a complementary aside beside the graph](apps/web-ui/src/app/assembly-runs/[id]/RunWorkbenchLayout.test.tsx#L21), [shows the newest attempt's pod logs alone once Pod logs is chosen](apps/web-ui/src/app/assembly-runs/[id]/RunVisualizationPanel.test.tsx#L628))
- The pod-log section displays the pod log for the selected node's chosen attempt only. When no node is selected the section is absent. ([shows attempt 1's pod logs when the attempt select picks it](apps/web-ui/src/app/assembly-runs/[id]/RunVisualizationPanel.test.tsx#L650))
- `NodePodLogs` is no longer rendered at the `page.tsx` level. `page.tsx` passes the full `logNodes` list to `RunVisualizationPanel` so the panel can look up the selected node's `agentCrName` without an additional server round-trip.
- `NodePodLogs` receives a single `node: NodeLogTarget | null` prop (instead of `nodes: NodeLogTarget[]`) and returns `null` when `node` is null. This change is contained inside the panel; the `NodeLogTarget` shape is unchanged.

## FR3 — Line-level views remain at line level

- `RunGraphView` is always visible at the top of the visualization section, before any node detail.
- _(Amended 2026-09-09)_ The replay scrubber, its "Back to live" control and the run Timeline card were retired; the graph and the per-node transcript are the whole-run overview.
- `FileHeatmapView` remains at line level. It tallies file touches across all nodes, not just the selected one, and its value is answering "what did this run touch?" not "what did this node touch?".

## FR4 — Task accounting stays at page bottom, visually grouped

- When `run.taskId` is present, `EventTimeline` and `LlmCallsTable` remain on the page, grouped under a "Task accounting" heading below the visualization panel. _(Amended 2026-10-09: the cost table, and the note a task-less run shows in its place, now close the panel's left column, after the attempt on show, instead of sitting below the whole panel.)_ ([draws the run facts under the graph and the task-less notice after them, both outside the aside](apps/web-ui/src/app/assembly-runs/[id]/RunLiveShell.test.tsx#L263))
- When `run.taskId` is absent, the "Task accounting" section is omitted and the existing explanatory paragraph ("This run has no backing task…") is removed with it. A run without a task is not a degraded state that requires explanation — it is a normal case for detection lines. _Amended 2026-09-02:_ the note stays for now, but renders through the shared secondary `Alert` atom (`specs/web-ui-theming`) instead of a bare `className="meta"` paragraph.

## FR5 — No new components; redundant paths are deleted

- The refactor moves and resizes existing components. It does not introduce new component files.
- `NodePodLogs.tsx` prop signature changes (FR2) but its rendering logic is unchanged.
- `AssemblyRunView.tsx` loses the step list and `stepViews()` helper. The component is not deleted — its header rendering is still server-rendered above the visualization panel.
- `TriggerReviewButton` placement is unchanged (below the header, gated on `code-review` definition and PR number). _Amended 2026-09-02:_ the gate moved out of `page.tsx` into `AssemblyRunOptions`, the component that decides which actions a run offers from the run itself.
  - A `code-review` run with a PR number renders the trigger-review button. ([validated by](apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunOptions.test.tsx#L34))
  - A run of another definition renders no options. ([validated by](apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunOptions.test.tsx#L42))
  - A `code-review` run without a PR number renders no options. ([validated by](apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunOptions.test.tsx#L52))

## Alternatives Rejected

- **Keep both graph and step list, reconcile their state.** The step list is server-rendered and the graph is client-driven; synchronizing them requires lifting state that is currently cleanly owned by `RunVisualizationPanel`. The graph is the more capable view and the step list adds no information a selected graph node does not already surface via `RunNodeDetail`.

- **Show all nodes' pod logs simultaneously.** `NodePodLogs` already renders one collapsible `<details>` per node; the issue is not collapsed vs expanded but the section being disconnected from node selection. Showing all logs outside the graph makes the quantity of log content worse, not better, when a line has many nodes.

- **Move `FileHeatmapView` into the node detail pane and scope it per-node.** The heatmap's value proposition is the run-level picture of what files the agent worked on. Scoping it per-node fragments that view into a per-node read/write count that `RunNodeDetail` already surfaces as a scalar ("files touched"). Per-node heatmap is a future affordance, not a prerequisite here. _(The placement alone — run-level data in the side panel, not scoped per-node — was later accepted; see run-viz FR4.14.)_

- **Dissolve `RunVisualizationPanel` and lift its state to `page.tsx`.** The panel's reducer, SSE connection, and clock are client-only concerns that `page.tsx` (an `async` server component) cannot hold. The panel stays as the client-side state boundary; this refactor only changes which children it renders and how it passes props.

## Out of Scope

- Transcript source quality. The `NodeTranscriptView` is only as useful as `pipeline.agent_run_events` underneath it (`specs/turn-level-transcript-store`). That dependency is separate and not addressed here.
- Fork-and-rerun affordance in the node detail pane (`specs/fork-rerun-from-node`). The "Rerun from here" button that spec deferred is a natural tenant of the node detail pane introduced here; it is not added in this refactor.
- Per-node file heatmap.
- Log streaming for station nodes (non-agent pods that emit no `agent_cr_name`). `NodePodLogs` returns `null` for those today; this refactor does not change that.

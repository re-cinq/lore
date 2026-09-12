# Feature Specification: lore_get_ci_failures MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_get_ci_failures MCP Tool  |
| Status  | In Progress                    |
| Created | 2026-09-12                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_get_ci_failures`         |
| Module  | ci (`ci-tools.ts`)             |
| Scope   | shared (served in agent mode)  |

`lore_get_ci_failures` tells a caller what CI said about a branch — the sha it judged, the verdict, and every failed check with the annotations that name a file and line, the steps that failed, and the failing step's log tail — so an agent repairing a red build reads the verdict instead of reproducing the build.

## Problem Statement

Run 997026f5 (2026-09-09) reached `repair-build` with a red `format` job whose whole cause was one lint error on one line of one spec. The pod was handed no verdict, reproduced the build from scratch — `npm ci`, then a workspace build — and died at its 1Gi limit before learning anything CI had already printed. The Floor now hands the verdict to the node ([FR15](../../implementation-loop/spec.md)); this tool is the pod's own way to ask, for when the block is missing, truncated, or stale after its own push.

## Interface

Registered via `server.tool` ([registration + handler](../../../apps/mcp-server/src/transport/tools/ci-tools.ts#L83)), in `registerSharedTools`, so the agent-mode gateway serves it.

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `repo` | string | no | git remote of the cwd | `owner/repo`. |
| `branch` | string | no | checked-out branch of the cwd | The branch to report on. |
| `pr_number` | number | no | — | Alternative to `branch`: the pull request whose head branch to report on. Wins when both are given. |

## Behavior

- With no arguments it asks for the checked-out branch of the detected repo, which is all a pod on its own branch knows; it never needs a pull request number. ([validated by asks for the checked-out branch of the detected repo when called with no arguments, which is all a pod knows](../../../apps/mcp-server/src/transport/tools/ci-tools.test.ts#L55))
- Given `pr_number` it asks by number and does not consult git. ([validated by asks by pull request number when given one, without touching git](../../../apps/mcp-server/src/transport/tools/ci-tools.test.ts#L71))
- When neither a branch nor a pull request can be found, or the repo cannot be detected, it says which parameter to pass instead of calling the API. ([validated by says what to pass when neither a branch nor a pull request can be found](../../../apps/mcp-server/src/transport/tools/ci-tools.test.ts#L86), [validated by says what to pass when the repo cannot be detected](../../../apps/mcp-server/src/transport/tools/ci-tools.test.ts#L101))
- It proxies `GET /api/repos/{owner}/{repo}/ci-failures` ([route spec](../../api-routes/ci-failures/spec.md)) and returns the report as pretty JSON; a refusal surfaces the server's own reason. ([validated by surfaces the server's own refusal rather than a generic unreachable line](../../../apps/mcp-server/src/transport/tools/ci-tools.test.ts#L113))
- The checked-out branch is read from git on every call and is null on a detached HEAD, which names no branch CI could have judged. ([validated by returns the checked-out branch](../../../libs/server-core/src/work/repo/repo-detect.test.ts#L63), [validated by returns null on a detached HEAD, which names no branch CI could have judged](../../../libs/server-core/src/work/repo/repo-detect.test.ts#L68), [validated by re-runs git on every call, since a checkout can switch branches between two calls](../../../libs/server-core/src/work/repo/repo-detect.test.ts#L80))

## Output

One MCP text block: the `CiFailureReport` JSON (`branch`, `judged_sha`, `conclusion`, `failures[]` of `{name, app, job_id, annotations[], steps[], tail[]}`), a "specify branch / repo" line, or the API's refusal. **Never throws.**

## Out of Scope

- Reading a job's full log — `lore_get_ci_job_log`.
- Review state — `lore_get_pr_status`.

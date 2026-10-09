# Feature Specification: ESLint canary

| Field  | Value |
| ------ | ----- |
| Status | Draft |

A spec whose only job is to name a path this repository does not have, so
`no-ungrounded-spec-name` has something to report. A rule that stops looking
reports nothing, which reads exactly like a clean corpus.

## Requirements

- **FR1**: The walk MUST be replayed by `apps/floor/src/work/task/dispatch-agent-cr.ts`, which was deleted with the old Floor.
- **FR2**: A declared `Draft` status MUST disagree with this linked statement. ([validated by](libs/shared/src/work/spec-status-coverage.test.ts#L50))

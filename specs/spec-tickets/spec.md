| Feature   | Spec Tickets Assembly Line                                                         |
| --------- | ---------------------------------------------------------------------------------- |
| Status    | In Progress                                                                        |
| Created   | 2026-10-22                                                                         |
| Owner     | Lore Platform Team                                                                 |
| Builds on | [external-floor](../external-floor/spec.md), [7-feature-planning](../7-feature-planning/spec.md) |

Tickets come from a spec, not from the plan that happened to write it. The `spec-tickets` assembly line runs on the external floor every time a pull request merges a `specs/<name>/spec.md` into the default branch. It splits the spec into one user story and the task tickets under it, and a later merge of the same spec rewrites the tickets the earlier run filed instead of filing a second set. The feature-planning line stops at the merge of its spec pull request.

## Requirements

### Trigger

- **FR1**: A merged pull request MUST start one `spec-tickets` run for each `specs/<name>/spec.md` it changed, and no other file starts one. ([validated by keeps only specs/<name>/spec.md and drops plan, tasks and nested files](libs/shared/src/work/spec-tickets/floor-spec-tickets.test.ts#L42), [validated by starts one spec-tickets run per merged spec, keyed on repo, path and merge commit](libs/shared/src/work/spec-tickets/floor-spec-tickets.test.ts#L72))
- **FR2**: A pull request closed without a merge, or merged into a branch other than the repository's default branch, MUST start no run. ([validated by starts nothing for %s](libs/shared/src/work/spec-tickets/floor-spec-tickets.test.ts#L106), [validated by is null for a close that names no merge commit](apps/stations/src/events/floor-spec-tickets-handlers.test.ts#L27))
- **FR3**: A spec marked Rejected or Retired, and a spec the merge deleted, MUST start no run. ([validated by skips a rejected spec, a retired one and one the merge deleted](libs/shared/src/work/spec-tickets/floor-spec-tickets.test.ts#L118))
- **FR4**: A run MUST be keyed on the repository, the spec path and the merge commit, so two merges of one spec each get a run and a redelivered merge starts no second one. ([validated by joins repository, spec path and merge commit](libs/shared/src/work/spec-tickets/floor-spec-tickets.test.ts#L56), [validated by skips a spec whose run key is already open, so a redelivered merge starts no second run](libs/shared/src/work/spec-tickets/floor-spec-tickets.test.ts#L131))
- **FR5**: The stations service MUST start a run from the `github.pull_request.closed` event on a deployment that has a floor. ([validated by starts a spec-tickets run for a merged specs/<name>/spec.md on the default branch](apps/stations/src/events/floor-spec-tickets-handlers.test.ts#L36), [validated by reads the merge out of a merged pull request's close](apps/stations/src/events/floor-spec-tickets-handlers.test.ts#L17))

### The line

- **FR6**: The line MUST walk `load-tickets`, `decompose`, `issues` and `issue-coverage` to `done`, and end as failed when a step breaks. ([validated by walks spec-tickets from load-tickets through decompose and issues to issue-coverage and done, keyed on the run key](libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts#L121))
- **FR7**: The `spec-tickets-load` station MUST give the decompose agent the id, title, issue number and state of every ticket an earlier run filed for the spec. ([validated by lists a filed task by its id, title, issue number and state, without the body](apps/stations/src/spec-tickets/load-tickets/listing.test.ts#L15), [validated by is empty for a spec nothing was filed for](apps/stations/src/spec-tickets/load-tickets/listing.test.ts#L26))
- **FR8**: The tickets of a spec MUST be recognised on every run by a filing key made of the spec's directory name, with no slash for the issue markers to split on. ([validated by is the spec directory name behind a spec- prefix, with no slash for the marker to split on](libs/shared/src/work/spec-tickets/floor-spec-tickets.test.ts#L64))
- **FR9**: A rerun MUST rewrite the open tickets it finds, leave closed ones alone, and close the open ones whose task the spec dropped, through the issue filing the planning line shares with issue triage (`apps/stations/src/planning/file-issues/plan-issue-filing.ts`).
- **FR10**: The `spec-tickets-coverage` station MUST count every testable statement of the whole spec, not only those one plan wrote, and send the uncovered ones back to decompose.

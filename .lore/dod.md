# Definition of Done

> The `issue-triage` task type MUST be added to `TaskTypeSchema` in `libs/shared/src/domain/models/pipeline-task.ts` and to `TRUST_LEVELS` (`libs/shared/src/domain/pipeline-task-trust.ts`) at tier `implementation`.

**Strategy: `direct`** — Both `TaskTypeSchema` (a Zod enum) and `TRUST_LEVELS` (a plain object) are importable and callable today; `createTask` exercises the full trust gate in the existing test harness with a DB mock.

## Done when these pass

- [x] **TaskTypeSchema accepts 'issue-triage' without a validation error** — `TaskTypeSchema.safeParse('issue-triage').success` is `true`
  `libs/shared/src/domain/pipeline-tasks.trust.test.ts`

- [x] **TRUST_LEVELS maps 'issue-triage' to the implementation tier** — `TRUST_LEVELS['implementation']` contains `'issue-triage'`
  `libs/shared/src/domain/pipeline-tasks.trust.test.ts`

- [x] **createTask allows an issue-triage task at trust level implementation** — `createTask` resolves (does not throw) when `taskType: 'issue-triage'` and the pool reports trust level `implementation`
  `libs/shared/src/domain/pipeline-tasks.trust.test.ts`

## Facets

- [x] Add `'issue-triage'` to the `z.enum([...])` in `TaskTypeSchema` in `libs/shared/src/domain/models/pipeline-task.ts`
- [x] Add `'issue-triage'` to the `implementation` tier array in `TRUST_LEVELS` in `libs/shared/src/domain/pipeline-task-trust.ts`
- [x] Run the test file and confirm all 17 tests pass

## Out of scope

- `assemblyLineFor` mapping in `apps/floor/src/work/task/dispatch-agent-cr.ts` (dispatch goes via `floor.lines.start`, not `assemblyLineFor`)
- Adding the line name to the pinned bundled-lines list in `libs/assembly-lines/src/loader.test.ts` (covered by T001)
- Any station, YAML graph topology, or Floor-side wiring for the `issue-triage` assembly line

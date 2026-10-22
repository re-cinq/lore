# Definition of Done

> Enforce formatting, branch syncing, and disallow typechecking/building within the pod context.
> Target file: `apps/stations/src/domain/delivery-contract.ts`

**Strategy: `parallel-change`** — The behaviour needs to execute shell commands (`git`, `prettier`), requiring a new seam. We will build the new module `delivery-contract.ts` with this seam, and switch callers over once it is green.

## Done when these pass

- [ ] **Pod correctly commits and pushes** — verifies the contract commits and pushes the pod's branch
  `apps/stations/src/domain/delivery-contract.acceptance.test.ts`
- [ ] **Pod formatting runs before commit** — verifies the contract formats changed files before committing
  `apps/stations/src/domain/delivery-contract.acceptance.test.ts`

## Facets

- [ ] Implement `DeliveryContract` that enforces formatting
- [ ] Implement `DeliveryContract` that enforces branch syncing and disallows typechecking

## Out of scope

- Updating every agent prompt to remove the existing text-based instructions (this will happen after the programmatic switch).

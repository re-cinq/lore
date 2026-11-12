# Definition of Done

> Add/identify a multiple-link rendering+hover case and validate the suite; injected state does not prove parser-to-UI agreement.

**Strategy: `mechanical`** — The ticket requests a test for multiple test links. The UI already handles multiple links correctly because `StatementPopover` iterates over `testLinks`. We add the requested test to `SpecDetails.test.tsx` to pin this behaviour.

## Done when these pass

- [x] **Multiple test links rendering** — The test asserts that a statement with multiple test links renders green and its hover lists every link.
  `apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.test.tsx`

## Facets

- [x] Add the test case for multiple test links to `SpecDetails.test.tsx`.

## Out of scope

- Extracting multiple links in the backend or any production code changes.
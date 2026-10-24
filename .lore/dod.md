# Definition of Done

> Add gh CLI to runner image
> Update docker/claude-runner/Dockerfile to implement the requirements.

**Strategy: `direct`** — A direct test building and executing the Docker container verifies the CLI presence. The red bar is CI's to show; the `test-report` job runs the tests via Vitest in an environment with Docker installed.

## Done when these pass

- [ ] **agent-image has gh CLI installed** — verifies `gh` is available in the image's path.
  `apps/agent-image/agent-image.acceptance.test.ts`

## Facets

- [ ] Add github apt repository to the Dockerfile
- [ ] Install `gh` package in the agent-image Dockerfile

## Out of scope

- Updating the entrypoint script (handled by task T001's other facet)
- Using the gh CLI to post comments

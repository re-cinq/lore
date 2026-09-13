# Definition of Done

> The Floor's rendered prompt never reaches the pod: recipe templates render {description}+{context}, and parameters.prompt is unreferenced

**Strategy: `direct`** — `agentDefToCrds()` in `libs/shared/src/outbound/project/agents/agent-crd.ts` is a pure function; the acceptance harness already captures the dispatched `LoreTaskSpec.prompt`; the subsystem's `renderPrompt` is trivially simulatable inline. No new seam needed.

## Done when these pass

- [ ] **the pod's view of a tdd-round dispatched after a red build includes what CI said** — renders the AgentDefinition CR template with the CR parameters (the subsystem's rule: plain `{key}` substitution) and asserts the CI block is in the result; currently the template ends with `{description}\n{context}` and ignores `parameters.prompt`, so the CI block is absent.
  `apps/floor/src/work/assembly-run/implementation-loop-acceptance.test.ts`

## Facets

- [ ] Change `llmPrompt()` in `libs/shared/src/outbound/project/agents/agent-crd.ts` to return `{prompt}` (when `opts.mcpUrl` is set) instead of appending `\n\n{context}` to the recipe. The Floor's `parameters.prompt` is already the complete prompt: recipe rendered with the ticket, the bootstrap appended, no placeholders left.
- [ ] Update the existing `agent-crd.test.ts` assertion that checks `prompt: "Implement the task.\n\n{context}"` — after the fix it becomes `"{prompt}"`.
- [ ] Update the satellite test: `prompt: "Implement the task."` becomes `"{prompt}"` (no mcpUrl, same rule).

## Out of scope

- Changing the catalog-seed.yaml or migrating org-default `agent_definitions` rows — the recipe prompt field is kept as the human-edited source; only the CRD template changes.
- Changing how `parameters.prompt` is built on the Floor side — `withCiFeedback` / `withIncomingFailure` / `withPriorFailures` are already correct.
- The local runner (`apps/mcp-server/src/transport/tools/local-runner-tools.local.ts`) — it spawns Claude Code directly without the subsystem's `renderPrompt` layer.

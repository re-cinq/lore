# Definition of Done

> Setting a model whose credential family no registered cluster holds currently returns `200 ok` ... let the `/agents` write path reject a model whose family no *live* registered cluster covers, with a message naming the missing credential. That turns "your edit silently does nothing on every cluster" into a 400 at save time.

**Strategy: `direct`** — The `/agents` write path (POST and PUT) is a seam that can be tested directly with HTTP calls in `agents-route.test.ts`.

## Done when these pass

- [x] **rejects an agent creation when no live cluster serves the model family** — the API returns 400 when creating an agent with an unsupported model.
  `apps/lore-api/src/transport/routes/agent-definitions/agents-route.test.ts`
- [x] **does not reject agent creation when a cluster has absent capability data** — the API returns 200 when a cluster's `cluster_info` is `null`.
  `apps/lore-api/src/transport/routes/agent-definitions/agents-route.test.ts`
- [x] **allows saving an unsupported model when force=true is passed (warning path)** — the API allows bypassing the 400 rejection by passing `?force=true`.
  `apps/lore-api/src/transport/routes/agent-definitions/agents-route.test.ts`

## Facets

- [x] cluster-agent reports its capable model families in `cluster_info` at registration.
- [x] lore-api inspects registered cluster-agents on agent-definition writes.
- [x] lore-api rejects writes with a 400 if `model` is unsupported and `force=true` is not present.
- [x] lore-api accepts writes if a registered cluster lacks capability data, or if `force=true` is used.

## Out of scope

- Updating cluster agents to report live capability changes without a re-registration.

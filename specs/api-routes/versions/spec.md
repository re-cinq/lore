# Feature Specification: GET /api/versions API Route

| Field      | Value                                                       |
|------------|-------------------------------------------------------------|
| Feature    | GET /api/versions API Route                                 |
| Status     | In Progress                                                 |
| Created    | 2026-11-13                                                  |
| Owner      | Platform Engineering                                        |
| Route      | `GET /api/versions`, `POST /api/service-versions`           |
| Auth scope | `read` (GET), `write` (POST)                                |
| Module     | `apps/lore-api/src/transport/routes/platform/versions.ts`   |

`GET /api/versions` answers which build of every Lore part runs: the four services, the floor and each of its live clusters (with the AI subsystem there), the database schema, what is on the floor and the agent image. Issue #4581, story #4583.

## Problem Statement

Only the web UI knew its commit, the floor reported only its own sha, the AI subsystem exposed no version, and the laptop adapter learned it was outdated by comparing with git's main, which runs ahead of what is deployed. Nobody could say which build of Lore runs.

## Recording

Each image carries its commit: the build workflows pass `GIT_SHA=<short sha>` and each Dockerfile's final stage sets `LORE_BUILD_SHA` from it; the MCP server names its version after it, and a process outside an image reports `dev`. ([validated by names its version after the LORE_BUILD_SHA it was built from @6db3ca9c](apps/mcp-server/src/transport/build-mcp-server.test.ts#L21), [validated by names its version dev outside an image @4750956f](apps/mcp-server/src/transport/build-mcp-server.test.ts#L29))

Every Lore service writes one row of `lore.service_versions` (migration `0129_service_versions.sql`: `service`, `build`, `packages`, `started_at`) when it starts, replacing its previous row. ([validated by keeps one row per service, the newest start winning @01d2252f](libs/shared/src/outbound/project/service-versions/service-versions.test.ts#L36), [validated by upserts a start on its service with the packages as json @c154c349](libs/shared/src/outbound/project/service-versions/service-versions.test.ts#L51), [validated by lists every row as the model @02f72a83](libs/shared/src/outbound/project/service-versions/service-versions.test.ts#L62))

The row's build is the process's `LORE_BUILD_SHA`, or `dev` without one. ([validated by records the LORE_BUILD_SHA build of stations started now @e19fea3a](libs/shared/src/outbound/project/service-versions/service-versions.test.ts#L109), [validated by records dev for a process built without a sha @a091d9f8](libs/shared/src/outbound/project/service-versions/service-versions.test.ts#L127))

Its packages are the bundled packages' versions as the service's own module resolves them, a package that does not resolve left out. ([validated by reads zod's version from the package the caller resolves and skips a missing one @c4d460cc](libs/shared/src/outbound/project/service-versions/service-versions.test.ts#L77), [validated by records the service's build with the bundled packages it resolves @085c296e](libs/shared/src/outbound/project/service-versions/service-versions.test.ts#L139))

A different floor-client copy resolved by libs/shared is reported beside the service's own, under its name with a libs/shared suffix. ([validated by adds libs/shared's floor-client under its own key when the service resolves an older one @f3e78ca7](libs/shared/src/outbound/project/service-versions/service-versions.test.ts#L94), [validated by adds nothing when the service resolves the same floor-client @0ae28b83](libs/shared/src/outbound/project/service-versions/service-versions.test.ts#L101))

A failed write is logged and the service boots on. ([validated by resolves when the write fails @dccbdd49](libs/shared/src/outbound/project/service-versions/service-versions.test.ts#L154))

lore-api writes its row after migrating the floor and stations after opening their pool, while the lore-mcp gateway, which holds no pool (ADR-032), posts `POST /api/service-versions` with `{service: "lore-mcp", build, packages}` from `startHttpGatewayFromEnv`, never from the laptop adapter. When lore-api does not answer it yet, as during a rollout that starts the gateway first, the gateway asks again every 30 seconds, up to 20 times, before it logs the refusal. ([validated by posts the lore-mcp build and its MCP SDK version to /api/service-versions @dbaa30f7](apps/mcp-server/src/work/versions/report-gateway-version.test.ts#L18), [validated by resolves when lore-api refuses the report @5a6939b4](apps/mcp-server/src/work/versions/report-gateway-version.test.ts#L34), [validated by records the lore-mcp gateway's start @0d847ef3](apps/lore-api/src/transport/routes/platform/versions.test.ts#L63)) ([validated by reports again after a 404 from a lore-api that does not serve the route yet @3b3ba4df](apps/mcp-server/src/work/versions/report-gateway-version.test.ts#L42))

`POST /api/service-versions` accepts only `lore-mcp`; any other service is refused with 400, and it answers 503 without a database. ([validated by refuses a service other than the gateway with 400 @7f436d8a](apps/lore-api/src/transport/routes/platform/versions.test.ts#L81), [validated by answers 503 without a pool @7525bee0](apps/lore-api/src/transport/routes/platform/versions.test.ts#L91))

The web UI holds no service credential, so lore-api reads the build and the planning-station package versions, baked in when the UI was built, from its public version route. ([validated by answers the build sha and the planning packages baked in at build time @1aa7cac9](apps/web-ui/src/app/api/version/route.test.ts#L11), [validated by answers dev and no packages for a build that baked none @87ae9a91](apps/web-ui/src/app/api/version/route.test.ts#L21), [validated by reads the versions of the two installed planning packages @ac496e66](apps/web-ui/src/lib/build-packages.test.ts#L22), [validated by leaves out a planning package that is not installed @355ac644](apps/web-ui/src/lib/build-packages.test.ts#L34))

## Interface

`GET /api/versions` answers 200 with this shape, every part but `latest` and `agentImage` possibly replaced by its `{error}`. ([validated by answers every source, with lore-api's build as the latest @915b0da3](apps/lore-api/src/work/versions/versions-answer.test.ts#L50), [validated by answers 200 with every source's error and the latest build when all are down @e048f638](apps/lore-api/src/transport/routes/platform/versions.test.ts#L40))

```
{ lore: { "lore-api": {build, startedAt, packages}, stations, "lore-mcp", "lore-ui": {build, packages} },
  latest: { build },
  floor: { build, schemaVersion, clusters: [{id, build, subsystem, lastSeenAt}] },
  database: { migration, floorMigration },
  onFloor: { pipelines: [{id, hash}], agentDefinitions },
  agentImage }
```

## Behavior

Every source answers, and `latest.build` is lore-api's own build: what `lore_update` compares the laptop adapter with. ([validated by answers every source, with lore-api's build as the latest @915b0da3](apps/lore-api/src/work/versions/versions-answer.test.ts#L50))

Each source fails alone: its part answers `{error}` and the rest still answer, so the route answers 200 even with every source down. ([validated by answers an error for each lore service when the service table fails, and the rest whole @8c042198](apps/lore-api/src/work/versions/versions-answer.test.ts#L87), [validated by answers an error for the ui, the floor, the database and the floor's contents each alone @6b02bf9e](apps/lore-api/src/work/versions/versions-answer.test.ts#L109), [validated by answers 200 with every source's error and the latest build when all are down @e048f638](apps/lore-api/src/transport/routes/platform/versions.test.ts#L40))

A service with no row answers `{error: "not reported"}`. ([validated by answers not reported for a service with no row @cbf36ac3](apps/lore-api/src/work/versions/versions-answer.test.ts#L101))

The UI part comes from the UI's version route with a 5 s limit; a UI that predates packages answers none, and a non-2xx answer or a missing URL is that part's error. ([validated by reads the ui's build and packages from its public version route @9a1cece2](apps/lore-api/src/work/versions/version-sources.test.ts#L20), [validated by answers no packages from a ui that predates them @cc8c1a5b](apps/lore-api/src/work/versions/version-sources.test.ts#L37), [validated by refuses a ui answering 502 @1552069d](apps/lore-api/src/work/versions/version-sources.test.ts#L46), [validated by refuses when no ui url is configured @e03847c0](apps/lore-api/src/work/versions/version-sources.test.ts#L54))

The floor part comes from the floor's `GET /version`, whose `clusters` list is read defensively: a floor that predates it answers none, and only the clusters that parse are kept. ([validated by answers no clusters from a floor that predates them @35dd88c6](apps/lore-api/src/work/versions/versions-answer.test.ts#L134), [validated by keeps only the clusters that parse, a subsystem-less one included @616bb17f](apps/lore-api/src/work/versions/versions-answer.test.ts#L148))

`database` names the newest SQL migration and the newest `floor/` migration recorded in `lore.schema_migrations`. Only numbered `.sql` files count as the SQL migration; other rows in that table, such as the shipped-skills ones, do not. ([validated by answers the newest sql and floor migrations from schema_migrations @7d01ef71](apps/lore-api/src/work/versions/version-sources.test.ts#L62)) ([validated by counts only numbered sql files as the database migration, not floor or skills rows @66093a47](apps/lore-api/src/work/versions/version-sources.test.ts#L75))

`onFloor` lists each shipped pipeline file's line id with the hash the floor holds for it (null when it holds none) and counts the agent definitions on the floor. ([validated by reads merge from a shipped pipeline file's line id @177e6464](apps/lore-api/src/work/versions/version-sources.test.ts#L12), [validated by answers each shipped line's hash on the floor, null for one it lacks, and the agent count @31d924c6](apps/lore-api/src/work/versions/version-sources.test.ts#L90))

Without a floor (`FLOOR_API_URL`, `FLOOR_SERVICE_TOKEN`) both floor parts answer `{error: "no floor configured"}`. `agentImage` is `LORE_AGENT_IMAGE`, null when unset, and `latest` is `dev` outside an image. ([validated by answers dev and a null agent image for a process given neither @576c01d1](apps/lore-api/src/work/versions/versions-answer.test.ts#L167))

## Out of Scope

- The floor's own registration of cluster and subsystem versions (re-cinq/floor#72, re-cinq/ai-agent-subsystem#374).
- History: only each service's current start is kept.

# Pack layout reference

A pack is a git repository you own. Lore reads it and applies it on top of what Lore ships, so you can add instructions to a shipped agent, replace one, add agents of your own, and define whole new assembly lines, without building a modified Lore image. This page describes the layout Lore expects, what it refuses, and how the pack reaches a running install.

One install reads one pack.

## Layout

The pack holds one folder per assembly line, and the folder name is the line name, plus an optional `skills/` folder for catalogue skills.

```
acme-flow/
  assembly-line.yaml         a new assembly line (optional)
  agents/acme-worker.md      a full agent definition
code-review/
  assembly-line.yaml         your version of a shipped line (optional)
  agents/code-review.md      your version of a shipped agent
implementation-loop/
  agents/loop-dod.extra.md   text appended to a shipped agent's prompt
skills/
  acme-review.md             a catalogue skill of your own, or your version of a shipped one
```

The template [re-cinq/lore-assembly-lines](https://github.com/re-cinq/lore-assembly-lines) holds a copy of every shipped pipeline and agent in this layout.

Files at the top of the repository, under `docs/` and under a folder whose name starts with a dot are ignored, so a README or a CI workflow is fine. Inside a line folder, a markdown or YAML file at any other path is refused, so a misspelt `assembly-line.yml` or `agent/` folder shows up instead of quietly doing nothing.

### Three kinds of agent file

| File | What it does | Later Lore improvements |
| ---- | ------------ | ----------------------- |
| `agents/<agent>.extra.md` | Plain text appended to the shipped prompt of `<agent>`, after a blank line. | Kept: the shipped prompt still updates under your text. |
| `agents/<agent>.md` for a shipped agent | Replaces that agent's definition completely. | Lost: you own the prompt from now on. |
| `agents/<agent>.md` for an agent nothing ships | A new agent. | Not applicable. |

A full definition is a markdown file with the agent's settings as frontmatter and its prompt as the body, the same format as the shipped files in `libs/shared/src/agent-defaults/`:

```markdown
---
image: ghcr.io/acme/agent:2
timeout_minutes: 10
model: claude-sonnet-4-6
---
Work the ticket. Follow the Acme naming rules.
```

`image`, `timeout_minutes` and the prompt body are required. A value in the settings may name an environment variable of the Lore install as `${NAME}`; it is filled in when the pack is applied. Variables are filled into settings only, never into the prompt.

An extension may contradict the shipped prompt. That is allowed: you own the behaviour that results and you test it. Lore does not check the two for consistency.

### Assembly lines

`<folder>/assembly-line.yaml` is an assembly line in the same format as the shipped files in `libs/assembly-lines/src/floor-pipelines/`. A pack written before the rename keeps working: `<folder>/pipeline.yaml` is still read as the same file. A folder that holds both is refused for `pipeline.yaml` and `assembly-line.yaml` is applied. The `line.id` must equal the folder name. Every agent a station names must be shipped by Lore or defined by the pack.

A folder named like a shipped pipeline holds your version of that line, and it replaces Lore's on the floor. You own that line from then on. Lore's later changes to it do not reach the install until you copy them into the pack, and a broken version can stop the work the line does, such as code review or the implementation loop. Lore's boot puts its shipped pipelines on the floor, but it skips a line your pack replaced, so a restart never puts Lore's version back in front of yours.

A station with the same name in two pipelines is one station on the floor. If your version of one line changes a station another shipped line also uses, copy that line too, or the next boot can put Lore's station back until the pack syncs again.

A pipeline that needs your own code uses a `kind: service` station. Lore runs none of your code; see [A custom stations service](#a-custom-stations-service).

## Refusals

Each file is checked on its own. A refused file is recorded with its reason and the rest of the pack is still applied. Lore refuses:

- a markdown or YAML file in a line folder at a path Lore does not read, such as `assembly-line.yml`, `agent/reviewer.md`, `skills/acme/SKILL.md` or `skills/assembly-line.yaml`;
- a folder that holds both `assembly-line.yaml` and `pipeline.yaml` (the message says `the folder F holds its line twice: assembly-line.yaml is read, so remove pipeline.yaml`);
- a pipeline whose `line.id` is not the folder name, or that two folders define;
- a pipeline that is not valid, or that names an agent neither Lore nor the pack provides;
- an `.extra.md` for an agent nothing ships;
- an agent file that is not valid markdown with frontmatter, or that lacks `image`, `timeout_minutes` or a prompt;
- an agent given both as `<agent>.md` and `<agent>.extra.md`, or defined in two folders;
- an agent file naming an environment variable the install does not set;
- a `skills/<name>.md` whose name is not lower-case letters, digits and hyphens, or that lacks a lore-help block with a `**Summary.**` line and a `**Usage:**` line.

The refused files and their reasons show on the Pack card of the Settings page and are stored with the last sync in the `pack.sync` setting, which `GET /api/pack` returns.

If the pack repository cannot be reached, Lore keeps what the floor already holds and records the error. An unreachable pack is never read as an empty one.

## Removal

Applying a pack is a comparison with the previous apply, so removing a file undoes it.

- Remove an `.extra.md` or a replacement of a shipped agent, and the agent goes back to the shipped prompt.
- Remove a new agent and the floor keeps its last definition; archive it on the floor if you want it gone.
- Remove a pipeline folder and the pipeline is archived on the floor, not deleted. Runs in progress finish.
- Remove your `assembly-line.yaml` of a shipped line and Lore's own line goes back on the floor.
- Remove a `skills/<name>.md` and, if Lore ships a skill of that name, the shipped skill is written back; if only the pack had it, the skill is deleted from the catalogue. A file that is still in the pack but refused keeps the skill the last sync applied.

Applying is idempotent: only a file whose content changed produces a new agent or pipeline version.

## Skills

`skills/<name>.md` is a catalogue skill in the format of the shipped files in `libs/shared/src/agent-defaults/skills/`: optional frontmatter with `description` and `model`, a `# Title` heading, and the lore-help block between `<!-- lore-help:begin -->` and `<!-- lore-help:end -->`. A name Lore ships replaces that skill; any other name adds a skill. The skill is written to the organisation catalogue only when its title, description, model or content differs from what is there, and the row keeps its Enabled flag.

`skills` and `agent-skills` are reserved folder names, never a line folder. Inside `skills/` only `<name>.md` is read; any other path is refused. Everything under `agent-skills/` is ignored.

Two limits to know:

- A pack skill named like a skill baked into the gateway image (`tdd-loop`, `lore-context` or `legacy-characterize`, under `apps/mcp-server/agent-skills/skills/`) reaches developer laptops but not agent pods, where the image's copy wins.
- A skill an administrator wrote by hand and the pack then takes over is deleted when the pack later drops it, as an agent is.

## Agents and skills the pack manages are read-only

An agent the pack supplies cannot be edited as an organisation default in the web UI or through `PUT /api/agent-definitions/{name}`: the write answers `409 {"error":"pack_managed"}`, and the Edit link is hidden. Edit the file in the pack instead. A skill the pack supplies is read-only the same way: `PUT` and `DELETE` on `/api/skill-definitions/{name}` answer `409 {"error":"pack_managed"}`, the Skills list shows "Managed by pack", and the skill page has no Save. Once `LORE_PACK_REPO` is unset nothing is pack-managed. A per-repository override of the same agent stays editable and is kept when the pack updates the organisation default.

## When the pack is applied

- When lore-api starts.
- When a push reaches the configured branch of the pack repository.
- Every 15 minutes, as a catch-up.
- When an admin chooses Sync now on the Pack card, or posts to `POST /api/pack/sync`.

Several Lore replicas may receive the same push. One takes a lease and applies; the others skip.

## Configuration

In the Helm values of the umbrella chart, set the pack on both lore-api and the stations service, since the stations service listens for the push:

```yaml
lore-api:
  env:
    LORE_PACK_REPO: acme/lore-pack   # owner/name; empty means no pack
    LORE_PACK_REF: main              # branch or tag; empty means the default branch
  commitAuthor:
    name: Acme Agent
    email: agent@acme.example
lore-stations:
  env:
    LORE_PACK_REPO: acme/lore-pack
    LORE_PACK_REF: main
```

`commitAuthor` is the name and email on the commits your agents make. It replaces the default identity without a prompt edit.

The pack is read through the GitHub integration Lore already uses, on the host in `GITHUB_HOST`. The Lore GitHub App must be installed on the pack repository, with read access to its contents. A repository the App cannot see is reported as an unreachable pack.

## Check the pack before merging it

The linter applies exactly the checks above to a local directory. It needs no floor and no network.

```
npm run pack:lint -w apps/lore-api -- /path/to/pack
```

It prints each refused file with its reason, exits 1 when any file is refused and 0 otherwise. In your pack repository's CI, with a checkout of Lore beside it:

```yaml
name: pack-lint
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          path: pack
      - uses: actions/checkout@v4
        with:
          repository: re-cinq/lore
          ref: v1.0.5          # the Lore release your install runs
          path: lore
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
        working-directory: lore
      - run: npm run build -w @re-cinq/lore-shared && npm run build -w @re-cinq/lore-assembly-lines
        working-directory: lore
      - run: npm run pack:lint -w apps/lore-api -- "$GITHUB_WORKSPACE/pack"
        working-directory: lore
```

`npm ci` does not build the workspace libraries, and the linter imports two of them, so the workflow builds them first. The linter fills any `${NAME}` an agent file names with a placeholder, because your install's environment is not available in CI.

## A custom stations service

Lore does not run your code. A pipeline station that needs your own logic is a `kind: service` station, served by a process you deploy yourself, anywhere that can reach the floor's HTTP API. It is built with `@re-cinq/floor-station`, the same package Lore's own stations use (see `apps/stations/src/code-review/read-review/station.ts`).

Declare the station in the pipeline. Its name is the key under `stations:`:

```yaml
stations:
  notify-owner:
    description: Tells the ticket's owner in Acme's own chat system.
    kind: service
    outcomes:
      - success
      - failed
    needs:
      - name: ticket
        kind: value
    produces:
      - name: notified_at
        kind: value
```

Serve it:

```ts
import { defineStation } from "@re-cinq/floor-station";

// The name must equal the station's key in assembly-line.yaml.
defineStation("notify-owner", async (brief, tools) => {
  const ticket = brief.needs.ticket;

  try {
    await postToAcmeChat(ticket, { signal: tools.signal });
  } catch (cause) {
    return { outcome: "failed", error: String(cause) };
  }

  return {
    outcome: "success",
    produced: { notified_at: new Date().toISOString() },
  };
});

async function postToAcmeChat(
  ticket: string,
  options: { signal: AbortSignal },
): Promise<void> {
  await fetch("https://chat.acme.example/api/notify", {
    method: "POST",
    body: JSON.stringify({ ticket }),
    signal: options.signal,
  });
}
```

Run it with `FLOOR_API_URL` and `FLOOR_SERVICE_TOKEN` set to the floor's address and a service token. The service needs a way out to the floor and nothing else: the floor never calls it. It claims the visits tagged `station:notify-owner` from the floor's queue. The brief carries each need by name (a value as its text, a file as an address for `tools.read`, a repository as `url@ref`). The function returns one of the outcomes the station declares and the values it produces; a file is produced with `tools.produce(name, bytes)`. A function that throws fails the visit with what it threw. If the floor cannot be reached, the visit goes back to the queue and is tried again.

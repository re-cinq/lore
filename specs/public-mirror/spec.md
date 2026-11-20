# Feature Specification: Public Mirror

| Field    | Value                                         |
|----------|-----------------------------------------------|
| Feature  | Public Mirror                                 |
| Branch   | feat/93-t01-mirror-settings                   |
| Status   | Shipped                                       |
| Created  | 2026-11-20                                    |
| Owner    | Platform Engineering                          |

A private repository can name one public repository as its mirror. Development stays private and the public repository receives the private main branch as versioned releases (see `specs/scheduled-releases`). This spec holds the setting that pairs the two and the lookup that finds the private repository from the public name; later tickets of the user story add what runs on top of the pair.

## FR1 — The `public_mirror` setting

- A repo names its public mirror in `settings.public_mirror` as an owner and a name joined by a slash; the settings route (`PUT /api/repos/{owner}/{repo}/settings`) stores it for a repo with no mirror and no chain. ([validated by stores public_mirror re-cinq/lore-public for a repo with no mirror and no chain @5b3fff1c](apps/lore-api/src/transport/routes/repos/repo-settings-mirror.test.ts#L140))
- A value that is not an owner and a name joined by a slash is refused with 400 and nothing is written. ([validated by returns 400 for a mirror that is not owner/name @4b24cea1](apps/lore-api/src/transport/routes/repos/repo-settings-mirror.test.ts#L162))
- A repo cannot name itself as its mirror, whatever the case of the name. ([validated by returns 400 for a repo naming itself in another case as its mirror @dd126ef5](apps/lore-api/src/transport/routes/repos/repo-settings-mirror.test.ts#L150))
- A repo that is already the mirror of another repo cannot name a mirror of its own, so there are no chains. ([validated by returns 400 for a repo that is already the mirror of another @15e958f6](apps/lore-api/src/transport/routes/repos/repo-settings-mirror.test.ts#L172))
- A repo cannot name a mirror that has a `public_mirror` of its own. ([validated by returns 400 for a mirror that has a public_mirror of its own @443f7fd3](apps/lore-api/src/transport/routes/repos/repo-settings-mirror.test.ts#L187))
- A repo cannot name a mirror another repo already publishes to, whatever the case of the name. ([validated by returns 400 for a mirror that another repo already publishes to @5d181842](apps/lore-api/src/transport/routes/repos/repo-settings-mirror.test.ts#L200))
- A repo saving the mirror it already has is accepted. ([validated by returns 200 when a repo saves the mirror it already has @7895152c](apps/lore-api/src/transport/routes/repos/repo-settings-mirror.test.ts#L214))
- Sending `public_mirror: null` clears the setting. ([validated by clears public_mirror when null is sent @e4564e72](apps/lore-api/src/transport/routes/repos/repo-settings-mirror.test.ts#L221))
- Migration `0131_repos_public_mirror_idx.sql` makes `lower(settings->>'public_mirror')` unique across `lore.repos` rows that set it, so two private repos can never publish to one public repo. The Postgres contract test proves it with two repos whose mirror names differ only in case: the second write fails with error code 23505 and the first repo stays the owner. ([validated by rejects with 23505 a second repo naming the mirror in another letter case and leaves the first as its owner @0c4e901e](libs/shared/src/outbound/project/settings/settings-mirror-owner.contract.test.ts#L154))
- A repo with no `public_mirror` and no `release` block is saved exactly as before. ([validated by leaves a repo with neither block exactly as saved before @d6afaa0a](apps/lore-api/src/transport/routes/repos/repo-settings-mirror.test.ts#L264))

## FR2 — Finding the private repo from the public name

- `SettingsPort.mirrorOwner(name)` returns the `full_name` of the repo whose `public_mirror` is `name`, in the Postgres adapter and the in-memory double alike. ([validated by returns the private repo for its exact mirror name @e9088a88](libs/shared/src/outbound/project/settings/settings-mirror-owner.contract.test.ts#L70))
- The comparison ignores case. ([validated by returns the private repo for the mirror name in another case @d7165498](libs/shared/src/outbound/project/settings/settings-mirror-owner.contract.test.ts#L83))
- It returns null for a name no repo names as its mirror. ([validated by returns null for a name no repo names as its mirror @4dd0ead3](libs/shared/src/outbound/project/settings/settings-mirror-owner.contract.test.ts#L96))
- It returns null for a repo whose settings column is null. ([validated by returns null for a repo whose settings are null @0bb49ec4](libs/shared/src/outbound/project/settings/settings-mirror-owner.contract.test.ts#L107))
- `RepoSettingsSchema` accepts an owner and a name joined by a slash as `public_mirror`. ([validated by accepts re-cinq/lore as the mirror @748080b4](libs/shared/src/domain/models/repo-settings.test.ts#L29))
- `RepoSettingsSchema` refuses a mirror with no slash, an empty owner or name, more than one slash, or whitespace. ([validated by refuses the mirrors lore, re-cinq/, /lore, a/b/c and re-cinq/lo re @58a0a0bf](libs/shared/src/domain/models/repo-settings.test.ts#L35))

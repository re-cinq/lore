# Feature Specification: Scheduled Releases

| Field    | Value                                         |
|----------|-----------------------------------------------|
| Feature  | Scheduled Releases                            |
| Branch   | feat/93-scheduled-releases                     |
| Status   | Shipped                                       |
| Created  | 2026-11-20                                    |
| Owner    | Platform Engineering                          |

A private repository's main branch is published to its public mirror as versioned releases, on a schedule or on demand, with release notes, one Slack post and an entry on the Changelog tab. This section covers the store the releases are kept in.

## Release store

- `lore.changelog_releases` (migration 0132) holds one row per repository and version: the previous tag, the commit, the bump, the range, the summary, the changes, the release URL, where it was published, when it was announced and when it was written. ([validated by reads back v1.3.0 with its change, bump and no announcement @5a66c664](libs/shared/src/outbound/project/changelog-releases/changelog-releases.test.ts#L123), [answers null as the latest release of a repo with none @d1247ed0](libs/shared/src/outbound/project/changelog-releases/changelog-releases.test.ts#L163))
- A second write of the same version replaces its row. ([validated by keeps one row for v1.3.0 written twice, the last summary winning @041e55b1](libs/shared/src/outbound/project/changelog-releases/changelog-releases.test.ts#L169))
- The store orders a repository's releases by the end of the range each covers, newest first, then by version descending, and answers the latest release and a page of the releases ending before a given instant. ([validated by answers v1.2.1, whose range ends 2026-11-20, as the latest over v1.3.0 ending 2026-11-17 and v1.2.0 ending 2026-11-10 @906ca0e9](libs/shared/src/outbound/project/changelog-releases/changelog-releases.test.ts#L180), [pages by the end of the range, before v1.3.0's end 2026-11-17 giving v1.2.0 then v1.1.0 @46de7c5e](libs/shared/src/outbound/project/changelog-releases/changelog-releases.test.ts#L190), [answers v1.3.0, v1.2.0 and v1.1.0 in version order descending when all three end 2026-11-20 @4704902f](libs/shared/src/outbound/project/changelog-releases/changelog-releases.test.ts#L258))
- The store keeps repositories apart. ([validated by keeps the repos apart, v1.0.0 of another repo not appearing in this one's page @e52bedf7](libs/shared/src/outbound/project/changelog-releases/changelog-releases.test.ts#L210))
- `claimAnnouncement` answers true to the first caller of a written version and false to every later one, and a rewrite of the version keeps the claim. ([validated by claims the announcement of v1.3.0 once and answers false the second time @a8420878](libs/shared/src/outbound/project/changelog-releases/changelog-releases.test.ts#L222), [stamps announcedAt on v1.3.0 once claimed @fb37e469](libs/shared/src/outbound/project/changelog-releases/changelog-releases.test.ts#L233), [answers false when claiming the announcement of v9.9.9, which was never written @71d02c76](libs/shared/src/outbound/project/changelog-releases/changelog-releases.test.ts#L242), [keeps the claim when v1.3.0 is written again after being announced @af5185d8](libs/shared/src/outbound/project/changelog-releases/changelog-releases.test.ts#L248))

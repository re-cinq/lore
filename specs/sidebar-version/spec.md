# Feature Specification: Sidebar Version

| Field   | Value                                                                  |
|---------|------------------------------------------------------------------------|
| Feature | Sidebar Version                                                        |
| Status  | Implemented                                                            |
| Created | 2026-11-26                                                             |
| Owner   | Platform Engineering                                                   |

People running Lore could not tell which release they were on, or whether a newer one existed. The left sidebar now shows the running version, a link to the public repository's releases, and a notice when a newer release exists. The notice only tells: Lore holds no Kubernetes client, so it upgrades nothing.

## FR1 — Whether an update is available

- An update is available only when the running version and the latest release are both `vX.Y.Z` tags and the latest is the greater, compared part by part as numbers. ([validated by returns true when running v1.2.3 and latest v1.3.0 @b050c337](../../libs/shared/src/work/release/update-available.test.ts#L5), [validated by returns false when running v1.10.0 and latest v1.9.0 @5ed88d20](../../libs/shared/src/work/release/update-available.test.ts#L13))
- An equal tag is no update. ([validated by returns false when running v1.3.0 and latest v1.3.0 @f1c05bfb](../../libs/shared/src/work/release/update-available.test.ts#L9))
- A build named by its short SHA, which is what an internal-cluster deploy runs, never has an update. ([validated by returns false when running the build 0caa086 and latest v1.3.0 @af83ee07](../../libs/shared/src/work/release/update-available.test.ts#L17))
- No known latest release, or a latest that is not a tag, is no update. ([validated by returns false when running v1.2.3 and latest null @c3d9c526](../../libs/shared/src/work/release/update-available.test.ts#L21), [validated by returns false when running v1.2.3 and latest is the SHA 0caa086 @43607e5a](../../libs/shared/src/work/release/update-available.test.ts#L25))

## FR2 — `GET /api/release`

- The route (scope `read`) answers the latest release of `LORE_PUBLIC_REPO` (chart default `re-cinq/lore`): its tag, its notes url, the releases page, and `updateAvailable` for the version given as `running`. ([validated by answers the latest tag, its notes url and the releases page for re-cinq/lore @240b1f46](../../apps/lore-api/src/transport/routes/release/latest-release.test.ts#L61), [validated by answers updateAvailable true when running v1.2.3 and latest is v1.3.0 @18459142](../../apps/lore-api/src/transport/routes/release/latest-release.test.ts#L76))
- A running SHA build answers `updateAvailable: false`. ([validated by answers updateAvailable false when running the build 0caa086 @14eaa42d](../../apps/lore-api/src/transport/routes/release/latest-release.test.ts#L84))
- GitHub is asked once an hour at most, and an answer that failed is kept for the hour too, so the unauthenticated rate limit is never reached. ([validated by asks GitHub once for two requests within the hour @c2904af9](../../apps/lore-api/src/transport/routes/release/latest-release.test.ts#L92), [validated by asks GitHub again once the hour has passed @cd42c89d](../../apps/lore-api/src/transport/routes/release/latest-release.test.ts#L104), [validated by answers latest null when GitHub answers 500, and does not ask again within the hour @b58b60bb](../../apps/lore-api/src/transport/routes/release/latest-release.test.ts#L116))
- A GitHub that cannot be reached answers `latest: null`, never an error. ([validated by answers latest null when the fetch to GitHub fails @af53a7b8](../../apps/lore-api/src/transport/routes/release/latest-release.test.ts#L135))

## FR3 — The sidebar

- The UI pod learns its release from the chart: `LORE_RELEASE` is the ui chart's `image.tag`, `vX.Y.Z` on a release install and a short SHA on the internal cluster; `/api/version` reports it as `release`. ([validated by answers the build sha, the release tag and the planning packages baked in at build time @01aa6585](../../apps/web-ui/src/app/api/version/route.test.ts#L11), [validated by answers dev, no release and no packages for a build that baked none @2f5e865a](../../apps/web-ui/src/app/api/version/route.test.ts#L23))
- The sidebar reads the release once per page load through the typed client, and shows no verdict when lore-api cannot answer. ([validated by asks lore-api for the release newer than running v1.2.3 @e39907b1](../../apps/web-ui/src/lib/api/release.test.ts#L29), [validated by returns the latest release lore-api answers @fddc17c3](../../apps/web-ui/src/lib/api/release.test.ts#L37), [validated by returns null when lore-api answers 500 @b57f8f69](../../apps/web-ui/src/lib/api/release.test.ts#L41))
- The sidebar shows `Lore vX.Y.Z` (or the short SHA) and always a Releases link to the public repository's releases page. ([validated by shows Lore v1.3.0 and the Releases link when no update is available @e2a3cafd](../../apps/web-ui/src/app/SidebarVersion.test.tsx#L12), [validated by shows the short SHA 0caa086 as the build and no badge for a SHA build @60f21023](../../apps/web-ui/src/app/SidebarVersion.test.tsx#L44))
- When an update is available it also shows an "Update available: vX.Y.Z" badge, a link to that release's notes and nothing more. In the icon rail it collapses to a dot. ([validated by shows the Update available: v1.3.0 badge linking to its notes when running v1.2.3 @bc125a98](../../apps/web-ui/src/app/SidebarVersion.test.tsx#L29))

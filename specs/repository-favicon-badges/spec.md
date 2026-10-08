# Feature Specification: Repository Favicon Badges

| Field   | Value                           |
| ------- | -------------------------------- |
| Feature | Repository Favicon Badges        |
| Branch  | feat/repository-favicon-badges   |
| Status  | Shipped                          |
| Created | 2026-10-08                       |
| Owner   | Platform Engineering             |

A single Lore favicon does not show which repository a browser tab
represents. This feature generates a deterministic owner/repo initials badge
over a stable generated color, served through the dynamic `icon.tsx`
metadata route at the shared repository route segment, so it applies to the
repository overview and every nested repository tab automatically.

## Badge generation

- Generating a badge for the same owner/repo pair produces the same initials
  and the same hex background color every time. ([validated by `repo-favicon.test.ts:5`](apps/web-ui/src/app/repos/[owner]/[repo]/repo-favicon.test.ts#L5))

## Background

GitHub owner avatars would add real branding but introduce a network
dependency, privacy leakage, and a failure mode for a browser icon — a
generated badge is local and stable instead. Next.js route-segment metadata
is inherited by descendants, so the `icon.tsx` file at
`apps/web-ui/src/app/repos/[owner]/[repo]/` applies without being redeclared
on nested repository tabs.

# Research Notes: UX Redesign + Repo Onboarding

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | UX Redesign + Repo Onboarding               |
| Branch         | 4-ux-repo-onboarding                        |
| Created        | 2026-03-29                                  |

## R1: Repo Registry Schema — New `lore` Schema

### Decision

Create a new `lore` schema in PostgreSQL for the `repos` table and
future cross-cutting platform data.

### Alternatives Considered

**Option A: Use `pipeline` schema.**
Rejected. The pipeline schema owns task execution data (tasks, PRs,
agent runs). Repos are a higher-level concept that spans pipeline,
memory, and context. Putting repos in pipeline would create a
misleading ownership boundary.

**Option B: Use `memory` schema.**
Rejected. The memory schema owns agent memories and context chunks.
Repos are not memory — they are the organizational unit that memory
is scoped to. Adding platform metadata to memory conflates two
concerns.

**Option C: Use `org_shared` schema.**
Considered. `org_shared` holds org-wide conventions and shared
context. Repos are org-wide, but they are operational metadata, not
context content. Mixing operational tables with content tables in
`org_shared` would blur the boundary between "data the MCP serves"
and "data the platform uses to operate."

**Option D: New `lore` schema (chosen).**
A dedicated `lore` schema for platform-level operational data. This
schema holds: repos, future org settings, future user preferences,
future audit config. It is the "Lore platform" schema, distinct from
the content schemas (memory, org_shared) and the execution schema
(pipeline).

### Constitution Alignment

- Principle 8 (Schema-Per-Team Isolation): The `lore` schema is
  platform-level, not team-level. It does not violate schema isolation
  because no team MCP server reads from it directly — the web UI and
  MCP tools query it through the API layer.

## R2: Onboarding Templates — Static Files in Repo

### Decision

Store onboarding templates as static files in
`scripts/onboarding-templates/` within the lore repo.

### Alternatives Considered

**Option A: Generate templates dynamically from config.**
Rejected. Over-engineering for the current scope. The templates are
mostly static Markdown and YAML. Dynamic generation adds complexity
without clear benefit — the spec explicitly puts custom per-repo
templates out of scope.

**Option B: Store templates in the database (JSONB).**
Rejected. Templates are code artifacts (Markdown, YAML). They benefit
from version control, code review, and diff visibility. Storing them
in PostgreSQL loses all of this.

**Option C: Store templates in a separate repo.**
Rejected. Adds a cross-repo dependency for no benefit. The templates
are part of the Lore platform — they belong in the lore repo.

**Option D: Static files in `scripts/onboarding-templates/` (chosen).**
Version-controlled, reviewable, easy to test. The onboarding module
reads them at runtime and commits them to the target repo. Changes
go through the normal PR review process.

### Template Files

```
scripts/onboarding-templates/
  CLAUDE.md
  AGENTS.md
  .github/
    PULL_REQUEST_TEMPLATE.md
    workflows/
      pr-description-check.yml
      spec-agent.yml
```

### Constitution Alignment

- Principle 3 (PR Description Quality Gates): The PR template
  enforces the required sections (Why, Alternatives Rejected, ADR
  References, Spec) from day one.
- Principle 6 (Distributed Ownership): Templates provide sensible
  defaults; repo owners customize after merging.

## R3: UI Restructure — Existing Pages as Components

### Decision

Keep existing page implementations as components. Re-mount them
under `/repos/[owner]/[repo]/` routes, passing `owner` and `repo`
as props to filter data.

### Alternatives Considered

**Option A: Rewrite all pages from scratch.**
Rejected. The existing pages work. Rewriting them adds risk and time
without improving functionality. The problem is routing, not
rendering.

**Option B: Use query parameters (`/pipeline?repo=owner/name`).**
Rejected. Query parameters are not idiomatic for Next.js App Router.
They break navigation expectations (back button, bookmarks, sharing
links). The repo is a first-class routing concept, not a filter.

**Option C: Nested layouts with re-mounted components (chosen).**
The repo detail layout (`repos/[owner]/[repo]/layout.tsx`) provides
the tab bar and repo header. Each sub-page imports the existing page
component and passes the owner/repo params. This preserves all
existing logic while restructuring the URL hierarchy.

### Route Migration

| Old Route   | New Route                              | Notes                    |
|-------------|----------------------------------------|--------------------------|
| `/`         | `/`                                    | Now repo list, not agents|
| `/pipeline` | `/repos/[owner]/[repo]/tasks`          | Filtered by repo         |
| `/agents`   | `/repos/[owner]/[repo]/agents`         | Filtered by repo         |
| `/context`  | `/repos/[owner]/[repo]/context`        | Filtered by repo         |
| `/specs`    | `/repos/[owner]/[repo]/specs`          | Filtered by repo         |
| `/search`   | `/search`                              | Stays global             |
| `/audit`    | `/audit`                               | Stays global             |
| `/pools`    | `/pools`                               | Stays global             |
| (new)       | `/onboard`                             | Add repo page            |
| (new)       | `/repos/[owner]/[repo]/settings`       | Repo config              |

### Implementation Notes

Existing pages in `web-ui/src/app/`:
- `pipeline/` — task list, task detail, task creation.
- `agents/` — agent list, agent detail, memory viewer.
- `context/` — CLAUDE.md viewer, ADR list, chunk browser.
- `specs/` — spec list, spec detail.
- `search/` — global search.
- `audit/` — audit log.
- `pools/` — shared pools.

The pipeline, agents, context, and specs pages currently fetch data
without a repo filter. Each will need a `repo` parameter added to
their data-fetching hooks or API calls.

## R4: GitHub App Repo List — Installation Repositories API

### Decision

Use the GitHub App installation repositories endpoint to populate the
"available repos" dropdown on the onboard page.

### API

```
GET /app/installations/{installation_id}/repositories
```

Returns all repos the GitHub App has been granted access to. This is
the authoritative list — if the App does not have access to a repo,
we cannot create branches or PRs on it.

### Implementation

Using octokit (already a dependency of `pipeline-github.ts`):

```typescript
const octokit = new Octokit({ auth: installationToken });
const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
  per_page: 100,
});
```

Filter out repos already in `lore.repos` to get the "available for
onboarding" list.

### Pagination

The endpoint returns up to 100 repos per page. For orgs with more
than 100 repos, iterate pages. Current re-cinq org has fewer than
100 repos, so pagination is not critical but should be implemented
for correctness.

### Authentication

The GitHub App (lore-agent, App ID GITHUB_APP_ID) authenticates as an
installation. The installation token is already managed by
`pipeline-github.ts`. Re-use that token generation logic.

### Constitution Alignment

- Principle 2 (Zero Stored Credentials): Installation tokens are
  short-lived (1 hour), generated via the App's private key which
  is stored as a K8s secret (injected via Workload Identity). No
  long-lived credentials stored.

## R5: Form Styling — Extend globals.css

### Decision

Extend the existing `web-ui/src/app/globals.css` with form-specific
styles. No new CSS framework, no CSS-in-JS, no Tailwind utility
classes.

### Alternatives Considered

**Option A: Add a component library (Radix, shadcn/ui).**
Rejected for now. The UI is small enough that custom CSS covers it.
A component library adds a dependency and a learning curve. Can be
revisited if the UI grows significantly.

**Option B: Tailwind utility classes on each element.**
Rejected. The existing codebase uses globals.css for theming. Mixing
Tailwind utilities with global CSS creates inconsistency. If Tailwind
is adopted, it should be a separate decision covering the whole UI.

**Option C: CSS Modules per component.**
Considered. CSS Modules would scope styles to components. However,
form styles should be consistent globally — scoping them defeats the
purpose. CSS Modules are better for component-specific layout, not
shared form styling.

**Option D: Extend globals.css (chosen).**
Add a `/* Forms */` section to `globals.css` with styles for:
- `input[type="text"]`, `input[type="email"]`, `input[type="url"]`
- `textarea`
- `select`
- `button`, `button.primary`, `button.secondary`
- `.form-group`, `.form-label`, `.form-error`
- Focus states: `:focus-visible` with accent color ring.
- Validation states: `.error` border color, `.error-message` text.
- Dark mode: all form styles respect the existing `@media (prefers-color-scheme: dark)` or theme variables.

### Current State

Existing `globals.css` has:
- CSS custom properties for colors/theming.
- Base layout styles.
- No form-specific styles — inputs are browser-default.

The fix is additive: no existing styles need to change.

# Definition of Done

> The web UI MUST provide a "Skills" management page so Organization Admins can manage skills dynamically. It provides options for models, titles, and SKILL.md content.

**Strategy: `direct`** — The test calls the new SkillsPage component directly to verify its behaviour; the red bar is CI's to show because the test runner requires a workspace install this pod cannot run.

## Done when these pass

- [ ] **Skills page supports listing, creating, editing, and deleting skills** — validates that the page renders the management interface and responds to CRUD interactions.
  `apps/web-ui/src/app/skills/page.acceptance.test.tsx`

## Facets

- [ ] Scaffold SkillsPage component.
- [ ] Implement skill list rendering using table.
- [ ] Implement skill creation form.
- [ ] Implement skill editing form.
- [ ] Implement skill deletion action.

## Out of scope

- Per-repo and per-developer skill overrides.
- Multi-file skills support.

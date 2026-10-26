# Definition of Done

> The web UI MUST provide a "Skills" management page so Organization Admins can manage skills dynamically. It provides options for models, titles, and SKILL.md content.

**Strategy: `direct`** — A seam exists via the target `apps/web-ui/src/app/skills/page.tsx` rendering and testing the forms.

## Done when these pass

- [ ] **Skills page lists org-level skill definitions fetched from the API with options to edit and delete** — the UI lists skills and provides edit/delete buttons
  `apps/web-ui/src/app/skills/page.acceptance.test.tsx`
- [ ] **Skill definitions offer options for setting models, titles, and content** — the form for creating or editing skills contains the required fields
  `apps/web-ui/src/app/skills/page.acceptance.test.tsx`

## Facets

- [x] Fetch skills from the `/api/skill-definitions` endpoint and render them in a list
- [x] Implement Create form with Name, Title, Model, Content fields and API submission
- [ ] Implement Edit form/modal that populates fields and saves changes via API
- [ ] Implement Delete action to remove a skill via API

## Out of scope

- Per-repo skill overrides
- Multi-file skills support

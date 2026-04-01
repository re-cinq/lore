# Phase 1: Setup & Discovery

- [ ] T001 [P] Analyze Lore UI codebase for responsive design patterns: `web-ui/src/pages`, `web-ui/src/components`, `web-ui/tailwind.config.js`
- [ ] T002 [P] Document current breakpoints and media queries in use: `web-ui/src/styles`, `web-ui/package.json` (check Tailwind config)
- [ ] T003 [P] Audit UI component library for mobile-unfriendly patterns: `web-ui/src/components`, identify fixed widths, horizontal scrolls, hover-only interactions
- [ ] T004 [P] Map viewport constraints from existing specs: `specs/lore-ui-design/`, check ADRs for design system decisions in `adrs/`
- [ ] T005 Create mobile device breakpoint specification: `specs/lore-ui-mobile/breakpoints.md` (document target devices: mobile 320px-480px, tablet 768px-1024px, desktop 1024px+)
- [ ] T006 Set up testing infrastructure for responsive design: `web-ui/vitest.config.ts`, `web-ui/__tests__/mobile/` directory

# Phase 2: Core Implementation

## Layout & Typography

- [ ] T007 [P] Make Lore UI header responsive (hamburger menu, collapsible nav): `web-ui/src/components/Header.tsx`, `web-ui/src/components/Navigation.tsx`
- [ ] T008 [P] Refactor main content grid for mobile stacking: `web-ui/src/layouts/MainLayout.tsx`, update Tailwind grid breakpoints from `md:` prefix
- [ ] T009 [P] Implement responsive typography scale: `web-ui/src/styles/globals.css`, adjust heading sizes for mobile (`text-xl` → `text-2xl` at `md:`)
- [ ] T010 [P] Make sidebar collapsible on mobile: `web-ui/src/components/Sidebar.tsx`, add toggle button on `< md` breakpoint

## Dashboard & Data Display

- [ ] T011 [P] Convert pipeline status table to mobile-friendly card layout: `web-ui/src/components/PipelineTable.tsx`, render as stacked cards below `md:` breakpoint
- [ ] T012 [P] Make repo list responsive (grid → single column on mobile): `web-ui/src/pages/repos.tsx`, `web-ui/src/components/RepoGrid.tsx`
- [ ] T013 [P] Refactor analytics dashboard for mobile (scrollable charts, compact cards): `web-ui/src/pages/analytics.tsx`, use `overflow-x-auto` with `snap-scroll` on mobile
- [ ] T014 [P] Make onboarding form vertical on mobile: `web-ui/src/components/OnboardForm.tsx`, stack form fields below `md:` breakpoint

## Forms & Interaction

- [ ] T015 [P] Increase touch target sizes for buttons/inputs on mobile: `web-ui/src/components/Button.tsx`, set min `h-12` (48px), add padding for mobile
- [ ] T016 [P] Replace hover-only interactions with tap-friendly alternatives: `web-ui/src/components/`, remove `:hover` CSS, use `:active` and `:focus-visible` for mobile
- [ ] T017 [P] Implement virtual keyboard handling: `web-ui/src/pages/settings.tsx`, prevent input focus from pushing layout (use `position: fixed` modals)
- [ ] T018 [P] Make date/time pickers mobile-friendly: `web-ui/src/components/DatePicker.tsx`, use native `<input type="date">` on mobile, custom widget on desktop

## Navigation & Workflows

- [ ] T019 [P] Implement mobile-friendly breadcrumb navigation: `web-ui/src/components/Breadcrumbs.tsx`, collapse to parent link only on mobile
- [ ] T020 [P] Create mobile-optimized task creation flow: `web-ui/src/pages/tasks/new.tsx`, use step-by-step wizard instead of single form
- [ ] T021 [P] Make modal dialogs mobile-safe (full screen on mobile): `web-ui/src/components/Modal.tsx`, set `w-full` and `h-screen` below `md:` breakpoint
- [ ] T022 [P] Optimize search/filter UX for mobile (collapsible filters): `web-ui/src/components/FilterPanel.tsx`, hide advanced filters behind toggle on mobile

## Images & Media

- [ ] T023 [P] Make logo/images responsive (scale down for mobile): `web-ui/src/components/Logo.tsx`, `web-ui/public/images/`, use `object-fit: contain` with max-width
- [ ] T024 [P] Implement responsive background images: `web-ui/src/pages/dashboard.tsx`, use `bg-cover` with `bg-center` for mobile, adjust image resolution

# Phase 3: Polish & Validation

## Accessibility & Performance

- [ ] T025 [P] Verify touch-friendly spacing (min 44x44px tap targets): `web-ui/src/components/`, audit all interactive elements with accessibility tool
- [ ] T026 [P] Test color contrast on mobile (readability at smaller sizes): `web-ui/src/styles/tailwind.config.js`, run contrast checker on text/background pairs
- [ ] T027 [P] Optimize images for mobile (reduce file size, responsive `srcset`): `web-ui/public/images/`, use next/image with mobile-optimized sizes
- [ ] T028 [P] Implement lazy loading for dashboard charts: `web-ui/src/components/Chart*.tsx`, use Suspense or intersection observer

## Testing

- [ ] T029 [P] Create mobile viewport Playwright tests: `web-ui/__tests__/e2e/mobile/`, test key flows at 375px, 768px, 1024px breakpoints
- [ ] T030 [P] Add visual regression tests for responsive layouts: `web-ui/__tests__/visual/`, use Percy or similar for mobile screenshot comparison
- [ ] T031 [P] Test on real devices (iOS Safari, Chrome Mobile): document results in `specs/lore-ui-mobile/testing-results.md`
- [ ] T032 [P] Performance audit on mobile (Lighthouse, Core Web Vitals): `web-ui/__tests__/performance/`, target 80+ score on mobile

## Documentation & Deployment

- [ ] T033 Write mobile design guide: `web-ui/docs/MOBILE_DESIGN.md`, document breakpoints, patterns, touch interactions, common pitfalls
- [ ] T034 Update responsive Tailwind config with custom utilities: `web-ui/tailwind.config.js`, add mobile-specific spacing/sizing scales
- [ ] T035 Create mobile feature flag (optional A/B testing): `web-ui/src/hooks/useMobileEnabled.ts`, allow gradual rollout
- [ ] T036 Document known mobile limitations: `specs/lore-ui-mobile/limitations.md`, list unsupported features and alternatives
- [ ] T037 Update CI/CD to run mobile tests: `.github/workflows/`, add mobile Playwright + Lighthouse to pull request checks
- [ ] T038 Merge responsive feature branch and deploy canary: create feature branch, test in staging, deploy to production with monitoring enabled

# Phase 4: Iteration & Feedback

- [ ] T039 [P] Collect mobile UX feedback from early users: `web-ui/src/hooks/useFeedback.ts`, add optional in-app survey on mobile
- [ ] T040 [P] Monitor mobile-specific error rates: set up dashboards in `k8s/monitoring/`, track crashes/slow loads on mobile
- [ ] T041 Create backlog for phase 2 improvements: `specs/lore-ui-mobile/backlog.md`, list advanced features (offline support, progressive web app, etc.)
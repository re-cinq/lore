# Lore UI Mobile Optimization - Task Breakdown

## Phase 1: Setup & Analysis

- [ ] T001 [P] Audit current Lore UI responsive behavior and identify desktop-only patterns in `web-ui/` | `web-ui/`
- [ ] T002 [P] Document current viewport assumptions and CSS breakpoints in use across Next.js components | `web-ui/`
- [ ] T003 [P] Set up mobile testing environment (viewport simulators, device testing plan) | `web-ui/`
- [ ] T004 [P] Create mobile design guidelines spec matching existing Lore UI design system | `specs/lore-ui-mobile-friendly/design-guidelines.md`
- [ ] T005 Analyze navigation patterns - identify sidebar/hamburger menu conversion needs | `web-ui/src/components/`
- [ ] T006 Identify all data-heavy components (tables, dashboards) needing mobile adaptations | `web-ui/src/components/`

## Phase 2: Core Implementation

### Navigation & Layout
- [ ] T007 [P] Convert fixed sidebar to responsive hamburger menu with mobile drawer | `web-ui/src/components/Sidebar.tsx`
- [ ] T008 [P] Add mobile-first CSS media queries for all layout components | `web-ui/src/styles/`
- [ ] T009 [P] Implement sticky mobile header with breadcrumb collapse on narrow viewports | `web-ui/src/components/Header.tsx`
- [ ] T010 Adjust spacing and padding for touch-friendly tap targets (44px minimum) | `web-ui/src/components/`

### Content & Tables
- [ ] T011 [P] Convert pipeline table to card-based layout on mobile (stacked view) | `web-ui/src/components/PipelineTable.tsx`
- [ ] T012 [P] Convert repo dashboard table to horizontally scrollable or collapsed view | `web-ui/src/components/RepoList.tsx`
- [ ] T013 [P] Create mobile-optimized analytics dashboard (simplified cards, no overflow charts) | `web-ui/src/pages/analytics.tsx`
- [ ] T014 [P] Implement collapsible sections for complex forms (onboarding, settings) | `web-ui/src/components/Forms/`
- [ ] T015 Optimize search results display for mobile screens | `web-ui/src/components/SearchResults.tsx`

### Forms & Inputs
- [ ] T016 [P] Make all form inputs mobile-friendly (larger text, no hover-required tooltips) | `web-ui/src/components/Forms/`
- [ ] T017 [P] Convert modal dialogs to bottom-sheet style on mobile | `web-ui/src/components/Modal.tsx`
- [ ] T018 Implement mobile-safe button sizing and spacing throughout | `web-ui/src/components/Button.tsx`

### Navigation Flow
- [ ] T019 [P] Update NextAuth authentication flow for mobile (handle OAuth redirects) | `web-ui/src/pages/api/auth/`
- [ ] T020 [P] Implement mobile-friendly repo/task filtering without cluttering interface | `web-ui/src/components/Filters.tsx`
- [ ] T021 Ensure all action buttons (create task, onboard, etc.) are mobile-accessible | `web-ui/src/components/ActionButtons/`

## Phase 3: Integration & Polish

### Testing & Validation
- [ ] T022 [P] Test navigation on iOS Safari and Android Chrome (min iOS 14, Android 10) | `web-ui/`
- [ ] T023 [P] Verify touch interactions (no hover states as required actions) | `web-ui/`
- [ ] T024 [P] Test form input with mobile keyboards (date pickers, text inputs) | `web-ui/src/components/Forms/`
- [ ] T025 [P] Validate image and asset loading on mobile connections (lazy loading) | `web-ui/public/`
- [ ] T026 Audit performance metrics on mobile (Core Web Vitals: LCP, FID, CLS) | `web-ui/`

### Polish & UX
- [ ] T027 [P] Add viewport meta tag and mobile-safe color schemes to `_document.tsx` | `web-ui/src/pages/_document.tsx`
- [ ] T028 [P] Implement safe area insets for notched devices and bottom nav areas | `web-ui/src/styles/globals.css`
- [ ] T029 [P] Create mobile-optimized onboarding flow (step-by-step vs. full page) | `web-ui/src/pages/onboard.tsx`
- [ ] T030 Add mobile-specific help text and tooltips for complex features | `web-ui/src/components/Help/`

### Documentation & Deployment
- [ ] T031 Document mobile-responsive patterns in `web-ui/README.md` for future components | `web-ui/README.md`
- [ ] T032 [P] Update GitHub Actions CI to include mobile viewport testing | `.github/workflows/web-ui-test.yml`
- [ ] T033 [P] Add Lighthouse mobile audit to CI pipeline (target score: 90+) | `.github/workflows/web-ui-test.yml`
- [ ] T034 Create mobile testing guide for QA/designers | `specs/lore-ui-mobile-friendly/testing-guide.md`
- [ ] T035 Deploy mobile-optimized Lore UI to staging and validate with real devices | `web-ui/`

### Monitoring
- [ ] T036 [P] Set up mobile-specific analytics in web UI (user agents, viewport sizes) | `web-ui/src/lib/analytics.ts`
- [ ] T037 Configure error tracking for mobile-specific failures (network timeouts) | `web-ui/src/lib/errorTracking.ts`
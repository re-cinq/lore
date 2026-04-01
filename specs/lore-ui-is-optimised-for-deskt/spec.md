# Feature Specification: Lore UI — Mobile-First Responsive Design

| Field             | Value                                      |
|-------------------|--------------------------------------------|
| Feature           | Mobile-Friendly Lore UI                    |
| Branch            | mobile-responsive-ui                       |
| Status            | Draft                                      |
| Created           | 2026-03-25                                 |
| Owner             | Platform Engineering                       |
| Phase 0 Target    | 2-3 working days (audit + component review)|
| Full Stack Target | 3-4 weeks                                  |

## Problem Statement

Lore UI (the dashboard at `lore.gcp.re-cinq.com`) is currently optimized
for desktop monitors. Product owners, platform engineers, and developers
who access the dashboard from mobile devices (phones, tablets) experience:

- Unreadable text and cramped layouts
- Broken navigation and button placement
- Non-functional or hidden interactive elements
- Tables that overflow without horizontal scroll or proper collapse
- Charts and analytics visualizations that don't reflow
- No touch-friendly interaction targets (buttons < 44px tap targets)
- Broken GitHub OAuth flow on mobile devices
- Long-form content (specs, memory, task details) not optimized for narrow viewports

This friction is particularly acute for:
- **On-call engineers** responding to incidents from phones (checking pipeline status, reviewing task failures)
- **Product owners** managing feature requests from mobile during meetings or travel
- **Developers** doing quick context lookups while away from desk (searching memory, checking repo status)

The result: users resort to desktop browsers or avoid the UI entirely, defeating the purpose of a central dashboard.

## Vision

Lore UI provides a seamless experience across all devices: desktop, tablet,
and mobile phone. On mobile, the interface:

- **Prioritizes information density** while remaining readable
- **Adapts layouts** intelligently (single-column on mobile, multi-column on desktop)
- **Simplifies navigation** with collapsible menus and mobile-friendly sidebar
- **Makes all interactive targets** at least 44×44px (iOS) / 48×48px (Android) for touch
- **Optimizes form inputs** for mobile keyboards (proper input types, autocomplete)
- **Preserves functionality** — all features available on mobile, nothing hidden
- **Loads fast** on mobile networks (lazy-load non-critical content, optimize bundle)
- **Handles offline** gracefully with cached state
- **Tests rigorously** against real devices and viewport sizes

From a phone, a developer can:
- Search the org's shared memory in < 2 seconds
- Check pipeline task status and see PR links
- View repo context summaries
- Create new tasks (simple form workflow)
- Navigate between repos and switch contexts

From a tablet, product managers can:
- Review onboarded repos and their status
- Browse analytics dashboard with readable charts
- Manage global settings
- Monitor scheduled jobs

## User Personas

### On-Call Engineer (Mobile, Time-Critical)

An engineer is on call and receives an incident alert while away from
the office. They pull out their phone and need to:
1. Check Lore for context on the affected service
2. See if there are any running tasks or recent PRs that might have caused it
3. Review incident runbooks if they exist
4. Create a task quickly if needed (e.g., "investigate database slowness")

Currently: they cannot use Lore UI on their phone. They call a colleague
at a desk or wait to get to a computer.

### Product Owner (Tablet, Asynchronous)

A PM is in a meeting or on the train and wants to check the status of
feature requests they created in Lore. They need to:
1. See which repos are onboarded
2. Check the pipeline dashboard — which tasks are done, pending, failed
3. Review analytics (cost, task volume)
4. Possibly create a new feature request task

Currently: they pull up a laptop or bookmark the desktop URL and squint
at their phone.

### Developer (Mobile, Quick Lookup)

A developer is at lunch and wants to search the org's shared memory for
a quick answer (e.g., "what's our convention for error handling in async functions?").
They should be able to open Lore UI, search, and get an answer in < 30 seconds.

Currently: the search UI is broken on mobile, or they wait until they're back at their desk.

## User Scenarios & Acceptance Criteria

### Scenario 1: On-Call Engineer Checks Service Context on Phone

**Actor:** On-call engineer  
**Device:** iPhone 14 (390px viewport width)  
**Network:** LTE (3G-like latency)

**Flow:**
1. Engineer opens Lore UI from their phone's bookmark
2. GitHub OAuth flow completes (no redirect loops, proper mobile flow)
3. Dashboard loads in < 3 seconds (with network latency)
4. Top navigation is visible and tappable
5. Engineer taps "Repos" or searches for the repo name
6. Repo page loads with critical info in the fold:
   - Repo name and description
   - Last commit / recent activity
   - Pipeline tasks (if any) affecting this repo
   - Link to context (CLAUDE.md)
7. Engineer taps a task to see status, PR link, and logs
8. Task details page is readable and scrollable
9. Engineer returns to search via back button or nav

**Acceptance Criteria:**
- GitHub OAuth completes without errors on mobile browsers
- Dashboard initial load < 3 seconds on Slow 3G (via DevTools)
- No horizontal scroll needed at 390px (iPhone SE)
- All buttons and links are >= 44px tall / wide (iOS)
- Text is readable without zoom (16px+ font baseline)
- Navigation menu collapses into hamburger on mobile
- Task details page is full-width and scrollable
- Images and charts scale responsively

### Scenario 2: Product Manager Reviews Analytics on Tablet

**Actor:** Product manager  
**Device:** iPad Air (834px viewport width)  
**Network:** WiFi

**Flow:**
1. PM opens the analytics dashboard in landscape orientation
2. Page loads with cost cards and charts visible
3. 7-day trend chart reflows to fill the tablet width
4. PM rotates device to portrait
5. Layout adapts: charts stack vertically, cards reflow to single column
6. PM taps a cost breakdown bar to drill down
7. Drill-down modal is readable and has close button visible
8. PM can scroll within the modal if needed

**Acceptance Criteria:**
- Charts and tables reflow correctly at 834px (landscape)
- Charts and tables reflow correctly at 512px (portrait)
- Animations and transitions are smooth (60fps on 2021+ tablets)
- Modals have >= 44px close buttons
- Data-heavy pages (analytics, pipeline list) have search/filter that works on tablet
- Text and numbers in charts are legible at tablet sizes

### Scenario 3: Developer Searches Org Memory from Phone

**Actor:** Developer  
**Device:** Android phone (360px viewport width)  
**Network:** Mobile 4G

**Flow:**
1. Developer opens Lore UI to the search page
2. Search input is visible and focused (keyboard appears)
3. Developer types a query (e.g., "UUID conventions")
4. Results load in < 2 seconds
5. Each result is tappable and shows preview
6. Developer taps a result to see full memory/fact
7. Memory detail page is readable, scrollable, shows related memories
8. Developer can modify or delete their own memory from this view

**Acceptance Criteria:**
- Search input is mobile-optimized (large, clear, autocomplete)
- Input type matches mobile keyboard (text, not just `<input type="text">`)
- Search results render as cards or list items (not a desktop table)
- Each result is tappable (>= 44px tap target)
- Nested memory views don't trap the user (clear back/close button)
- Search works with mobile keyboard (submit on return key)

### Scenario 4: Responsive Layouts Across Breakpoints

**Actor:** Designer / QA  
**Device:** Varies  

**Flow:**
1. Open Lore UI in browser DevTools
2. Test at: 320px, 375px, 390px (mobile), 768px, 834px (tablet), 1280px+ (desktop)
3. Verify no layout shift or horizontal scroll at any width
4. Verify all interactive elements are reachable and tappable
5. Verify text is readable without zoom

**Acceptance Criteria:**
- Mobile-first CSS using media queries (max-width: 640px, 768px, 1024px)
- No hardcoded pixel widths causing overflow
- Images use `max-width: 100%` and scale responsively
- Flexbox and grid layouts adapt to container width
- No horizontal scrollbar at any tested viewport
- Performance: no CLS (Cumulative Layout Shift) issues on resize

## Functional Requirements

### Mobile Layout & Navigation

1. **Responsive navigation**: Implement a hamburger menu (≤ 768px) that collapses the sidebar, leaving only a top bar with logo and hamburger icon
   - Hamburger button is >= 44px × 44px
   - Menu slides from left or appears as overlay
   - Clicking outside menu closes it
   - Current page is highlighted in menu

2. **Single-column layouts on mobile**: All pages reflow to a single column when viewport width < 640px
   - Desktop: sidebar (left) + main content (right)
   - Tablet: sidebar if space, else full-width main content
   - Mobile: full-width single column, sidebar hidden (hamburger)

3. **Collapsible sections**: Content that is verbose on desktop (e.g., repo metadata, task timeline) collapses to summary view on mobile, expandable via toggle
   - Heading + icon (▼/▶) is tappable
   - Expands to show full content
   - State persists during session (optional: localStorage)

4. **Sticky header on mobile**: Top bar remains visible while scrolling content
   - Logo / back button on left (20px)
   - Page title in center
   - Actions (search, settings) on right
   - Header is >= 56px tall (48px + 8px padding)

### Touch Targets & Interaction

5. **Minimum touch target sizes**: All clickable elements (buttons, links, form inputs) are >= 44px × 44px (iOS) / 48px × 48px (Android)
   - Buttons have >= 44px height or width (whichever is primary)
   - Form inputs have >= 48px height (including padding)
   - Links in body text can be inline, but have >= 44px padding around them

6. **Mobile-friendly form inputs**:
   - Email inputs use `type="email"` (shows @ on mobile keyboard)
   - Date inputs use `type="date"` (native picker on mobile)
   - Numbers use `type="number"` (numeric keyboard)
   - Searches use `type="search"` (includes clear button on iOS)
   - All inputs have visible labels (not placeholder-only)
   - Labels are clickable (associated via `<label for>`)

7. **Swipe-friendly interactions**: Optional swipe gestures for common actions (e.g., swipe-to-dismiss alerts, swipe-to-open menu)
   - Must have fallback buttons for accessibility
   - Gestures are intuitive and discoverable

### Responsive Content

8. **Data tables on mobile**: Tables with many columns are either:
   - Wrapped to stack rows vertically (1 header + 1 value per line)
   - Or scrollable horizontally with sticky first column
   - Or converted to card layout (one card per row)
   - Column actions (view, edit) are always visible and tappable

9. **Charts and visualizations**: Analytics charts reflow to fit viewport
   - Charts use SVG or Canvas (not fixed-size PNGs)
   - Chart legends stack vertically on mobile, horizontally on desktop
   - Tooltips appear on tap (not hover) on mobile
   - Chart axes and labels remain readable

10. **Images and media**: All images are responsive
    - Use `<picture>` with `srcset` for different resolutions
    - Images never exceed viewport width
    - Aspect ratios are preserved (use `aspect-ratio` CSS)
    - No forced scaling or cropping

11. **Lists and grids**: Content lists adapt to screen size
    - Desktop: 2-3 columns
    - Tablet: 1-2 columns
    - Mobile: 1 column
    - Use CSS Grid with `auto-fit` or `auto-fill` for reflow

### Mobile Performance

12. **Fast initial load on mobile**: First contentful paint < 2 seconds on Slow 3G
    - Lazy-load images and non-critical JS
    - Inline critical CSS
    - Defer non-critical scripts
    - Minify and compress all assets

13. **Bundle optimization**:
    - Main bundle <= 150 KB (gzipped)
    - Route-based code splitting for large pages
    - No blocking CSS or JS in `<head>`
    - Remove unused dependencies

14. **Offline support (optional Phase 1)**:
    - Cache critical pages (dashboard, search) via Service Worker
    - Show cached version if offline
    - Queue actions (create task, search) for sync when online
    - Indicate to user when offline

### iOS / Android Specifics

15. **iOS safe areas**: Respect safe areas for notched devices
    - Use `env(safe-area-inset-*)` in CSS
    - Place critical content outside safe-area-inset
    - Test on iPhone X+ (notch) and iPhone SE (no notch)

16. **Android back button**: Implement proper back navigation
    - Android back button returns to previous page, not previous site
    - Confirm before losing unsaved work
    - Do not trap users in a page

17. **Mobile keyboard handling**:
    - Inputs do not get covered by keyboard
    - Use `position: fixed` with proper z-index for sticky headers
    - Inputs scroll into view when focused
    - Dismiss keyboard when appropriate (e.g., after search submit)

### Accessibility on Mobile

18. **Touch-friendly contrast**: Text and interactive elements meet WCAG AA contrast (4.5:1) even on bright mobile screens
    - Test with high brightness
    - Use solid colors, not gradients that reduce contrast

19. **Readable font sizes**: No text < 16px (mobile baseline) without user zoom
    - Base font: 16px
    - Small text (captions, hints): 14px minimum
    - Headings: 24px+

20. **No hover-only interactions**: All functionality accessible via tap, not hover
    - Menus open on tap, not hover
    - Tooltips appear on tap (not hover)
    - Context menus are always available (not hidden behind hover)

## Non-Functional Requirements

### Performance

- **Lighthouse mobile score >= 85** on all core pages (dashboard, repos, search, analytics)
- **First Contentful Paint (FCP) < 2 seconds** on Slow 3G (DevTools throttling)
- **Largest Contentful Paint (LCP) < 3 seconds** on Slow 3G
- **Cumulative Layout Shift (CLS) < 0.1** (no jank when content loads)
- **Time to Interactive (TTI) < 4 seconds** on Slow 3G
- **Bundle size <= 150 KB gzipped** (main application bundle)
- **No layout thrashing**: Avoid repeated DOM reads/writes that cause reflows

### Browser Support

- **iOS Safari 14+** (iPhone 6S+)
- **Chrome/Edge 90+ on Android 9+**
- **Graceful degradation** for older devices (feature detection, fallbacks)

### Testing

- **Real device testing**: Test on at least 2 physical phones (iOS + Android) and 1 tablet before launch
- **Responsive testing in DevTools**: Validate at 320px, 375px, 390px, 768px, 834px, 1280px viewports
- **Orientation testing**: Portrait and landscape on phones and tablets
- **Network testing**: Slow 3G, Fast 3G, 4G via DevTools throttling
- **Touch device testing**: Verify all interactions work on actual touch screens (no hover-only)

### Accessibility

- **WCAG 2.1 AA compliance** for mobile (contrast, font sizes, touch targets)
- **Screen reader testing**: VoiceOver (iOS) and TalkBack (Android)
- **Keyboard navigation**: All functionality accessible via keyboard (even on mobile, with hardware keyboard)

### Observability

- **Mobile analytics**: Track page views, interactions, errors by device type (mobile/tablet/desktop)
- **Performance monitoring**: Capture FCP, LCP, CLS by device
- **Error tracking**: Distinguish mobile-specific errors (keyboard handling, touch, viewport) from general bugs
- **Usage tracking**: Monitor which pages are accessed from mobile vs desktop

## Out of Scope

- **Native iOS/Android apps**: This spec covers responsive web only, not native apps
- **Progressive Web App (PWA)** features: Offline support, installability (deferred to Phase 1)
- **Advanced gesture controls**: Pinch-to-zoom, long-press menus (tap + button fallback only)
- **Dark mode**: Mobile dark mode follows system preference but is not a new design (deferred to Phase 1)
- **Internationalization (i18n)**: Mobile i18n assumed to follow desktop i18n implementation (no new mobile-specific translations)
- **Email/SMS notifications**: Mobile push notifications out of scope (Web UI is dashboard only)
- **Mobile-specific features** not on desktop: All features on mobile are feature-parity with desktop (no mobile-only features)

## Key Entities

### Data Model (No Changes)

Mobile responsiveness is a **UI-only change**. No schema or data model changes required.

Existing entities remain unchanged:
- `repos` — repo registry
- `pipeline` — tasks and jobs
- `org_shared` — context (CLAUDE.md, ADRs, specs)
- `memory` — agent memory and facts
- `lore.settings` — global settings
- `analytics` — cost and usage tracking

### CSS Architecture

**Recommendation**: BEM + CSS custom properties for responsive design.

```css
/* Mobile-first: base styles are mobile (1 column, touch-friendly) */
.dashboard {
  display: flex;
  flex-direction: column;
}

/* Tablet and up: switch to two-column layout */
@media (min-width: 768px) {
  .dashboard {
    flex-direction: row;
  }
  .sidebar {
    width: 250px; /* hidden on mobile */
  }
}

/* Desktop and up: widen main content */
@media (min-width: 1280px) {
  .main-content {
    max-width: 1200px;
  }
}
```

Avoid:
- Fixed widths (e.g., `width: 800px`)
- Pixel-based breakpoints tied to specific devices
- CSS Grid with many explicit columns (use `auto-fit` instead)

## Success Criteria

### Measured Outcomes

1. **Mobile traffic increases** from current 5% → 20%+ within 2 weeks of launch
   - Tracked via Google Analytics by device type

2. **Mobile Lighthouse scores**:
   - Dashboard page: >= 85
   - Repo detail page: >= 85
   - Search page: >= 85
   - Analytics page: >= 85

3. **Mobile performance metrics**:
   - FCP < 2 seconds on Slow 3G
   - LCP < 3 seconds on Slow 3G
   - CLS < 0.1 on all devices

4. **Mobile usability**:
   - 0 accessibility issues (automated WCAG AA check via axe-core)
   - All buttons and links >= 44px tap targets
   - No horizontal scrolling at any tested viewport

5. **User feedback**:
   - 0 critical bugs reported on mobile within 1 week of launch
   - At least 2 internal team members report using Lore UI successfully on mobile
   - No regression in desktop usage metrics

6. **Code quality**:
   - All changes covered by responsive design tests
   - All new CSS passes responsive linter (e.g., `stylelint-config-rational-order`)
   - No build warnings

### Launch Readiness

Before shipping to production:
- [ ] Responsive design audit complete (all pages tested at 320px, 375px, 768px, 1280px)
- [ ] Performance optimizations merged (lazy-load, code-split, minify)
- [ ] Real device testing done on 2+ phones + 1 tablet
- [ ] Accessibility audit passed (WCAG AA)
- [ ] Mobile analytics instrumented
- [ ] Rollback plan in place (feature flag for old UI, if needed)
- [ ] Team trained on responsive design testing workflow

## Assumptions

1. **Design system already exists**: Lore UI uses a component library (Tailwind or similar). Responsive variants are already available on base components. This spec assumes adding responsive variants to page-level layouts, not redesigning atomic components.

2. **Next.js is responsive-ready**: The web-ui (Next.js 15) supports responsive patterns natively. Assumes `next/image` is used for responsive images, responsive CSS in modules.

3. **Analytics already instrumented**: Google Analytics or similar is already set up. This spec assumes adding device type and viewport tracking (low effort).

4. **Mobile users are internal first**: Initial launch targets Acme employees (on managed networks, modern devices). Public-facing mobile support (third-party developers) is Phase 2.

5. **Keyboard navigation exists**: Assumes the desktop UI already has keyboard navigation (tab order, focus states). Mobile extends this with touch equivalents.

6. **GitHub OAuth works on mobile**: Assumes the OAuth flow handles mobile redirects correctly (or will be fixed as a blocker).

7. **No new features during this sprint**: Responsive design requires focus. Assume feature freeze on the web-ui during this work.

8. **Budget for real device testing**: Assumes we can borrow or purchase 2-3 test devices for hands-on validation (cannot rely solely on DevTools simulation).

## Phase Breakdown

### Phase 0 (Audit) — 2 days
- Audit all existing pages in Lore UI
- Identify non-responsive components and layouts
- Document breakpoints and gaps
- List mobile blockers (e.g., OAuth, keyboard handling)

### Phase 1 (Core Pages) — 1.5 weeks
- Implement responsive CSS for top 5 pages (dashboard, repos, search, pipeline, analytics)
- Fix mobile blockers (OAuth, forms, navigation)
- Test on real devices
- Deploy with feature flag (optional rollback)

### Phase 2 (Remaining Pages + Performance) — 1 week
- Responsive CSS for remaining pages
- Lazy-load images, code-split large routes
- Reduce bundle size
- Optimize for Slow 3G

### Phase 3 (Offline + PWA, Deferred)
- Service Worker for offline support
- Installable as PWA
- Push notifications

## Rollout Plan

1. **Develop on a feature branch** (`mobile-responsive-ui`)
2. **Deploy to staging** with responsive design tests in CI
3. **Real device testing** on 2+ phones + 1 tablet (1 day)
4. **Launch to production** with feature flag (kill-switch if issues)
5. **Monitor mobile traffic and Lighthouse scores** for 1 week
6. **Gather user feedback** via analytics and surveys
7. **Remove feature flag** once stable

## Related ADRs / Specs

- ADR-XXXX: Mobile-first CSS strategy (new, to be written)
- ADR-XXXX: Bundle optimization for mobile (new, to be written)
- Existing: Analytics instrumentation (already done, just need device tracking)
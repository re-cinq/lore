# Feature Specification: Lore UI Mobile Responsiveness

| Field             | Value                                      |
|-------------------|--------------------------------------------|
| Feature           | Mobile-Friendly Lore Dashboard              |
| Branch            | mobile-responsiveness                      |
| Status            | Draft                                      |
| Created           | 2026-03-25                                 |
| Owner             | Platform Engineering                       |
| Phase 0 Target    | 2-3 working days (audit + design)          |
| Full Stack Target | 4-6 weeks                                  |

## Problem Statement

Lore's web UI (`web-ui/`) is currently optimized for desktop viewports (1920px+). Platform engineers, product managers, and developers frequently need to check pipeline status, view analytics, manage tasks, and monitor repo onboarding from mobile devices (phones, tablets) — during standups, incidents, travel, or while working from coffee shops. The current desktop-only UI forces them to either:

1. Load unreadable, unzoomed interfaces on small screens
2. Use mobile Chrome dev tools to simulate desktop (poor UX)
3. Defer checking task status until they return to a desk

This friction undermines the promise of "org awareness on demand" and reduces the visibility of agent work for teams operating asynchronously or on-call.

## Vision

The Lore dashboard adapts seamlessly from mobile (320px) through tablet (768px) to desktop (1920px+). Every user — whether checking pipeline status from their phone, reviewing analytics on a tablet, or deep-diving on a desktop — gets a purpose-built interface for their screen size. Navigation, task lists, charts, and forms all reflow intelligently. Mobile users see the most critical information first; desktop users get full context panels and advanced filtering.

## User Personas

### On-Call Engineer (Mobile-First)

Works from their phone during incidents. Needs to quickly see if a pipeline task failed, check the GitHub Issue link, and understand why. Cannot wait for desktop. Expects touch-friendly buttons, readable text, and minimal scrolling.

### Product Manager (Tablet)

Reviews task progress and analytics during meetings. Wants to show a chart or task list to stakeholders without pinching/zooming. Expects the UI to look presentable on iPad-sized screens.

### Platform Engineer (Multi-Device)

Develops and monitors Lore from Mac, iPad, and iPhone — sometimes switching between devices during the same session. Expects consistent navigation, preserved scroll position, and responsive charts that don't break on smaller screens.

### Developer (Triage from Phone)

Checks if their repo's onboarding task finished while away from desk. Wants to tap a GitHub link and see the PR, then continue work. Expects minimal data usage and fast load times.

## User Scenarios & Acceptance Criteria

### Scenario 1: On-Call Engineer Checks Pipeline Status (Phone, 375px)

**Actor:** On-Call Engineer  
**Device:** iPhone 14 (390px viewport)  
**Network:** LTE (4G)

**Flow:**
1. Engineer opens `lore.gcp.re-cinq.com` on iPhone
2. Page loads and renders in under 2 seconds
3. Navigation collapses to a hamburger menu (visible, tappable)
4. Pipeline page shows task list in a single column
5. Each task card displays: status badge, task type, repo name, estimated time ago, GitHub Issue link
6. Engineer taps a failed task
7. Modal opens showing task details: error message, PR link, cost, retry button
8. Engineer taps GitHub Issue link, navigates to GitHub in new tab
9. Returns to Lore; scroll position is preserved

**Acceptance Criteria:**
- Page loads in under 3 seconds (Core Web Vitals: LCP < 2.5s)
- Text is readable (font size ≥ 16px on mobile)
- All buttons/links are ≥ 44px tall (touch target minimum)
- No horizontal scrolling required
- Navigation is accessible via hamburger menu
- Task cards stack vertically, one per row
- Charts render as simplified versions (e.g., bar → single metric, line → step chart)
- Modal is fullscreen on mobile, no side-by-side panels
- Back button or close icon always visible and tappable
- Form inputs are auto-zoomed (font-size ≥ 16px triggers auto-zoom prevention)

### Scenario 2: Product Manager Reviews Analytics on iPad (Tablet, 810px)

**Actor:** Product Manager  
**Device:** iPad Air (810px viewport)  
**Network:** WiFi

**Flow:**
1. PM opens analytics dashboard on iPad in portrait orientation
2. Page renders in under 2 seconds
3. Cost overview cards appear in a 2-column grid (not 4)
4. Task summary and cost breakdown charts are displayed side-by-side (not stacked)
5. Daily cost trend chart shows simplified legend (bottom, not right)
6. PM rotates iPad to landscape (1080px)
7. Layout reflows: 3-column grid for cards, charts expand
8. PM taps a chart to see raw data table
9. Data table scrolls horizontally with sticky header (if needed)

**Acceptance Criteria:**
- Layout uses 2-column grid for tablet portrait (600px–900px)
- Layout uses 3-column grid for tablet landscape or small desktop (900px–1200px)
- Charts are readable at 600px+ width (axis labels not overlapping)
- Orientation change preserves scroll position where possible
- All interactive elements (buttons, chart clicks) work via touch
- Data tables have horizontal scroll with visible scrollbar (touch-friendly)
- No side-by-side text/data that requires pinch-to-zoom
- Tab navigation collapses on tablet portrait, expands on landscape/desktop

### Scenario 3: Developer Onboards Repo from Desktop (Laptop, 1920px)

**Actor:** Developer  
**Device:** MacBook Pro (1920px viewport)  
**Network:** Fiber

**Flow:**
1. Developer opens onboard page on desktop
2. Full two-column layout displays: left sidebar (repo list, filters), right panel (repo details, onboarding checklist)
3. Repo list shows pagination or infinite scroll
4. Developer selects a repo; right panel updates with status, files generated, pending PR
5. Developer scrolls through checklist; checked items remain visible via sticky positioning
6. Developer bookmarks the page; returns next session at same scroll position

**Acceptance Criteria:**
- Two-column layout visible at desktop sizes (≥ 1200px)
- Left sidebar is sticky (fixed) or has collapsible toggle
- Right panel has max-width (≤ 800px) to prevent line-length issues
- Pagination or infinite scroll handles large repo lists
- Sticky elements (header, sidebar) do not overlay content unexpectedly
- Scroll position is preserved via URL fragment or browser default
- Form fields use appropriate widths (e.g., text input not full-width if unnecessary)

### Scenario 4: Memory Tool Responsive (All Devices)

**Actor:** Developer using memory tools via dashboard  
**Devices:** Phone, tablet, desktop

**Flow:**
1. Developer navigates to memory management page
2. On mobile: single-column list of memories, each with title and delete button
3. On tablet: two-column layout (memory list left, preview right)
4. On desktop: three-column layout (list, preview, related facts)
5. Developer creates a new memory on phone; form is full-width with stacked inputs
6. On tablet: form is two-column (key on left, value on right)
7. On desktop: form is in a modal or right sidebar with max-width constraint

**Acceptance Criteria:**
- Mobile: single column, stacked inputs, full-width buttons
- Tablet: two-column layout, side-by-side inputs where sensible
- Desktop: three columns or modal, max-width constraints applied
- All button interactions work via touch without scroll interference
- List items are ≥ 44px tall for touch
- Delete confirmations use modals (not inline) to prevent accidental taps

## Functional Requirements

1. **Responsive Grid System**  
   Implement a CSS Grid or Tailwind-based responsive layout system with breakpoints:
   - Mobile: 320px–767px (single column, stacked layout)
   - Tablet: 768px–1199px (two-column, simplified charts)
   - Desktop: 1200px+ (multi-column, full features)

2. **Touch-Friendly Navigation**  
   - Header navigation collapses to hamburger menu (visible icon) below 768px
   - Hamburger menu is sticky (fixed) at top or slides in from left
   - All menu links are ≥ 44px tall with 8px padding
   - No hover-only menus; all menus accessible via tap

3. **Mobile-Optimized Forms**  
   - All input fields have font-size ≥ 16px (prevents auto-zoom on iOS)
   - Labels stack above inputs on mobile, align beside on desktop
   - Select dropdowns use native mobile picker on small screens (not custom UI)
   - Form buttons are full-width on mobile, max-width on desktop
   - Validation messages appear inline below fields, never in floating tooltips

4. **Responsive Charts**  
   - Charts render with reduced complexity on mobile (no legend, simplified axes)
   - Bar charts on desktop → compact bars on tablet → single metrics on mobile
   - Line charts → step charts or metric cards on mobile
   - Pie/doughnut charts → horizontal bar or metric cards on mobile
   - All charts have text labels (not just colors) for accessibility

5. **Readable Typography**  
   - Base font size ≥ 16px on mobile (default browser size)
   - Headings scale: h1 = 28px mobile, 36px desktop
   - Line length capped at 65 characters (no text wider than 800px)
   - Line spacing ≥ 1.5 on mobile, ≥ 1.6 on desktop

6. **Touch-Friendly Interactive Elements**  
   - All clickable elements (buttons, links, checkboxes) are ≥ 44px × 44px
   - Links have visible underline or color change (not just hover)
   - Buttons have active state (background color change, not outline only)
   - Tap feedback via active state visible within 100ms

7. **Modal & Overlay Responsiveness**  
   - Modals are fullscreen on mobile (top-to-bottom, left-to-right)
   - Modals are centered with max-width on tablet/desktop
   - Close button (X) always visible and ≥ 44px tall
   - Scrollable modal content within viewport (header/footer sticky)
   - Backdrop (dark overlay) present on all screen sizes

8. **Task List Responsiveness**  
   - Mobile: single-column list, each task = card with status, repo, timestamp, single action button
   - Tablet: two-column list or table (no overflow scroll)
   - Desktop: full data table with sorting, filtering, and multi-select
   - Inline actions on mobile trigger menu or modal; sidebar buttons on desktop

9. **Sidebar Responsiveness**  
   - Desktop: always-visible sidebar (left or right)
   - Tablet: sidebar appears on tap/toggle, overlays content or pushes it
   - Mobile: sidebar hidden by default, accessible via hamburger, overlays content
   - Sidebar width ≤ 30% of viewport (responsive narrower on small screens)

10. **Data Table Responsiveness**  
    - Mobile: convert table to card layout (one record per card, fields stacked)
    - Tablet: show subset of columns, horizontal scroll if needed (with sticky first column)
    - Desktop: full table with all columns, sorting and pagination
    - Sticky header always visible on scroll

11. **Image & Icon Responsiveness**  
    - Logo scales: 80px on mobile, 120px on desktop
    - Icons use SVG (not PNG) for crisp rendering at all sizes
    - All images have explicit aspect-ratio CSS (prevents layout shift)
    - Images on mobile are max-width: 100%; height: auto

12. **Performance on Mobile**  
    - Lazy-load below-the-fold content (images, charts)
    - Defer non-critical JavaScript (analytics, secondary features)
    - CSS critical path inlined in `<head>` (max 14KB)
    - Stylesheet split: critical mobile first, desktop enhancements in media query
    - Total bundle < 200KB gzipped (JS + CSS combined)

13. **Gesture Support** (Nice-to-have for Phase 2)  
    - Swipe left/right to navigate between task list items or pages
    - Pull-to-refresh on task list (mobile)
    - Long-press on task card to open context menu
    - Pinch-to-zoom on charts (if implemented)

14. **Print Stylesheet**  
    - Analytics dashboard prints legibly (one page or multi-page)
    - Task list prints with status and repo name (omit timestamps)
    - Charts render in grayscale

## Non-Functional Requirements

### Performance

1. **Core Web Vitals (Mobile Target)**
   - Largest Contentful Paint (LCP): < 2.5s (target: < 2.0s)
   - First Input Delay (FID): < 100ms (or Interaction to Next Paint (INP) < 200ms)
   - Cumulative Layout Shift (CLS): < 0.1

2. **Load Time Thresholds**
   - First paint: < 1.5s on LTE/4G
   - Interactive (TTI): < 3.5s on LTE/4G
   - Time to Byte (TTFB): < 500ms

3. **Asset Optimization**
   - JavaScript bundle: < 150KB gzipped
   - CSS bundle: < 50KB gzipped (critical inline)
   - Images: WebP with JPEG fallback, max 100KB per image
   - Fonts: system stack or single variable font (≤ 100KB)

4. **Runtime Performance**
   - Frame rate ≥ 60fps during scroll and animation
   - No layout thrashing (batch DOM reads/writes)
   - Memory footprint: < 50MB on mobile browsers
   - Long tasks: < 50ms (split into smaller tasks)

### Accessibility

1. **WCAG 2.1 Level AA Compliance**
   - Color contrast: 4.5:1 for text, 3:1 for large text
   - Touch targets: ≥ 44px × 44px
   - Keyboard navigation: all interactive elements reachable via Tab
   - Screen reader: semantic HTML, ARIA labels where needed

2. **Mobile-Specific Accessibility**
   - Tap targets spaced ≥ 8px apart (to prevent accidental taps)
   - No CAPTCHA on mobile (if possible)
   - Text resizing: support up to 200% zoom without horizontal scroll
   - Avoid auto-playing video/audio on mobile

3. **Responsive Accessibility**
   - Fonts remain readable at all zoom levels
   - Focus indicators visible and ≥ 2px wide
   - Color not the only indicator (use text labels, icons, etc.)

### Security

1. **No additional attack surface** from responsive code (same CSP, CORS, etc.)
2. **Input validation** applies on all screen sizes (no mobile bypass)
3. **Session timeout** applies on mobile (no persistent login across days)
4. **Sensitive data** not cached in localStorage longer than needed

### Browser Support

| Browser | Mobile | Tablet | Desktop |
|---------|--------|--------|---------|
| Chrome  | ≥ 90   | ≥ 90   | ≥ 90    |
| Safari  | ≥ 14   | ≥ 14   | ≥ 14    |
| Firefox | ≥ 88   | ≥ 88   | ≥ 88    |
| Edge    | ≥ 90   | ≥ 90   | ≥ 90    |

## Out of Scope

1. **Native Mobile Apps** — this spec covers web-only (responsive web app). Native iOS/Android apps are a future Phase 3 initiative.

2. **Offline Support** — no service worker or offline-first caching. Lore UI requires internet connectivity to fetch context and task status.

3. **Progressive Web App (PWA) Features** — no install-to-home-screen, no app shell, no offline queue. Basic responsive web only.

4. **Real-Time Collaboration** — no multi-user cursors, no live updates (e.g., if Engineer A claims a task, Engineer B's list doesn't auto-update). Polling-based refresh only.

5. **Animated Gestures & Interactions** — micro-interactions (bounce, spring, parallax) are not required. Focus on usability and touch-friendliness, not delight animations.

6. **Voice/Accessibility Features Beyond WCAG 2.1 AA** — no voice navigation, no AI-powered accessibility aids. Standard screen reader support only.

7. **Mobile-Specific Features** — no geolocation, no push notifications, no camera/microphone access. Lore is not a productivity app with mobile-first features.

8. **Tablet-Specific Optimizations Beyond Breakpoints** — no iPad-specific features (split view, drag-drop between apps). Tablet support means responsive web, not iPad-native.

9. **Dark Mode** — not required for Phase 0. Light mode only; dark mode is Phase 2+ if requested.

10. **Custom Mobile Navigation Patterns** — no bottom tab bar (iOS), no material design bottom nav (Android). Standard web header + hamburger menu.

11. **Optimization for Slow Networks** — Phase 0 targets 4G/LTE. EDGE/3G optimization is Phase 2+ if needed.

## Key Entities

No new data model changes required. Responsive design is a UI/frontend concern only. Existing data structures remain unchanged:

- `lore.repos` — still tracks repos (no mobile-specific schema)
- `lore.pipeline` — tasks and jobs (no mobile-specific fields)
- `lore.memory` — agent memory (no mobile-specific schema)
- `lore.settings` — global settings (no mobile-specific config yet)

Future: `lore.settings` may add `ui_theme`, `mobile_notifications_enabled` (Phase 2+).

## Success Criteria

### Measurable Outcomes

1. **Page Load Performance**
   - LCP < 2.5s on Moto G Power (Android, 4G) measured via Lighthouse
   - TTI < 3.5s on iPhone 11 (iOS, 4G) measured via Lighthouse
   - 90th percentile FID < 100ms on real user data (via Web Analytics)

2. **Mobile Traffic & Engagement**
   - Mobile users (< 768px) comprise ≥ 15% of total traffic within 4 weeks
   - Average session duration on mobile: ≥ 90 seconds (vs. current N/A)
   - Mobile bounce rate: < 40%
   - Mobile conversion rate (complete a task action): ≥ 10%

3. **Usability**
   - 95% of interactive elements are ≥ 44px tall and tappable
   - Zero horizontal scroll required on mobile (measured via heuristic scan)
   - All forms are completable on mobile without zooming (16px+ font)
   - Modal close button always visible (measured via screenshot analysis)

4. **Accessibility**
   - WCAG 2.1 AA score ≥ 90 on Lighthouse (mobile)
   - All pages keyboard-navigable (measured via tab order testing)
   - Screen reader announces all content correctly (VoiceOver, TalkBack spot-check)

5. **Adoption**
   - Platform engineers report using mobile dashboard for status checks (survey, N ≥ 5)
   - On-call engineers can view pipeline status in < 30 seconds on mobile (timed test)
   - No complaints about mobile usability in Slack/GitHub Issues within 2 weeks

6. **Business Metrics**
   - Cost per on-call incident triage reduced by ≥ 10% (fewer trips to desk)
   - Time to first PR check reduced by ≥ 20% (faster mobile access)
   - Mobile users mark 2+ tasks complete per week (engagement signal)

## Assumptions

1. **Existing Next.js + Tailwind Stack** — the web UI uses Next.js 15 and Tailwind CSS (inferred from README). Responsive design will extend existing Tailwind breakpoints, not introduce a new CSS framework.

2. **GitHub OAuth Still Works on Mobile** — NextAuth v4 GitHub OAuth flow should work on mobile browsers (same as desktop). No mobile-specific auth changes needed.

3. **No New Backend Work** — all endpoints are already mobile-compatible (JSON responses). No API changes required, only frontend CSS/layout changes.

4. **Fonts Already System or Web-Safe** — the current design uses web-safe fonts or a single web font. No need to load multiple font families for mobile.

5. **Charts Using a Responsive Library** — if using a charting library (e.g., Recharts, Chart.js), they already support responsive sizing. Minor config changes only (max width, simplified options on mobile).

6. **No Mobile-Specific Data Fetching** — developers expect the same data on mobile as desktop. No separate "mobile API" or reduced dataset. Just the same endpoints, different UI.

7. **LCP Bottleneck is JavaScript** — the primary performance issue is likely large JS bundles or slow route transitions (Next.js). CSS and HTML are small. Code-splitting and dynamic imports will likely unlock target LCP.

8. **Touch Device Availability** — engineers have smartphones and tablets for testing. Not relying on only desktop browsers for development.

9. **Existing Images Already Optimized** — logo and UI icons are SVG or already optimized PNGs. No need for image compression sprint.

10. **No Mobile-Only Features Will Be Added Yet** — Phase 0 is responsive parity only. No push notifications, no geolocation, no gesture-heavy interactions. Just the existing features, mobile-friendly.

11. **Browser Cache & CDN Already Configured** — Next.js deployment (likely Vercel or similar) already caches assets. No additional caching layer needed for mobile.

12. **Single Codebase** — maintaining one Next.js codebase with responsive CSS, not separate mobile/desktop versions.

13. **Team Size & Capacity** — assuming a 2–3 person frontend team can deliver Phase 0 (audit + design + implementation) in 4–6 weeks with focused effort.
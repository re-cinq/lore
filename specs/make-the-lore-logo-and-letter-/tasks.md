# Tasks for: Make the LORE logo and letter clickable to get back to /

## Phase 1: Setup
- [ ] T001 [P] Identify all logo and letter components in web-ui layout files (web-ui/src/app/layout.tsx, web-ui/src/components/Header.tsx, web-ui/src/components/Navigation.tsx)
- [ ] T002 [P] Review current routing structure and Next.js app directory setup in web-ui/src/app

## Phase 2: Core Implementation
- [ ] T003 Add onClick handler to logo SVG component in web-ui/src/components/Logo.tsx to navigate to root path using Next.js router
- [ ] T004 Add onClick handler to letter/text branding in web-ui/src/components/Header.tsx to navigate to root path
- [ ] T005 Ensure both elements have proper cursor styling (cursor-pointer, hover effects) in web-ui/src/styles or component styles
- [ ] T006 [P] Test navigation from nested routes (/pipeline/[id], /onboard, /analytics) back to root (/)

## Phase 3: Integration & Polish
- [ ] T007 Add keyboard accessibility: ensure clickable logo/letter is keyboard navigable and announces properly to screen readers
- [ ] T008 Verify logo/letter clickability works consistently across all pages in web-ui that display the header
- [ ] T009 Test on mobile viewports to ensure touch targets are adequate
- [ ] T010 Add unit tests in web-ui/__tests__/components/Header.test.tsx for logo/letter click navigation
- [ ] T011 Update web-ui README.md if there are navigation patterns documented that should reference this behavior
- [ ] T012 Manual QA: click logo/letter from each major route and confirm redirect to / with no console errors
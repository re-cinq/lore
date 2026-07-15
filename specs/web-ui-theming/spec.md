# Feature Specification: Web UI Theming (Elegant + Retro families)

| Field    | Value                                         |
|----------|-----------------------------------------------|
| Feature  | Web UI Theming                                |
| Branch   | improve-web-ui                                |
| Status   | Shipped                                       |
| Created  | 2026-05-29                                    |
| Owner    | Platform Engineering                          |
| Target   | 2-3 days                                       |

## Problem Statement

The `web-ui` had no theming. `globals.css` was a single dark-only stylesheet
with 8 CSS custom properties; the rest of its color and size values — and
~267 inline `style={{}}` blocks across pages — were hardcoded hex. There was
no light mode, no way to switch looks, and "icons" were bare unicode/emoji
glyphs (`✓ ⚠ ✗ ✏️ 🔧`). The look could not be changed without editing dozens
of files, and nothing followed the OS light/dark preference.

## Solution

A token-driven theming system with **two theme families**, each with
**light + dark variants and OS auto-switching**, its own font, and its own
icon set ([token parity per family](apps/web-ui/src/app/theme-tokens.test.ts#L59), [icon set per family](apps/web-ui/src/components/Icon.test.tsx#L58)). The current dark-only look is
replaced ([now light + dark per family](apps/web-ui/src/app/theme-tokens.test.ts#L59)).

- **Elegant** — Figma-like. `Inter` font, rounded corners, soft shadows, and a
  subtle frosted-glass feel (translucent + `backdrop-filter` blur) on elevated
  surfaces. Palette modeled on apple.com/mac (light `#f5f5f7`/`#1d1d1f`/`#0071e3`,
  dark `#000`/`#f5f5f7`/`#2997ff`). Icons: **Lucide**. ([validated by `Icon.test.tsx:33`](apps/web-ui/src/components/Icon.test.tsx#L33))
- **Retro** — Tokyo Night terminal (redesigned post-ship; originally an amber
  CRT). `GohuFont` bitmap body text + `IBM Plex Mono` headings/code, sharp
  corners, soft blue-grey text (`#c0caf5`) on `#1a1b26`, blue accent
  (`#7aa2f7`), accent-glow shadows; the light scheme is Tokyo Night Day.
  Icons: **Pixelarticons**. ([validated by `Icon.test.tsx:58`](apps/web-ui/src/components/Icon.test.tsx#L58), [validated by `renders the pixelarticons glyph for the retro family`](apps/web-ui/src/components/Icon.test.tsx#L46))

### Architecture

```
<html data-theme-family="elegant|retro" data-color-scheme="light|dark">
   ↑ set before first paint by an inline <script> (no FOUC)
   ↑ kept in sync by ThemeProvider (React context)

theme.css   → defines ALL tokens for 4 family×scheme combinations
globals.css → consumes tokens only (zero hardcoded color/size)
Icon.tsx    → renders Lucide (elegant) or Pixelarticons (retro) by family
```

Two independent axes, persisted separately in `localStorage`
(`lore-theme-family`, `lore-color-scheme`) ([family persists](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L216), [scheme persists](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L234)). The `auto` scheme resolves to
light/dark via `prefers-color-scheme` and updates live on OS change ([live flip to dark](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L269), [and back to light](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L294)). The
resolved scheme is what reaches the DOM, so CSS never matches `auto`, and an explicit `light`/`dark` scheme overrides the
OS preference ([auto resolves to dark](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L172), [and to light](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L186), [explicit scheme overrides OS](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L200)).

### What Changed

**New — `web-ui/src/lib/theme/`**
- `types.ts`, `theme-core.ts` — pure, unit-tested: `resolveColorScheme()`
  (an explicit `light`/`dark` pref wins over the system flag, `auto` follows
  it), `parseFamily()` / `parseSchemePref()` (pass valid values through, fall
  back to the default on garbage or `null`), storage-key + default constants. ([light pref wins](apps/web-ui/src/lib/theme/theme-core.test.ts#L12), [dark pref wins](apps/web-ui/src/lib/theme/theme-core.test.ts#L17), [auto follows system](apps/web-ui/src/lib/theme/theme-core.test.ts#L22), [parseFamily passthrough](apps/web-ui/src/lib/theme/theme-core.test.ts#L29), [parseFamily fallback](apps/web-ui/src/lib/theme/theme-core.test.ts#L34), [parseSchemePref passthrough](apps/web-ui/src/lib/theme/theme-core.test.ts#L41), [parseSchemePref fallback](apps/web-ui/src/lib/theme/theme-core.test.ts#L47))
- `theme-core.test.ts` — resolver/parser cases + icon-map key-parity test ([validated by `theme-core.test.ts:54`](apps/web-ui/src/lib/theme/theme-core.test.ts#L54)).
- `fonts.ts` — Inter + IBM Plex Mono (`next/font/google`) and self-hosted
  GohuFont (`next/font/local`) as CSS variables.
- `theme-script.ts` — `THEME_SCRIPT` blocking IIFE (FOUC prevention; also seeds
  `window.__loreFamily` so client icon render matches first paint). ([validated by `ThemeProvider.test.tsx:88`](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L88))
- `ThemeProvider.tsx` — context + `useTheme()`; reflects state→DOM; subscribes
  to the media query only while `auto`, tearing the listener down on unmount and
  when leaving `auto`, and re-subscribing on return to `auto`. ([subscribes while auto](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L269), [not otherwise](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L254), [unsubscribes on unmount](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L315), [re-subscribes on return to auto](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L337))

On mount the provider seeds the family from `window.__loreFamily`, falling back
to the `data-theme-family` attribute and then to the default `elegant`, and
seeds the scheme from `localStorage`, defaulting to `auto` when the stored value
is missing or unrecognized; it then writes both data attributes plus the
`window.__loreFamily` global to the DOM. ([family from attribute](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L103), [family default elegant](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L116), [scheme from localStorage](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L128), [scheme default auto](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L141), [writes attributes + global](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L156))

`useTheme()` throws a descriptive error when called outside a `ThemeProvider`. ([validated by `ThemeProvider.test.tsx:365`](apps/web-ui/src/lib/theme/ThemeProvider.test.tsx#L365))

**New — `web-ui/src/app/theme.css`** — the token source of truth ([validated by `theme-tokens.test.ts:59`](apps/web-ui/src/app/theme-tokens.test.ts#L59)). Family-level
blocks hold shape/type/glass tokens (`--radius*`, `--fs-*` type scale,
`--glass-blur`); four `[data-theme-family][data-color-scheme]` blocks hold
colors (`--bg*`, `--border*`, `--text*`, `--accent*`, status `--success/warning/
danger/info` + `-bg`, `--shadow*`, `--glass-bg/border`, `--color-scheme`).
`prefers-reduced-transparency` and a `@supports` fallback drop glass to opaque ([token blocks per family×scheme](apps/web-ui/src/app/theme-tokens.test.ts#L64)).

**New — `web-ui/src/components/`** — `icon-map.ts` (semantic `IconName` →
per-family Iconify name, offline via `@iconify-json/*`), `Icon.tsx`,
`ThemeSwitcher.tsx` (+ module CSS): a Family text toggle and a Light/Auto/Dark
square icon-only toggle, accessible radio groups ([both toggles](apps/web-ui/src/components/ThemeSwitcher.test.tsx#L38), [accessible radios](apps/web-ui/src/components/ThemeSwitcher.test.tsx#L59)). Mounted on `/settings` only.

**Edited** — `layout.tsx` (fonts on `<html>`, inline script, provider, import
`theme.css` before `globals.css`); `globals.css` fully tokenized (color, radius,
fonts, a new type scale, `.glass`, `.status-pill`); status-color maps + emoji
glyphs migrated to tokens + `<Icon>` in `PRStatusCard`, `PRStatusBadge`,
`Timeline`, `EnrollmentSection`, `AppShell`; every remaining hardcoded color and
font-size across ~20 pages and the two CSS modules (`HelpPopover`, `ReadmeBox`)
swapped to tokens.

The `ThemeSwitcher` maps each appearance option to its icon (sun / monitor / moon),
marks the active family label and the active appearance label as selected, and
calls `setFamily` / `setScheme` when one of the inactive radios is chosen. ([validated by `ThemeSwitcher.test.tsx:51`](apps/web-ui/src/components/ThemeSwitcher.test.tsx#L51), [`ThemeSwitcher.test.tsx:74`](apps/web-ui/src/components/ThemeSwitcher.test.tsx#L74), [`ThemeSwitcher.test.tsx:88`](apps/web-ui/src/components/ThemeSwitcher.test.tsx#L88), [`ThemeSwitcher.test.tsx:103`](apps/web-ui/src/components/ThemeSwitcher.test.tsx#L103), [`ThemeSwitcher.test.tsx:116`](apps/web-ui/src/components/ThemeSwitcher.test.tsx#L116), [`ThemeSwitcher.test.tsx:125`](apps/web-ui/src/components/ThemeSwitcher.test.tsx#L125), [`ThemeSwitcher.test.tsx:136`](apps/web-ui/src/components/ThemeSwitcher.test.tsx#L136))

The `Icon` component defaults its width and height to 16 when no size is given
(using the provided size for both otherwise), appends a custom `className`
alongside the iconify base classes (and none when omitted), exposes an
`aria-label` when one is passed (marking the glyph aria-hidden and label-less
otherwise), and applies the -0.125em baseline alignment only when `inline` is
set. ([validated by `Icon.test.tsx:69`](apps/web-ui/src/components/Icon.test.tsx#L69), [`Icon.test.tsx:76`](apps/web-ui/src/components/Icon.test.tsx#L76), [`Icon.test.tsx:87`](apps/web-ui/src/components/Icon.test.tsx#L87), [`Icon.test.tsx:96`](apps/web-ui/src/components/Icon.test.tsx#L96), [`Icon.test.tsx:107`](apps/web-ui/src/components/Icon.test.tsx#L107), [`Icon.test.tsx:117`](apps/web-ui/src/components/Icon.test.tsx#L117), [`Icon.test.tsx:127`](apps/web-ui/src/components/Icon.test.tsx#L127), [`Icon.test.tsx:135`](apps/web-ui/src/components/Icon.test.tsx#L135))

### Type Scale

`--fs-xs … --fs-xl` defined per family ([micro-label size per family](apps/web-ui/src/app/theme-tokens.test.ts#L86)). Retro pins every body size to 14px
because GohuFont is a bitmap crisp only at its native 14px grid; Elegant is
xs 12 / base 16 / xl 25 ([retro pins body sizes to 14px](apps/web-ui/src/app/theme-tokens.test.ts#L75)). No font-size literal remains in `src/`.

## Out of Scope

- Per-user server-side theme persistence (preference is device-local localStorage).
- A CRT scanline overlay (built then removed — hurt readability).

## Verification

- `npm test` — 30 tests pass (theme-core resolver/parsers + icon-map key parity). ([validated by `theme-core.test.ts:54`](apps/web-ui/src/lib/theme/theme-core.test.ts#L54))
- `npx tsc --noEmit` — clean. `npm run build` — succeeds; `/_not-found`
  prerenders static; `next/font` + Iconify offline registration compile.
- Regression greps return zero: no hex/`rgb()`/named-color literals and no
  `font-size` px in `*.tsx`/`*.module.css` outside `theme.css`/`globals.css`;
  no emoji glyphs remain.
- Manual matrix: all {elegant,retro} × {light,dark,auto} — no FOUC on reload,
  live OS dark-mode flip while `auto`, family switch changes font + corners +
  icon set, glass on elegant only.

## Amendments

- **2026-07-14 — drift fix + chart tokens.** Pages added after ship (the
  repo-centric nav and feature-planning UI, PR #798 era) reintroduced ~60
  hardcoded colors, ~20 px font sizes, phantom tokens whose fallbacks always
  won (`--warn-fg`, `--ok-fg`, `--color-*`, `--mono`), and three status
  glyphs (`✓ ✗ ⚠`). All re-tokenized / migrated to `<Icon>`. New
  `--chart-*` token group (spec-graph node types + neutral) — defined once at
  family level for Elegant, per scheme for Retro (Tokyo Night vs Day ANSI
  hues). `SpecGraphD3` resolves tokens to literals per render for canvas and
  `d3.interpolateRgb` (which cannot consume `var()`); SVG keeps raw `var()`
  references. The lifecycle palette in `feature-status.ts` now returns token
  strings. ([validated by `feature-status.test.ts:9`](apps/web-ui/src/app/repos/[owner]/[repo]/features/feature-status.test.ts#L9), [chart tokens per family](apps/web-ui/src/app/theme-tokens.test.ts#L64), [canvas literal resolution](apps/web-ui/src/lib/theme-token-resolve.test.ts#L23))

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
icon set. The current dark-only look is replaced.

- **Elegant** — Figma-like. `Inter` font, rounded corners, soft shadows, and a
  subtle frosted-glass feel (translucent + `backdrop-filter` blur) on elevated
  surfaces. Palette modeled on apple.com/mac (light `#f5f5f7`/`#1d1d1f`/`#0071e3`,
  dark `#000`/`#f5f5f7`/`#2997ff`). Icons: **Lucide**.
- **Retro** — Amber CRT terminal, after `watkinslabs/vscode-theme-generator`
  "amber_monitor". `VT323` font, sharp corners (radius 0), pale-amber text
  (`#fdffb6`) on warm near-black (`#141413`), amber accent (`#ff8000`),
  phosphor-glow shadows. Icons: **Pixelarticons**.

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
(`lore-theme-family`, `lore-color-scheme`). `scheme = auto` resolves to
light/dark via `prefers-color-scheme` and updates live on OS change. The
resolved scheme is what reaches the DOM, so CSS never matches `auto`.

### What Changed

**New — `web-ui/src/lib/theme/`**
- `types.ts`, `theme-core.ts` — pure, unit-tested: `resolveColorScheme()`,
  `parseFamily()`, `parseSchemePref()`, storage-key + default constants.
- `theme-core.test.ts` — resolver/parser cases + icon-map key-parity test.
- `fonts.ts` — `next/font/google` Inter + VT323 as CSS variables.
- `theme-script.ts` — `THEME_SCRIPT` blocking IIFE (FOUC prevention; also seeds
  `window.__loreFamily` so client icon render matches first paint).
- `ThemeProvider.tsx` — context + `useTheme()`; reflects state→DOM; subscribes
  to the media query only while `auto`.

**New — `web-ui/src/app/theme.css`** — the token source of truth. Family-level
blocks hold shape/type/glass tokens (`--radius*`, `--fs-*` type scale,
`--glass-blur`); four `[data-theme-family][data-color-scheme]` blocks hold
colors (`--bg*`, `--border*`, `--text*`, `--accent*`, status `--success/warning/
danger/info` + `-bg`, `--shadow*`, `--glass-bg/border`, `--color-scheme`).
`prefers-reduced-transparency` and a `@supports` fallback drop glass to opaque.

**New — `web-ui/src/components/`** — `icon-map.ts` (semantic `IconName` →
per-family Iconify name, offline via `@iconify-json/*`), `Icon.tsx`,
`ThemeSwitcher.tsx` (+ module CSS): a Family text toggle and a Light/Auto/Dark
square icon-only toggle, accessible radio groups. Mounted on `/settings` only.

**Edited** — `layout.tsx` (fonts on `<html>`, inline script, provider, import
`theme.css` before `globals.css`); `globals.css` fully tokenized (color, radius,
fonts, a new type scale, `.glass`, `.status-pill`); status-color maps + emoji
glyphs migrated to tokens + `<Icon>` in `PRStatusCard`, `PRStatusBadge`,
`Timeline`, `EnrollmentSection`, `AppShell`; every remaining hardcoded color and
font-size across ~20 pages and the two CSS modules (`HelpPopover`, `ReadmeBox`)
swapped to tokens.

### Type Scale

`--fs-xs … --fs-xl` defined per family. Retro is bumped (xs 15 / base 19 / xl 30)
because VT323 has a small x-height; Elegant is xs 12 / base 16 / xl 25. No
font-size literal remains in `src/`.

## Out of Scope

- Per-user server-side theme persistence (preference is device-local localStorage).
- A CRT scanline overlay (built then removed — hurt readability).

## Verification

- `npm test` — 30 tests pass (theme-core resolver/parsers + icon-map key parity). ([validated by `theme-core.test.ts:54`](web-ui/src/lib/theme/theme-core.test.ts#L54))
- `npx tsc --noEmit` — clean. `npm run build` — succeeds; `/_not-found`
  prerenders static; `next/font` + Iconify offline registration compile.
- Regression greps return zero: no hex/`rgb()`/named-color literals and no
  `font-size` px in `*.tsx`/`*.module.css` outside `theme.css`/`globals.css`;
  no emoji glyphs remain.
- Manual matrix: all {elegant,retro} × {light,dark,auto} — no FOUC on reload,
  live OS dark-mode flip while `auto`, family switch changes font + corners +
  icon set, glass on elegant only.

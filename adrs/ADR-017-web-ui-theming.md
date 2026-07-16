---
adr_number: 17
title: "Web UI theming — token-driven families (Elegant + Retro), light/dark/auto, per-family icon sets"
status: shipped
date: 2026-05-29
domains: [ux, web-ui]
---

# ADR-017: Web UI theming

Adds a two-axis token-driven theming system (Elegant/Retro families across light/dark/auto schemes) for the web UI, with a hand-rolled provider, a FOUC-preventing inline script, a single theme.css source of truth, and per-family icon sets.

## Context

The `web-ui` shipped a single dark-only `globals.css`: ~8 CSS custom
properties and, beyond them, hardcoded hex throughout the stylesheet plus
~267 inline `style={{}}` blocks across pages. There was no light mode, no
theme switching, no respect for the OS `prefers-color-scheme`, and "icons"
were bare unicode/emoji glyphs. Restyling meant editing dozens of files, and
the look could not vary per user.

We wanted two distinct, switchable looks — a clean Figma-like "Elegant" theme
and a vintage-terminal "Retro" theme — each with light and dark variants that
auto-follow the OS, each with its own font and its own icon set. The stack is
Next.js 15 (App Router) + React 19 with **no Tailwind, no CSS-in-JS, and no
icon library**.

## Decision

### 1. Two-axis token model on `<html>`

Two independent axes — `family ∈ {elegant, retro}` and
`scheme ∈ {light, dark, auto}` — applied as `data-theme-family` and
`data-color-scheme` attributes. `auto` is resolved to a concrete `light`/`dark`
**before** it reaches the DOM, so CSS only ever matches concrete schemes. Each
axis is persisted independently in `localStorage` (`lore-theme-family`,
`lore-color-scheme`). Defaults: `elegant` + `auto`.

### 2. Hand-rolled provider, not `next-themes`

`next-themes` models a single theme axis; two axes that can each be `auto`
would force us to re-implement scheme resolution anyway. A ~90-line typed
`ThemeProvider` + pure `theme-core.ts` (`resolveColorScheme`, `parseFamily`,
`parseSchemePref`) is smaller, fully typed to our unions, and unit-tested.

### 3. FOUC prevention via a blocking inline script

`THEME_SCRIPT` (a dependency-free IIFE) runs as the first child of `<body>`,
reads `localStorage`, resolves `auto` via `matchMedia`, and sets both `data-*`
attributes before first paint. It also stashes `window.__loreFamily` so the
client's first render seeds the same family and there is no icon swap. The
server renders no theme attributes, so mutating `documentElement` causes no
hydration mismatch.

### 4. `theme.css` is the single source of truth for color and size

All tokens live in `theme.css`, imported before `globals.css`. Family-level
blocks hold shape/type/glass tokens (`--radius*`, a `--fs-*` type scale,
`--glass-blur`); four `[data-theme-family][data-color-scheme]` blocks hold
colors (surfaces, borders, text, accent, status fg/bg, shadow, glass,
`--color-scheme`). `globals.css` and all components consume `var(--token)`
exclusively — **no hardcoded color or font-size remains in `src/`** outside
these two files. A repeated `.status-pill` class plus `.glass`
(`background: var(--glass-bg); backdrop-filter: var(--glass-blur)`) replace
scattered inline styling.

Palettes: **Elegant** after apple.com/mac (frosted glass via `backdrop-filter`);
**Retro** after `watkinslabs/vscode-theme-generator` "amber_monitor" (amber CRT,
sharp corners, phosphor-glow shadows). Fonts via `next/font/google`: Inter
(Elegant), VT323 (Retro). The Retro type scale is bumped because VT323 has a
small x-height. `prefers-reduced-transparency` and an `@supports` fallback make
glass opaque.

### 5. Per-family icon sets via one semantic abstraction

`<Icon name="check|warning|…"/>` maps a semantic `IconName` to a per-family
Iconify icon (`lucide:*` for Elegant, `pixelarticons:*` for Retro) and renders
the active family's set. Collections are registered **offline** from
`@iconify-json/lucide` + `@iconify-json/pixelarticons` (no network fetch under
`output: standalone`). A unit test asserts both families define the same icon
names. All prior emoji/unicode glyphs were replaced by `<Icon>`.

### 6. Switcher placement

The `ThemeSwitcher` lives only on `/settings` (Appearance section): a Family
text toggle and a Light/Auto/Dark square icon-only toggle, as accessible radio
groups. The preference is device-local (no server persistence).

## Consequences

- **Positive.** One file (`theme.css`) controls the entire look; adding a third
  family is a new attribute block + an icon-map column. Light/dark/auto and OS
  sync work everywhere with no per-component code. No FOUC, no hydration
  warnings. A grep-able invariant (no raw color/size in components) is
  enforceable in CI.
- **Negative / trade-offs.** Three new dependencies (`@iconify/react` +two icon
  JSON packages). Theme preference does not roam across devices. A custom
  provider is ours to maintain instead of `next-themes`. The full inline-style
  sweep touched ~24 files.
- **Rejected.** Introducing Tailwind (too large a migration); `next-themes`
  (single-axis); network-loaded Iconify (offline/standalone requirement); a CRT
  scanline overlay (built, then removed for readability).

## Verification

`npm test` (30 pass), `tsc --noEmit` clean, `npm run build` succeeds, and
regression greps confirm zero hardcoded colors, zero font-size literals, and no
emoji glyphs in `src/` outside the token files. See
`specs/web-ui-theming/spec.md`.

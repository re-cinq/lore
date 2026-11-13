---
name: prototype-ui
description: Sketch a screen, panel or control a plan adds or changes as one self-contained HTML fragment styled with the literal values of the repository's own frontend code, for the plan's Prototype section. Use when a plan changes what a person sees. No scripts, no external assets, light scheme, fits a 720 px column.
---

# Prototype: UI

A sketch of the changed screen that looks like the product, because it
is built from the product's own values. A person should be able to
say "yes, that" or "no, move it" without imagining anything.

## When to use

- The plan adds or changes a page, a panel, a dialog, a form, a
  button, a table or an empty state.
- Not for a terminal or a message: that is a text-output sketch.

## Method

1. **Find the screen.** Under /workspace/target, find the route or
   page the plan changes (search the plan's words and the page's
   visible headings), then the component that draws the part that
   changes, and the components around it.
2. **Find its styles.** The component's style module or classes, the
   global stylesheet, the theme or token files they read (CSS custom
   properties, SCSS variables, a Tailwind config, a design-token
   file).
3. **Resolve every value to a literal.** Follow each `var(--x)` or
   `$x` to its value for the light scheme (the `:root` value, not the
   dark-mode override). Write down the ones you use: background,
   surface, border, text, muted text, accent, danger; spacing steps;
   radius; font family, sizes and weights. The sketch runs in an
   isolated frame where the repository's variables do not exist, so a
   `var()` there draws nothing.
4. **Copy the real copy.** Labels, headings and button words come from
   the plan, or from the component when they stay. Never lorem ipsum.
5. **Write one fragment** (rules below) that shows the changed part
   inside enough of the page to place it: the section header above it,
   the neighbour beside it. Mark nothing as "new"; the plan says that.
6. **Measure the height.** Add up the content: rows, padding, gaps.
   Set `height` to that plus 16, so nothing scrolls and nothing floats
   in white space.

## Rules for the fragment

- One root `<div class="sketch">`, and the one `<style>` as its first
  child. A `<style>` outside the root is dropped by the sanitizer.
- Scope every selector under `.sketch`.
- `.sketch { width: 720px; }` or less: the plan column is about 720 px
  wide. Lay out with flex or grid, never absolute positions.
- Font: the app's own stack written out in full, ending in a system
  family (`system-ui, -apple-system, "Segoe UI", sans-serif`). No
  `@font-face`, no `@import`.
- No `<script>`, no `on…=` attribute, no `javascript:`, no `<link>`,
  `<iframe>`, `<img>`, `<object>` or `<base>`, no `url(` anywhere, no
  `http` address. The frame loads nothing and runs nothing.
- Icons are inline `<svg>` with a `viewBox`, a few paths, drawn with
  `currentColor`.
- Show states by drawing them: a hover or a disabled button is a
  second button beside the first with its label saying so.
- Real controls (`<button>`, `<input>`, `<select>`) are fine; they do
  nothing. Use `disabled` and `value` to show state.
- Keep it under 20,000 characters; the limit is 60,000.

`format: "html"`, `kind: "ui"`, id `m-ui-<n>`. A lone icon or a small
chart may be `format: "svg"`: markup that starts with `<svg`, a
`viewBox`, no script, no `foreignObject`; its `xmlns` attribute is
the one address allowed.

## Worked example

Caption: `Empty Prototype section with Generate prototype`.
Values read from the checkout: surface `#ffffff`, border `#e4e4e7`,
text `#18181b`, muted `#71717a`, accent `#4f46e5`, radius 8 px,
spacing 8/12/16 px, font `Inter, system-ui, sans-serif`.

```html
<div class="sketch">
<style>
.sketch { width: 680px; font: 14px/1.5 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: #18181b; }
.sketch .section { border: 1px solid #e4e4e7; border-radius: 8px; padding: 16px; background: #ffffff; }
.sketch h3 { margin: 0 0 12px; font-size: 16px; font-weight: 600; }
.sketch .hint { margin: 8px 0 0; color: #71717a; font-size: 13px; }
.sketch button { display: inline-flex; gap: 8px; align-items: center; padding: 6px 12px; border: 1px solid #4f46e5; border-radius: 8px; background: #ffffff; color: #4f46e5; font: inherit; }
</style>
<div class="section">
  <h3>Prototype</h3>
  <button><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v12M2 8h12"/></svg>Generate prototype</button>
  <p class="hint">The agent draws diagrams and screen sketches from this plan.</p>
</div>
</div>
```

Height 140.

## Help

<!-- lore-help:begin -->
**Summary.** Sketch a changed screen as one self-contained HTML fragment built from the literal style values of the repository's frontend.
**Usage:** `/prototype-ui`
**Use when.** A plan changes a page, panel, dialog, form or control and its Prototype section needs a screen sketch.
**Related:** `/prototype-text-output`, `/prototype-flows`
<!-- lore-help:end -->

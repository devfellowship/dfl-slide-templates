# dfl-slide-templates

A library of reusable slide templates for the DFL presentation engine. Each template is defined as a pair of Mustache HTML files (landscape and portrait), scoped CSS stylesheets, and a `config.yaml` slot schema.

---

## Directory structure

```
templates/
  <id>/
    config.yaml           # slot schema + metadata
    landscape.html        # Mustache HTML for 960×540 layout
    landscape.css         # CSS scoped to .tpl-root (landscape)
    portrait.html         # Mustache HTML for 540×960 layout
    portrait.css          # CSS scoped to .tpl-root (portrait)
    preview-landscape.png # auto-generated preview (do not edit by hand)
    preview-portrait.png  # auto-generated preview (do not edit by hand)
scripts/
  preview-gen.ts          # Playwright screenshot script
  lint-css.mjs            # CSS scoping + canvas + theme-token linter
  check-canvas.ts         # runtime guard: does .tpl-root fill the canvas?
  check-theme.ts          # runtime guard: is the slide on the DFL theme?
  canvas.config.json      # canonical design canvas + fluid-template allowlist
  theme.config.json       # theme contract: brand families, page surface, exceptions
themes/
  devfellowship.css       # the DFL Design System tokens (see "Theming" below)
  default.css             # legacy light theme (--slide-* aliases only)
registry.json             # master list of all templates
```

---

## config.yaml schema

```yaml
id: my-template          # kebab-case, matches directory name
name: My Template        # human-readable display name
version: "1.0.0"         # semver
category: content        # one of: content | layout | data | media
slots:
  - name: title          # camelCase slot name used as Mustache token
    type: text           # see slot types below
    required: true
    description: "Short description of the slot's purpose"
```

### Slot types

| Type       | Description                                      | Mustache usage               |
|------------|--------------------------------------------------|------------------------------|
| `text`     | Plain string                                     | `{{slotName}}`               |
| `richText` | HTML string (rendered unescaped)                 | `{{{slotName}}}`             |
| `image`    | Object with `imageUrl` and `imageAlt` properties | `{{imageUrl}}` / `{{imageAlt}}` |
| `items`    | Array of objects (each item has named fields)    | `{{#items}}…{{/items}}`      |
| `rows`     | Array of row objects (each has a `cells` array)  | `{{#rows}}…{{/rows}}`        |
| `data`     | Arbitrary JSON string                            | `{{slotName}}`               |

---

## HTML guidelines

- Wrap the entire template in `<div class="tpl-root tpl-<id>">`.
- Use `{{slotName}}` (double mustache) for plain text — HTML entities are escaped.
- Use `{{{slotName}}}` (triple mustache) for `richText` slots — HTML is rendered as-is.
- Use `{{#items}}…{{/items}}` and `{{#rows}}…{{/rows}}` for iterating arrays.
- Conditionally render optional slots with `{{#slotName}}…{{/slotName}}`.
- For image slots use `<img src="{{imageUrl}}" alt="{{imageAlt}}" />`.
- Do **not** include `<html>`, `<head>`, or `<body>` tags — the runtime wraps the fragment.

### Example (title template)

```html
<div class="tpl-root tpl-title">
  <div class="tpl-title__inner">
    <h1 class="tpl-title__heading">{{title}}</h1>
    {{#subtitle}}
    <p class="tpl-title__subtitle">{{subtitle}}</p>
    {{/subtitle}}
  </div>
</div>
```

---

## CSS guidelines

All CSS rules **must** be scoped under `.tpl-root`:

```css
/* Good */
.tpl-root.tpl-my-template .my-element { … }

/* Bad — bare selector, will leak into the page */
.my-element { … }
```

Additional rules enforced by the CSS linter (`npm run lint:css`):

- No `@layer` rules — layers are reserved for the host application.
- No `:host` pseudo-class — templates are not web components.
- Every selector must contain `.tpl-root`.
- The `.tpl-root` box must declare the canonical design canvas (see below).
- **No hardcoded colour or font-family** — every colour and type family comes
  from a theme token (see "Theming").
- Every `--s-*` / `--p-*` token a template reads must exist in the theme.

---

## Theming

`themes/devfellowship.css` is the CSS implementation of the DFL brand guide at
<https://brand.devfellowship.com> (machine-readable mirror: `/llms.txt`). It is
the **source of truth for how a slide looks** — templates read its tokens and
never restate its values.

| Need | Token |
|------|-------|
| Page background | `--s-surface-page` |
| Card / panel background | `--s-surface-panel`, `--s-surface-raised`, `--s-surface-elevated` |
| Text | `--s-ink-primary`, `--s-ink-secondary`, `--s-ink-muted`, `--s-ink-inverse` |
| Hairlines / dividers | `--s-border-subtle`, `--s-border-strong` |
| Accent (the only one) | `--s-brand-solid`, `--s-brand-fg`, `--s-brand-subtle`, `--s-brand-border` |
| State | `--s-success-*`, `--s-warning-*`, `--s-danger-*`, `--s-info-*` |
| Display type (h1/h2, ≥22px) | `--s-font-display` — Barlow Condensed |
| Body / UI type | `--s-font-body` — Inter |
| Meta / labels / data | `--s-font-mono` — JetBrains Mono |
| Long-form editorial | `--s-font-editorial` — Georgia |

Always keep the literal as the `var()` fallback so a template still renders
standalone:

```css
background:  var(--s-surface-page, #0a0908);
color:       var(--s-ink-secondary, #c9c0b4);
font-family: var(--s-font-display, 'Barlow Condensed', sans-serif);
```

Two rules that are easy to get wrong:

- **Never `background: transparent` on `.tpl-root`.** The host deck paints its
  own per-slide colour behind the slide; a transparent root leaks it. This is
  exactly how the `table` template shipped navy blue inside an otherwise
  near-black deck.
- **Never a bare `font-family`.** Restating `'Inter', system-ui, …` looks right
  today and silently stops following the brand tomorrow.

Both are enforced — statically by `npm run lint:css` (rules 5 and 6) and at
runtime by `npm run check:theme`, which renders every template over a hostile
magenta page and reads back the computed styles. Genuine exceptions go in
`scripts/theme.config.json` with a written rationale (today: `blank`, the
true-black recording backdrop).

### Viewport sizes

| Orientation | Width | Height |
|-------------|-------|--------|
| Landscape   | 960px | 540px  |
| Portrait    | 540px | 960px  |

Use absolute `px` dimensions on `.tpl-root` so screenshots are pixel-perfect.

---

## Adding a new template

1. Pick a unique kebab-case `id` (e.g. `my-new-template`).
2. Create `templates/my-new-template/`:
   - `config.yaml` — fill in `id`, `name`, `version`, `category`, and `slots`.
   - `landscape.html` / `portrait.html` — Mustache fragments.
   - `landscape.css` / `portrait.css` — scoped stylesheets.
3. Register the template in `registry.json`.
4. Add sample data for the preview script in `scripts/preview-gen.ts` (`SAMPLE_DATA` map).
5. Run `npm run preview` to generate preview images.
6. Run `npm run lint:css` to verify CSS scoping.
7. Commit everything including the generated `preview-*.png` files.

---

## Generating previews

```bash
npm install
npx playwright install --with-deps chromium
npm run preview
```

Preview images are saved as `templates/<id>/preview-landscape.png` and `templates/<id>/preview-portrait.png`.

---

## Checks

```bash
npm run lint:css      # static: scoping, @layer, :host, canvas, theme tokens
npm run check:canvas  # runtime: does .tpl-root fill 1280x720 / 720x1280?
npm run check:theme   # runtime: is the slide painted with the DFL theme?
```

Each invariant is guarded twice on purpose — once statically (fast, no browser)
and once at runtime against the real computed layout/styles, because a static
parse can be fooled by a later override, a transform or an inherited value.
All three exit 1 on failure and all three run in CI.

---

## CI

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and pull request to `main`:

- **lint-css** — runs the CSS scoping / canvas / theme-token linter.
- **preview-regen** — canvas-fill guard, theme-conformance guard, then
  regenerates all previews using Playwright.
  - On **pull requests**: fails if any preview image differs from what is committed (previews must be pre-generated locally).
  - On **push to main**: automatically commits regenerated previews if they changed.

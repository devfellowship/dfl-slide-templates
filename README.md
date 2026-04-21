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
  lint-css.mjs            # CSS scoping linter
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

## CSS lint

```bash
npm run lint:css
```

Checks all `templates/**/*.css` files for scoping violations, `@layer` usage, and `:host` usage. Exits with code 1 on any failure.

---

## CI

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and pull request to `main`:

- **lint-css** — runs the CSS scoping linter.
- **preview-regen** — regenerates all previews using Playwright.
  - On **pull requests**: fails if any preview image differs from what is committed (previews must be pre-generated locally).
  - On **push to main**: automatically commits regenerated previews if they changed.

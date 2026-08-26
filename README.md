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
  lint-css.mjs            # CSS scoping + canvas + theme-token/completeness linter
  check-canvas.ts         # runtime guard: does .tpl-root fill the canvas?
  check-theme.ts          # runtime guard: every template × every theme
  canvas.config.json      # canonical design canvas + fluid-template allowlist
  theme.config.json       # per-theme contract: brand families, forbidden colours, exceptions
themes/
  default.css             # complete LIGHT theme
  devfellowship.css       # the DFL Design System tokens (see "Theming" below)
  itera.css               # DFL sub-brand · evergreen accent
  revera.css              # DFL sub-brand · trust-blue accent
registry.json             # master list of all templates AND all themes
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

A theme is a **token-only** stylesheet at `themes/<id>.css`, scoped under
`.tpl-root`. It is the CSS implementation of a brand guide; templates read its
tokens and never restate its values. `themes/devfellowship.css` implements the
DFL guide at <https://brand.devfellowship.com> (machine-readable mirror:
`/llms.txt`) and is the house theme the previews render in.

### The themes are DATA, not a hardcoded list

`registry.json` carries a top-level `themes` array, and that array is the
**source of truth**:

```json
"themes": [
  { "id": "default",       "name": "Default",       "file": "themes/default.css",       "mode": "light" },
  { "id": "devfellowship", "name": "DevFellowship", "file": "themes/devfellowship.css", "mode": "dark" },
  { "id": "itera",         "name": "Itera",         "file": "themes/itera.css",         "mode": "dark" },
  { "id": "revera",        "name": "Revera",        "file": "themes/revera.css",        "mode": "dark" }
]
```

**Adding a theme is one entry here plus one CSS file — no application change.**
Consumers read the array instead of hardcoding ids; `dfl-lesson-studio` did
hardcode `['default','devfellowship']`, which is why two brands were
unreachable from its theme picker. `mode` is advisory for the host chrome
*around* the slide — the slide itself always paints its own surface from
`--s-surface-page`.

`npm run check:theme` renders every template in every theme listed here, so an
entry added without a complete stylesheet fails CI rather than shipping a
half-painted brand.

| id | mode | accent | guide |
|----|------|--------|-------|
| `default` | light | azure `#2563eb` | — (the neutral house-agnostic theme) |
| `devfellowship` | dark | amber `#E07A4A` | <https://brand.devfellowship.com> |
| `itera` | dark | evergreen `#3FD17F` | <https://brand.devfellowship.com/itera> |
| `revera` | dark | trust-blue `#3D8FE0` | <https://brand.devfellowship.com/revera> |

`itera` and `revera` are DFL sub-brands: they **inherit the DFL dark surfaces
and the DFL typography** and change only the accent, exactly as their guides
require ("Surface Itera nunca redefine `--bg`, `--panel` ou `--ink`"). Each
guide also names colours that must never appear on that brand's surface — DFL
amber on Itera, Itera green on Revera — and those lists are enforced, see
"Checks" below.

### The three-layer token architecture

| Need | Token |
|------|-------|
| Page background | `--s-surface-page` |
| Card / panel background | `--s-surface-panel`, `--s-surface-raised`, `--s-surface-elevated` |
| Text | `--s-ink-primary`, `--s-ink-secondary`, `--s-ink-muted`, `--s-ink-inverse` |
| Hairlines / dividers | `--s-border-subtle`, `--s-border-strong` |
| Accent (the only one) | `--s-brand-solid`, `--s-brand-fg`, `--s-brand-subtle`, `--s-brand-border` |
| State | `--s-success-*`, `--s-warning-*`, `--s-danger-*`, `--s-info-*` |
| Text over a PHOTOGRAPH | `--s-ink-on-media`, `--s-ink-on-media-muted`, `--s-brand-on-media` |
| Dotted page texture | `--s-texture-dot`, `--s-texture-dot-size` |
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

⚠️ **That fallback is load-bearing AND dangerous.** The literal is always the
DevFellowship value, so a token a theme forgets to define does not fail loudly
— the template quietly paints the DFL colour under your theme. That is not
hypothetical: until 2026-08-12 `themes/default.css` defined none of the
semantic tokens, and a deck set to "Default" rendered in DevFellowship dark
while every check passed. Hence rule 7 and the per-theme runtime sweep below:
**a theme must define every token any template reads.**

Use `--s-ink-on-media*` for text that sits over a photograph rather than over a
surface. A media scrim is dark in *every* theme (a photograph is not a themed
surface), so the ink over it stays light even on the light theme — reaching for
`--s-ink-primary` there paints a dark title on a dark photograph.

Three rules that are easy to get wrong:

- **Never `background: transparent` on `.tpl-root`.** The host deck paints its
  own per-slide colour behind the slide; a transparent root leaks it. This is
  exactly how the `table` template shipped navy blue inside an otherwise
  near-black deck.
- **Never a bare `font-family`.** Restating `'Inter', system-ui, …` looks right
  today and silently stops following the brand tomorrow.
- **Never a bare brand-tinted `rgba()`.** `rgba(224, 122, 74, 0.22)` is legal
  under the "translucent is a compositing value" exemption and still pins an
  amber hairline onto every brand. Use `--s-brand-subtle` / `--s-brand-border`
  / `--s-brand-ring`, or the `--s-success-*` / `--s-danger-*` tints.

All three are enforced — statically by `npm run lint:css` (rules 5, 6 and 7)
and at runtime by `npm run check:theme`, which renders every template in every
theme over a hostile magenta page and reads back the computed styles. Genuine
exceptions go in `scripts/theme.config.json` with a written rationale (today:
`blank`, the true-black recording backdrop).

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
     Give **every** slot a `sample:` value.
   - `landscape.html` / `portrait.html` — Mustache fragments.
   - `landscape.css` / `portrait.css` — scoped stylesheets.
   - `sample.json` — the data the preview and the guards render with.
3. Register the template in `registry.json`.
4. Run `npm run preview` to generate preview images.
5. Run `npm run lint:css` to verify CSS scoping.
6. Run `npm run check:canvas` and `npm run check:theme`.
7. Commit everything including the generated `preview-*.png` files.

### Where sample data lives, and why it is not in `scripts/`

`templates/<id>/sample.json` holds the Mustache data for one template — a JSON
object keyed by slot name. The resolution order in `scripts/render-page.ts` is:

1. `templates/<id>/sample.json`;
2. the per-slot `sample:` values in that template's `config.yaml`;
3. `{}`.

Each step is a fallback for a **missing** source, never a merge of two partial
ones. If `sample.json` exists it is the whole answer, even when it omits a
slot — so a template can render a slot deliberately empty. Step 2 and step 3
both print a `[sample]` line, so a template with no real sample source is
visible in the log instead of quietly blank.

Sample data used to live in `scripts/sample-data.ts`. That put it under the
human merge gate that protects `scripts/**`, so a template merged without a
human still had no sample data: every slot rendered empty, the committed
preview was blank, and `check:canvas` / `check:theme` passed against an empty
layout. Keeping the sample data next to the HTML and the CSS removes that
whole class of green-but-blank template.

---

## Adding a new theme

1. Copy `themes/devfellowship.css` to `themes/<id>.css` and change the values.
   Keep the block order — the files are meant to diff line-for-line.
2. Define **every** token in the contract. `npm run lint:css` prints the exact
   list of any you missed; there is no partial theme, only a theme that
   silently repaints part of DevFellowship.
3. Keep the three `.dfl-*` chassis rules, including `flex-shrink: 0` and
   `min-height: 1px` on `.dfl-section-rule` — templates emit those classes in
   their markup and only the theme styles them.
4. Keep the **deck-chrome block** at the foot of the file, unchanged. It is
   byte-identical in every theme file on purpose (see below); copy it, do not
   rewrite it.
5. Add one entry to `themes` in `registry.json`.
6. Add one `themes.<id>` entry to `scripts/theme.config.json` listing the
   colours forbidden on that brand, each with the guide sentence that says so.
7. `npm run lint:css && npm run check:theme`.

No application code changes. Consumers read the `themes` array.

### Deck chrome — a template must never emit it

The furniture around a slide — the kicker bar, the brand lockup, the social
handle, and the slide index `01/09` — is **deck-level, not slide-level**. The
render-view injects it and **derives** the index from `order_index` and the
sibling count, so inserting a slide renumbers the whole deck with no author
edit. That is ADR-7 of
[the plan](https://plans.devfellowship.com/20260822-branded-image-templates-deterministic-mcp).

| Class | What it is |
|---|---|
| `.dfl-deck-kicker` | The bar the other three sit in |
| `.dfl-deck-lockup` | The wordmark |
| `.dfl-deck-lockup-mark` | The wordmark's accent glyph — Itera's slash |
| `.dfl-deck-handle` | The `@handle` |
| `.dfl-deck-index` | The index wrapper |
| `.dfl-deck-index-current` / `-sep` / `-total` | `01` `/` `09` |

Two rules, both enforced by `npm run check:theme` (assertion 7):

- **No template may emit one of these classes.** `npm run preview` renders a
  template standalone, with no composition around it, so a template that
  printed its own index would bake a blank — or a wrong `01/01` — into its
  committed golden PNG.
- **The block is byte-identical in every theme file.** Geometry comes from the
  `--p-*` primitives, which every theme defines with the same numbers; colour
  and type come from `--s-*` semantics, which is what a brand redefines. So a
  theme swap changes colour and type and never geometry, and the guard compares
  the computed geometry across themes to keep it that way.

Because no template emits these classes, no other assertion in
`check-theme.ts` can see them: all four theme files could drop the block and
368 renders would still pass. Assertion 7 renders the documented markup
itself.

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
npm run lint:css      # static: scoping, @layer, :host, canvas, theme tokens, theme completeness
npm run check:canvas  # runtime: does .tpl-root fill 1280x720 / 720x1280?
npm run check:theme   # runtime: every template × EVERY theme (368 renders today)
```

Each invariant is guarded twice on purpose — once statically (fast, no browser)
and once at runtime against the real computed layout/styles, because a static
parse can be fooled by a later override, a transform or an inherited value.
All three exit 1 on failure and all three run in CI.

### What `check:theme` asserts

It renders **every template × every theme × both orientations** over a hostile
magenta page, then reads back computed styles. Per render:

1. **Surface** — `.tpl-root` is opaque and its background is *this* theme's
   `--s-surface-page`, read back from the injected CSS rather than hardcoded.
2. **Ink** — every text colour is a value *this* theme defines.
3. **Accent** — a template whose CSS reads `--s-brand-*` actually paints one of
   this theme's accent values, so an Itera render shows evergreen and a Revera
   render shows trust-blue.
4. **No cross-brand leak** — no rendered colour is in this theme's forbidden
   set. Accents are matched at any alpha (a tint is a palette entry); DFL dark
   surfaces are matched only when opaque, because a translucent scrim over a
   photograph is a compositing value and is correct in every theme.
5. **Fonts** — every text element resolves to one of the four brand families.
6. **Completeness** — every token any template reads resolves to a non-empty
   value. This is also the only check that catches a theme file a *browser*
   drops: write an asterisk-slash inside a CSS comment and the comment ends
   early, error-recovery swallows the whole `.tpl-root` block, and a textual
   token scan still finds every definition in the file.

Run one theme for a fast local loop: `npm run check:theme -- --theme itera`.

The forbidden sets and the exceptions live in `scripts/theme.config.json`, one
entry per theme, each with the sentence from the brand guide that justifies it.
`lint:css` fails if `registry.json` and `theme.config.json` disagree about which
themes exist, so a theme cannot be added to one and forgotten in the other.

---

## CI

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and pull request to `main`:

- **lint-css** — runs the CSS scoping / canvas / theme-token linter.
- **automerge-rules** — the merge gate's own regression suite
  (`npm run test:automerge`).
- **preview-regen** — canvas-fill guard, theme-conformance guard, then
  regenerates all previews using Playwright.
  - On **pull requests**: it re-renders every preview and **warns** when an image
    differs from the committed one, then uploads the regenerated set as the
    `regenerated-previews` artifact.
  - 🚨 **The drift step emits `::warning::` and exits 0. It is not a gate.** CI
    fonts and Chromium differ from a local render, so a real difference and a
    harmless one look the same today. Read a green `preview-regen` as "canvas
    fill and theme conformance passed", never as "the rasters match".

### Merge policy — a NEW template merges unattended

`.github/workflows/automerge-new-template.yml` merges a pull request with no
human when, and only when, the diff is confined to:

- a **new** `templates/<new-id>/**` directory — one that does not exist on
  `main` — where every file is `added`, **plus**
- that same template's own entry **appended** to the end of
  `registry.json[templates]`, with every pre-existing entry and every other
  top-level key unchanged.

Everything else stays human-gated, always: any change to an **existing**
`templates/<id>/**`, anything under `themes/**` or `scripts/**`,
`canvas.config.json`, `package.json`, `package-lock.json`, `.github/**`, any
deletion or rename, and any other `registry.json` edit. One bad merge to an
existing template changes every live deck that uses it; a new directory breaks
nothing that exists.

It also requires every `guard` line in the rule file to be green **on the head
SHA** — today the `Lint CSS scoping` job, the `Auto-merge rule engine` job, and
the `Check canvas fill` and `Check theme conformance` **steps** inside
`Canvas fill + previews`, each resolved by display name. A guard that cannot be
found is reported **absent**, and absent is not passing: renaming a CI step
refuses every auto-merge until the matching conf line is updated.

The rules are **data, not code**: they live in
[`.github/automerge-rules.conf`](.github/automerge-rules.conf) — globs,
invariants and guard names alike. The workflow holds no path knowledge and no
guard knowledge. The default is **deny** — a path that matches no rule does not
auto-merge.

⚠️ **Step 4 of "Adding a new template" costs you the unattended merge.**
`scripts/sample-data.ts` is human-gated, so a pull request that adds sample data
is merged by a human like any other `scripts/**` change. A template with no
sample data still passes every guard; its preview renders with empty slots. Ask
for a human merge, or land the template first and the sample data after.

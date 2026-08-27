# dfl-slide-templates

A library of reusable slide templates for the DFL presentation engine. Each template is defined as a pair of Mustache HTML files (landscape and portrait), scoped CSS stylesheets, and a `config.yaml` slot schema.

---

## Directory structure

```
templates/
  <id>/
    config.yaml                  # slot schema + metadata + `canvases:` (opt-in)
    landscape.html               # Mustache HTML for the 1280×720 canvas
    landscape.css                # CSS scoped to .tpl-root (landscape)
    portrait.html                # Mustache HTML for the 720×1280 canvas
    portrait.css                 # CSS scoped to .tpl-root (portrait)
    social-portrait.html         # OPTIONAL — 1080×1350 (4:5, Instagram post)
    social-portrait.css          # OPTIONAL — only if `canvases:` declares it
    preview-landscape.png        # auto-generated preview (do not edit by hand)
    preview-portrait.png         # auto-generated preview (do not edit by hand)
    preview-social-portrait.png  # auto-generated, only for declaring templates
scripts/
  preview-gen.ts          # Playwright screenshot script
  lint-css.mjs            # CSS scoping + canvas + theme-token/completeness linter
  check-canvas.ts         # runtime guard: does .tpl-root fill the canvas?
  check-theme.ts          # runtime guard: every template × every theme
  canvas.config.json      # the declared design canvases + fluid-template allowlist
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

## Design canvases

There are **three** canvases, declared in `scripts/canvas.config.json`:

| id | size | aspect | who declares it |
|---|---|---|---|
| `landscape` | 1280×720 | 16:9 | every template |
| `portrait` | 720×1280 | 9:16 | every template |
| `social-portrait` | 1080×1350 | 4:5 | **opt-in** — 9 templates today |

### The canvas is OPT-IN per template

A template declares which canvases it ships:

```yaml
canvases: [landscape, portrait, social-portrait]
```

**Omit the key and you get `[landscape, portrait]`** — the `defaultCanvases`
from `canvas.config.json`. That default is why adding a third canvas cost zero
edits to the 46 templates that pre-dated it. A mandatory third canvas would have
cost an HTML, a CSS and a golden PNG times 46, for a carousel that needs nine.

`lint:css` rule 8 checks both directions: a declared canvas must have its two
files, and a canvas-named file must be declared. A file nobody declares is not
harmless — the renderer REFUSES that canvas, so the CSS looks live and is not.

### An undeclared canvas ERRORS. It never falls back.

Requesting `social-portrait` on a template that does not declare it returns an
error and produces **no PNG**. There is no fallback to the nearest canvas, and
there must never be one: a fallback yields a real image at the wrong aspect
ratio, and nothing downstream can tell that from a correct render. It is not
blank, it does not error, it uploads fine — it just ships wrong.

This is enforced in three places, on purpose:
`buildHtmlPage` in `scripts/render-page.ts` (local guards),
`templateSourcesFor` in `dfl-lesson-studio` (the render-view, which sets
`__SLIDE_ERROR__` before the screenshot), and the zod schema on
`POST /capture/slide` in `dfl-render` (an id outside the contract, rejected 400).

### `social-portrait` is not a transpose, and that mattered

`portrait` is `landscape` transposed, and `dfl-lesson-studio` DERIVES it that
way rather than storing it. `lint-css.mjs` rule 0 used to assert that relation
for the whole config — so `1080×1350`, which transposes nothing, was rejected by
construction.

Rule 0 now asserts the two claims separately: **every** canvas has positive
integer dimensions, and the `landscape`/`portrait` **pair specifically** stays a
transpose. The pair list is data (`pairIsTransposed`), not an `if`. The pair
check was not weakened — it is the half that catches someone editing `portrait`
to `720×1440`.

### The canvas is a cross-repo contract with THREE copies

| repo | file | role |
|---|---|---|
| `dfl-slide-templates` | `scripts/canvas.config.json` | **leads** — a canvas lands here first |
| `dfl-lesson-studio` | `src/lib/utils/dimensions.ts` | blocking: `scripts/check-canvas-contract.mjs` |
| `dfl-services` | `services/dfl-render/src/lib/canvas.ts` | blocking: `src/lib/canvas-contract.test.ts` |

Exactly **one direction blocks**: a canvas this repo declares that a follower
does not know turns that follower red. The reverse only warns. Gating both
directions would deadlock the first half of every canvas change — neither repo
could merge first.

So a canvas change is an ordered three-PR sequence: land here, then
`dfl-lesson-studio`, then `dfl-services`. The followers are red in between, and
that is the correct state: the alarm sits on the side that can fix it in one
edit.

⚠️ `dfl-render` held its copy **outside** the contract until 2026-08-26 — a
private const with a comment for enforcement and nothing scanning it. That is
the `fleet-health` runtime-state failure class, and it is why `counterparts` is
now a list and why membership in it is itself asserted.

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
   - Optionally `canvases:` plus `<canvas>.html` / `<canvas>.css` for a third
     canvas — see "Design canvases" below. Omit the key and you get
     landscape + portrait, which is what 37 of the 46 templates do.
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
5. Add one entry to `themes` in `registry.json`. Publishing the theme over the
   studio MCP does this for you — see [The MCP write path](#the-mcp-write-path--publish-template).
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

## The MCP write path — `publish-template`

The `publish-template` edge function is the only automated writer into this
repository. `dfl-mcp-studio`'s `update_template` and `update_theme` call it with
a user JWT; it writes the files, edits `registry.json`, and opens a pull request.
Nothing reaches `main` without the merge gate.

📍 **Its source lives in
[`devfellowship/dfl-schema`](https://github.com/devfellowship/dfl-schema/tree/main/supabase/functions/publish-template),
not here.** It used to live in this repository under `supabase/functions/`, and
that was the bug: the running copy answers on the DFL prod Supabase project
(`yoojxnggaxcqtsyjdrdx`), and the only workflow in the fleet that deploys an edge
function to that project is `dfl-schema`'s `push-functions.yml`. This repository
has **no** deploy job at all. So the function was hand-deployed once and the two
copies drifted apart in silence — a fix could merge here, green, and change
nothing in production. It did: the merge-patch fix below merged on 2026-08-27 and
production kept destroying metadata until the function moved. Moved in
`dfl-schema` PR #889.

The sections that follow describe how that function behaves. They stay here
because this repository is what it writes into.

### The entry is a MERGE PATCH, not a replacement

Until 2026-08-27 the function did this:

```ts
if (idx >= 0) currentRegistry.templates[idx] = registryEntry   // full replace
```

`update_template` sends three fields — `id`, `version`, `category`.
`registry.json` is `$schema_version: 2` and carries **seven more** per template:
`name`, `when_to_use`, `avoid_when`, `media_profile`, `text_density`, `layout`,
`tags`. Those seven are exactly what `dfl-mcp-studio:rank.ts` scores on. So
bumping a version over MCP **erased a template's discoverability** and
`search_templates` stopped ranking it for its own phrase, and a template created
over MCP was **born unrankable**. Every guard stayed green, because no guard in
this repository reads that metadata. (Plan Gap 4 / risk 6.)

It now merges, and the contract is **RFC 7396 JSON Merge Patch**:

| the caller sends | what happens |
|---|---|
| the field is **omitted** | **preserved.** Silence is never a delete. |
| `"field": null` | **deleted.** Explicit, and visible in the request. |
| `"field": <value>` | replaced. Arrays replace wholesale; nested objects merge. |
| `"field": ""` | written as an empty string. `""` is a **value**, not a clear. |

Deletion stays expressible on purpose: a merge that can never remove anything is
its own bug, and a retired key would otherwise live in the source of truth with
no writer able to reach it. But deletion is never *unattended* — the
`registry-no-metadata-loss` invariant refuses any diff that drops or empties an
entry key, so an explicit `null` produces a pull request a human merges. The
writer decides what a write **means**; the gate decides what may **merge**.

### `update_theme` registers the theme

`update_theme` used to write `themes/<id>.css` and nothing else. `registry.json`
carries a `themes[]` array whose own `themes_doc` calls it the source of truth,
and `list_themes` reads it — so a theme published over MCP **did not appear in
the catalogue**. The same defect class, on the theme side.

A theme publish now always merges an entry into `themes[]`. `file` is **derived**
from the id, so it cannot disagree with the CSS path the same request writes.

⚠️ **A brand-new theme entry must carry `name` and `mode`, or the request is
refused with a 400.** This is the one deliberate behaviour change, and it is not
symmetric with templates. A template with no `when_to_use` is *degraded* — it
still lists, still renders, and ranks badly, so the function warns and writes. A
theme entry with no `name`/`mode` is *malformed* against the shape `themes_doc`
declares, and the only alternatives to refusing are to guess a company's display
name and to guess light vs dark. A wrong guess becomes the truth, and no later
call can tell it was a guess.

🚧 **And a brand-new theme still cannot land unattended**, for a reason outside
this function: `lint:css` fails when `registry.json` and
`scripts/theme.config.json` disagree about which themes exist, and `scripts/**`
is human-gated. A new theme therefore needs its forbidden-colour contract in the
same pull request. That is by design — see step 6 of *Adding a new theme*.

### Formatting and ordering are preserved

The document is edited as **text**, and only the span of the one entry being
written is replaced. So:

- unknown top-level keys and unknown keys in other entries survive, because they
  are never re-encoded — if `registry.json` grows a field neither side knows
  about, the merge keeps it;
- entry order never changes. An existing entry is rewritten in place; a new one
  is appended at the **end**, which `registry-single-append` requires;
- the hand-aligned `themes[]` block is not reformatted by a template write. The
  old `JSON.stringify(registry, null, 2)` exploded those four lines into
  twenty-four on **every** publish — a diff that touched an unrelated section to
  change one entry;
- a write that changes nothing produces a **byte-identical** file and no
  `registry.json` entry in the pull request at all.

`dfl-schema:supabase/functions/publish-template/registry-merge.test.ts` asserts
each of those, including the criterion-8 case from the plan run through **both**
the old writer and the new one, so the suite proves the defect instead of
describing it.

On **this** side, `npm run check:registry` asserts the half that suite cannot:
that the LIVE `registry.json` still holds the shape the writer and the ranker
depend on. `dfl-schema` can only test against a vendored snapshot of this file, so
a formatting drift or a lost `when_to_use` here would be invisible there. Both
are dependency-free `node`: the write path into this repository does not run
third-party code to be tested.

✅ **The function now deploys itself on merge.** `dfl-schema`'s
`push-functions.yml` derives what to deploy from the diff, so a change to
`supabase/functions/publish-template/**` there ships on merge with no manual step.
Until 2026-08-27 `supabase functions deploy publish-template` was a manual step
that nobody ran, which is why the merge-patch fix sat un-deployed.

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
npm run check:canvas  # runtime: does .tpl-root fill the canvas it was rendered at?
npm run check:theme   # runtime: every template × EVERY theme (368 renders today)
```

Each invariant is guarded twice on purpose — once statically (fast, no browser)
and once at runtime against the real computed layout/styles, because a static
parse can be fooled by a later override, a transform or an inherited value.
All three exit 1 on failure and all three run in CI.

### What `check:theme` asserts

It renders **every template × every theme × every canvas that template
declares** over a hostile
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
- **registry-shape** — the cross-repo contract check on `registry.json`
  (`npm run check:registry`): every template carries the fields
  `dfl-mcp-studio:rank.ts` ranks on, `templates[]` keeps the canonical
  formatting that `dfl-schema:publish-template` edits by offset, ids are unique,
  and the registry and the `templates/` + `themes/` directories agree. It
  replaces **registry-merge**, whose subject — the writer and its own suite —
  moved to `dfl-schema` with the function.
- **preview-regen** — canvas-fill guard, theme-conformance guard, then
  regenerates all previews using Playwright.
  - On **pull requests**: it re-renders every preview and **warns** when an image
    differs from the committed one, then uploads the regenerated set as the
    `regenerated-previews` artifact.
  - 🚨 **The drift step emits `::warning::` and exits 0. It is not a gate.** CI
    fonts and Chromium differ from a local render, so a real difference and a
    harmless one look the same today. Read a green `preview-regen` as "canvas
    fill and theme conformance passed", never as "the rasters match".

### Merge policy — auto-merge is the NORM, and the rule file is a deny-list

🚦 **This inverted on 2026-08-27.** Until then the gate was default-deny with one
hole — a brand-new `templates/<new-id>/**` directory — and everything else was
human-gated. Tainan decided the opposite:

> "It's ok to auto merge this here, why not?" — Tainan, 2026-08-27

The evidence he decided on is this repo's own CI. `lint:css`, `check:canvas` and
`check:theme` are **all blocking**, and `check:theme` renders **every template ×
every theme × every declared canvas** — 404 renders today — over a hostile
magenta page, then reads back the computed styles. A theme change or a CSS change
that breaks a template goes red **before** it can merge. Plan
[ADR-14](https://plans.devfellowship.com/20260822-branded-image-templates-deterministic-mcp).

The other half of the reason: the old `human|` lines were **not enforced**.
`pr-merge-sweeper` reads `skills/safe-admin-merge/protected_paths.conf`, where
this repo has no entry, and it merged CI-green claude-main pull requests every
~3 minutes regardless. On 2026-08-26 this gate refused PR #86 with
`rule=human-gated-path` and the sweeper merged it six minutes later. A rule
nobody enforces is worse than no rule: it reads as protection that is not there.

#### What still needs a human

`.github/workflows/automerge-new-template.yml` merges a pull request with no
human unless a changed path matches the **deny-list** in
[`.github/automerge-rules.conf`](.github/automerge-rules.conf):

| Path | Why a green CI proves nothing here |
|---|---|
| `scripts/**` | It **is** the determinism machinery. The guards run the **head** copy, so a pull request that weakens `lint-css.mjs` turns that guard green. CI structurally cannot catch it. |
| `.github/**` | The gate itself. It judges a pull request with the **base** copy of these files, so a weakened head conf would be applied unattended to the **next** pull request. |
| `package.json`, `package-lock.json`, `tsconfig.json` | They decide what every guard command actually runs, and which code it executes. |
| `canvas.config.json`, `scripts/canvas.config.json` | A cross-repo contract, and the counterpart check that catches a desync lives in the **other** repo. |
| `studio/**` | Deployed code with no test suite: Studio CI proves lint, typecheck and build only. |
| `supabase/**` | **Empty on purpose.** `publish-template` moved to `dfl-schema`, the only repository whose CI deploys to the DFL prod Supabase project. A `supabase/` path reappearing here is a second copy that nothing ships. |
| `renovate.json` | It configures what lands unattended, so auto-merging it is the same self-reference as auto-merging the gate. |
| `.gitignore` | It can hide a file from the diff, and a path that never appears is judged by no rule. |

⚠️ **These lines are enforced by THIS gate, not fleet-wide.** `pr-merge-sweeper`
does not read this file, so for a claude-main-authored pull request they are a
declaration this gate honours and the sweeper can still bypass. They are a real
brake for every other author, and they stop **this** gate from merging the guard
machinery unattended. Do not describe them as a guarantee.

**Everything else auto-merges** with green guards: `themes/**`, an edit to an
existing `templates/<id>/**`, `registry.json`, `README.md`, `showcase.html`, and
any new file shape.

#### To hold ONE pull request for review, label it `hold`

That is the `no-hold-label` invariant, and it is the per-PR review mechanism
ADR-14 leaves in place now that the path list is a deny-list. The label set is
the same one `pr-merge-sweeper` honours — `hold`, `do-not-merge`, `do_not_merge`,
`hold-for-review`, `no-merge`, `wip` — so **one label holds a pull request
against both**. Removing the label re-judges the pull request, because the
workflow also triggers on `unlabeled`.

#### The safety invariants — none of them was relaxed

ADR-14 relaxed **review** rules. It relaxed no safety rule. Every one of these
still refuses, in every change class:

- **`same-repo-head`** — this repository is **PUBLIC**, so a fork pull request is
  a stranger's code. Compared as full repo names. This is the most important line
  in the rule file and it may never be relaxed.
- **`author-has-write`** — read from the collaborator-permission API, never from
  the author name and never from `author_association`.
- **`not-draft`**, **`no-hold-label`** — the author's own declaration that the
  pull request is not ready.
- **`no-deletions`** — a deletion or a rename removes a path something live may
  read, and no guard here renders a file that is gone. This carries much more
  weight now that the path list is a deny-list.
- **`registry-no-metadata-loss`** — see below.
- **`guards-green`** — every `guard` line in the rule file must resolve to a
  successful job or step **on the head SHA**, and no other check run on that SHA
  may be failing or still running. Today: the `Lint CSS scoping` job, the
  `Auto-merge rule engine` job, and the `Check canvas fill` and
  `Check theme conformance` **steps** inside `Canvas fill + previews`, each
  resolved by display name. A guard that cannot be found is reported **absent**,
  and absent is not passing: renaming a CI step refuses every auto-merge until
  the matching conf line is updated.

#### Two change classes, and three invariants that are conditional

The gate classifies every diff before it judges it:

- **`new-template`** — at least one changed path sits inside `templates/<id>/`
  where `<id>` does **not** exist on the base commit.
- **`change`** — everything else.

`new-template-dir-only`, `registry-single-append` and `non-empty-sample-source`
apply to the **first class only**. They were never review requirements: they were
the *scope* of the old narrow hole, plus the structural rules that make a
brand-new template well-formed. A CSS fix to an existing template is judged by
none of them. A brand-new template is judged by all three:

- exactly **one** template directory, and it must be the new one, with every one
  of its files `added`;
- `registry.json` gains **exactly one** entry, **appended at the end**, whose id
  is the new template's, with every pre-existing entry and every other top-level
  key unchanged;
- the template ships a non-empty sample source.

🚨 **A mixed diff still refuses.** A pull request that adds a new template **and**
touches an existing one is in the `new-template` class, so `new-template-dir-only`
refuses it. Without that, a new template could dodge the other two invariants
simply by touching a second directory. Split the pull request.

Every verdict names the class and says explicitly which invariants were `n/a`, so
a class-scoped skip can never be read as a check that passed.

#### `registry.json` may be edited now — and `registry-no-metadata-loss` guards it

`registry.json` is served live by the studio MCP and by `dfl-lesson-studio`. CI
already covers the parts that break a render: `check:theme` fails when
`templates/` and `registry.json` disagree about which templates exist, and
`lint:css` fails when `registry.json` and `scripts/theme.config.json` disagree
about which themes exist.

What no guard sees is the **discoverability metadata** — `when_to_use`,
`avoid_when`, `tags`. Drop those and all four guards stay green while
`search_templates` silently stops ranking the template for its own phrase.
`update_template` does exactly that today. So the gate refuses any diff that
makes an entry, an entry key or a top-level key **disappear or become empty**. A
*changed* value is allowed: a version bump is legitimate and is visible in the
diff.

#### The rules are data, not code

Globs, invariants and guard names all live in
[`.github/automerge-rules.conf`](.github/automerge-rules.conf). The workflow
holds no path knowledge and no guard knowledge, so a renamed CI step or a new
exception is a **one-line change** to that file.

The conf **fails closed in both directions**. The gate refuses if the file is
missing, unparseable, lists an invariant the decider does not implement, or
**omits one it does**. Deleting an `invariant` line to relax the gate does not
relax it — it breaks it.

The default is now **allow**, expressed as one `automerge|**` line. The old
default-deny refusal (`rule=unlisted-path`) is still implemented and still fires
the moment somebody narrows that catch-all, which is what makes narrowing the
file a safe operation and widening it the one that needs an argument.

#### Every rule has a test, and that property is itself tested

`npm run test:automerge` runs the gate's own suite (`Auto-merge rule engine` in
CI, and again inside the gate job before it decides). Two meta-checks make the
discipline mechanical rather than a matter of review: every invariant the decider
implements must appear as the expected rule of at least one **BLOCK** case, and
every `human|` glob in the conf must be proven to refuse. Add a rule without a
test and the suite goes red naming the rule.

✅ **A new template ships its own sample data, and keeps the unattended merge.**
Sample data lives at `templates/<id>/sample.json` — inside the very directory the
gate auto-merges — so nothing about adding a template reaches the human-gated
`scripts/**` any more. It used to: the source was `scripts/sample-data.ts`, and
adding an entry there pulled the whole pull request under the human gate.

🚨 **A new template must ship a NON-EMPTY sample source, or it does not merge.**
The `non-empty-sample-source` invariant refuses a new template unless
`templates/<id>/sample.json` holds at least one key, **or** at least one slot in
`templates/<id>/config.yaml` carries a `sample:` value. With neither, Mustache
fills every slot with the empty string: the committed preview is blank, and
`check:canvas` / `check:theme` pass against an empty layout — green, and proving
nothing about a populated render. A blank template merging unattended is worse
than one that is blocked. Three details follow from how the renderer reads it:

- A **present** `sample.json` is the whole answer at render time, never merged
  with `config.yaml`. So an **empty** `sample.json` is refused even when every
  slot in `config.yaml` carries a `sample:` value.
- **One exemption:** a `config.yaml` whose `slots:` is empty declares nothing to
  fill, so it needs no sample. That is `templates/blank/`, which ships no
  `sample.json` on purpose.
- The gate **fails closed.** A sample source it cannot read or cannot parse is a
  refusal, never a pass.

#### What nobody guards, now that more merges unattended

Two honest costs of ADR-14, recorded here rather than discovered later:

- **A theme can be token-correct and off-brand.** Verification criterion 5 of the
  plan — "the theme matches its brand guide" — has **no tool**. `lint:css` bans
  four specific hexes per theme and asserts token completeness; nothing diffs a
  theme against `brand.devfellowship.com`. So a theme change that is
  token-complete, renders green across 404 renders and paints an **off-brand**
  colour now merges unattended. The fix is that checker, not a human gate the
  sweeper bypasses anyway.
- **A preview raster can drift for a bad reason.** The `Check for preview drift`
  step emits `::warning::` and exits 0, so it is deliberately **not** a guard. The
  old gate was scoped to a **new** directory, which has no approved raster to
  drift from, so this cost nothing. An **edit** to an existing template now
  auto-merges. The fix is the three-step sequence in plan criterion 2: vendor the
  sample images, build the cross-engine diff, then flip the step to blocking.

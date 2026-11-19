# Overlay components

An **overlay component** is a small HTML box (a call-out, a chip, a lower third)
that Lesson Studio places over a slide or a video for a time window. It is not a
slide: it does not fill the canvas, and the page behind it is transparent. The
style is locked in the component. An author or an agent changes only the slot
values (text, an option, an image URL).

Plan: [`20261119-lesson-studio-overlay-components`](https://plans.devfellowship.com/20261119-lesson-studio-overlay-components)
(ADR-1 Git, ADR-2 no script, ADR-6 generated contract).

## Directory

```
components/
  <id>/
    config.yaml          # metadata, box, anchors, window, slots (you write it)
    component.html       # Mustache HTML, one .tpl-root
    component.css        # CSS scoped under .tpl-root, theme tokens only
    sample.json          # optional: slot values for the previews and the guards
    schema.json          # GENERATED from config.yaml, never edit by hand
    preview-<theme>.png  # optional: one preview per theme
```

A component directory holds these files only. Any other file (a `.js`, an
`.svg`, a symlink, a subdirectory) fails CI. Every component also needs an entry
in the `components` array of `registry.json` (`id`, `version`, `name`,
`when_to_use`, `avoid_when`, `tags`). It never goes in `templates`, so no slide
picker lists it.

Test fixtures live in `fixtures/components/<id>/`, with the same format. They
are not in `registry.json`. CI runs every guard on them too, so a guard never
passes on an empty set.

## config.yaml

```yaml
id: callout                # kebab-case, equals the directory name
name: Call-out
version: "1.0.0"           # quoted semver
kind: component            # required; marks the file as a component
description: "One line."   # optional
box: { width: 640, height: 120 }   # design pixels on the 1920x1080 canvas
anchors: [bottom-left, bottom-right, lower-third]
default_anchor: bottom-left
duration_ms: 4000          # default window length (500..600000)
slots:
  - name: type
    type: select
    options: [conceito, ferramenta, ia, giria, codigo, noticia]
    default: conceito
  - name: term
    type: text
    required: true
    max_length: 40
    max_words: 3
  - name: image
    type: image
```

- **Anchors:** `bottom-left`, `bottom-right`, `top-left`, `top-right`,
  `lower-third`. A portrait canvas scales the box.
- **Unknown keys fail.** A key that no consumer enforces must not slip in.

### Slot types (the only three)

| Type | Value | Rules |
|---|---|---|
| `text` | a string | `max_length` (required, 1..500); `max_words` (optional) |
| `select` | one of `options` | each option matches `^[a-z][a-z0-9_]*$`; optional `default` |
| `image` | an https URL | host on the DFL media allowlist: `*.devfellowship.com`, `*.supabase.co`, `*.s3.amazonaws.com`; no port, no userinfo |

There is no `richText`, `json` or `items` in a component (ADR-2: fewer types,
less attack surface). Each slot may carry `required`, `description` and
`sample`.

### The Mustache view

Every renderer builds the same view (`componentView` in
`scripts/component-format.mjs`):

- the slot values;
- for a `select` slot with no value, its `default`;
- for a `select` slot `x` with value `v`, the flag `x__v: true`, so the HTML
  picks an icon per option with plain sections:
  `{{#type__ia}}<svg>…</svg>{{/type__ia}}`.

## schema.json — the slot contract

`npm run gen:component-schema` writes `schema.json` (JSON Schema draft-07) from
`config.yaml`. CI runs `npm run check:component-schema` and fails when the
committed file differs. Studio, the studio MCP tools and the `long-tutorial`
skill read this file, pinned to a commit SHA.

Each property carries `x-dfl-slot-type`. The root carries `x-dfl-component`
(`id`, `version`, `box`, `anchors`, `default_anchor`, `duration_ms`,
`view_flags`).

## Safety rules (`npm run check:component-safety`)

The lint is dependency-free and fails closed. It refuses:

- an element that is not on the allow-list (text layout elements, `<img>`,
  inline SVG shapes). `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`,
  `<meta>`, `<base>`, `<form>`, `<style>`, `<foreignObject>`, `<animate>`,
  `<use>` and `<a>` get a named message;
- an attribute that is not on the allow-list, any `on*=` attribute, `style=`,
  `href=` and `srcset=`;
- a `javascript:`, `vbscript:`, `data:text/html` or `data:image/svg` URL in any
  file, also when entities, CSS escapes or whitespace hide it;
- a triple mustache `{{{x}}}`, `{{&x}}`, a delimiter change `{{=…=}}` and a
  partial `{{>x}}`;
- a Mustache tag in attribute position, in an unquoted attribute, or in an
  attribute other than `class`, `alt`, `title`, `src`, `aria-*`, `data-*`;
- an `<img src>` that is not exactly one `image` slot or an https URL on
  `brand.devfellowship.com`;
- a variable that is not a slot or a view flag;
- an HTML comment, a doctype, a raw `<` in text, and markup it cannot parse;
- in the CSS: a selector outside `.tpl-root`, `@import` and other at-rules
  except `@media`, `@supports` and `@keyframes`, `url()` off
  `brand.devfellowship.com`, `expression()`, a backslash escape, `<`, and
  Mustache;
- a secret-like string (this repository is public);
- a `sample.json` that breaks the slot contract.

`npm run check:component-render` then renders every component in every theme
(mount, box, theme tokens, brand fonts) and puts
`<img src=x onerror=alert(1)>` in every text slot: the value must show as text,
with zero `<script>` and zero `on*` attributes in the DOM.

The other two layers of ADR-2 live in the consumers: the MCP tool and the editor
accept only typed slot values (`validateSlotValues` in
`scripts/check-component-safety.mjs` is the reference), and the renderer runs
DOMPurify on the rendered component.

## Run locally

```bash
npm ci
npm run gen:component-schema     # write schema.json after a config.yaml change
npm run check:component-safety
npm run test:components
npx playwright install chromium && npm run check:component-render
```

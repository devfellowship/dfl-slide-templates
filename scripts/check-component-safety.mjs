/**
 * check-component-safety.mjs — refuse an overlay component that could carry a
 * script, and validate slot values against a component's generated schema.
 *
 * WHY THIS FILE EXISTS
 *   An overlay component (`components/<id>/`) is HTML that Lesson Studio, the
 *   export (dfl-render) and agents render with slot values. Tainan, TG 32831:
 *   "we must not allow injecting scripts through components". Plan
 *   20261119-lesson-studio-overlay-components, ADR-2, layer 1 (the template in
 *   Git). Layer 2 (slot values at write) has its reference implementation here
 *   too: `validateSlotValues`, which the MCP tool and Studio mirror.
 *
 * HOW IT FAILS CLOSED
 *   - The HTML check is an ALLOW-list of elements and attributes. An element or
 *     attribute it does not know is refused. The deny-lists exist only to give
 *     a precise message for the dangerous cases (<script>, on*=, ...).
 *   - Anything the tokenizer cannot parse is refused (`parse-error`), never
 *     skipped.
 *   - A component directory holds only the files this check knows. A file it
 *     does not know (a .js, an .svg, a symlink, a subdirectory) is refused.
 *   - The slot list comes from `schema.json` (generated from config.yaml by
 *     `component-format.mjs`; CI fails when it drifts). No schema.json, no pass.
 *   - Zero components found is a failure, not a vacuous pass.
 *
 *   Dependency-free node, the same posture as `check-registry-shape.mjs` and the
 *   auto-merge gate: a guard must not run third-party code to decide.
 *
 * Run:  npm run check:component-safety [-- <component-dir> ...]
 *       (default: every directory in components/ and fixtures/components/)
 * Exit: 0 = every component is safe. 1 = a finding (each one named), or nothing
 *       to check, or a directory that cannot be read.
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..');
export const COMPONENT_ROOTS = ['components', join('fixtures', 'components')];

/* ── what a component directory may hold ─────────────────────────────────── */

const REQUIRED_FILES = ['config.yaml', 'component.html', 'component.css', 'schema.json'];
const OPTIONAL_FILES = ['sample.json'];
const PREVIEW_FILE = /^preview-[a-z0-9-]+\.png$/;
export const COMPONENT_ID = /^[a-z][a-z0-9-]*$/;

/* ── HTML allow-lists ────────────────────────────────────────────────────── */

/** Elements a component may use. Plain layout text, one <img>, inline Lucide-style SVG. */
const ALLOWED_TAGS = new Set([
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'b', 'i',
  'small', 'br', 'img', 'figure', 'figcaption', 'ul', 'ol', 'li',
  'svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect',
]);
const VOID_TAGS = new Set(['br', 'img']);
const SVG_SHAPES = new Set(['path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'g']);

/** Named so the message says WHY. Every one of these is also absent from ALLOWED_TAGS. */
const FORBIDDEN_TAGS = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta',
  'base', 'form', 'input', 'button', 'textarea', 'select', 'option', 'style', 'template',
  'noscript', 'portal', 'foreignobject', 'animate', 'animatemotion', 'animatetransform',
  'set', 'use', 'image', 'a', 'video', 'audio', 'source', 'track', 'math', 'svg:script',
]);

/** Attributes a component may use on any allowed element. */
const ALLOWED_ATTRS = new Set([
  'class', 'id', 'role', 'alt', 'title', 'width', 'height', 'src', 'loading', 'decoding',
  'viewbox', 'xmlns', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'fill-rule', 'clip-rule', 'opacity', 'transform',
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'focusable',
  'preserveaspectratio', 'vector-effect',
]);
const ARIA_OR_DATA = /^(aria|data)-[a-z0-9-]+$/;

/** Named so the message says WHY. None of these is in ALLOWED_ATTRS. */
const FORBIDDEN_ATTRS = new Set([
  'style', 'href', 'xlink:href', 'srcset', 'srcdoc', 'action', 'formaction', 'background',
  'poster', 'lowsrc', 'dynsrc', 'ping', 'xmlns:xlink', 'is', 'contenteditable', 'autofocus',
]);

/** Attributes whose VALUE may hold a Mustache variable. */
const MUSTACHE_ATTRS = new Set(['class', 'alt', 'title', 'src']);

/** A static (non-Mustache) img src must point at the brand host. */
const STATIC_SRC = /^https:\/\/brand\.devfellowship\.com\/[A-Za-z0-9._~\/-]+$/;

/* ── CSS ─────────────────────────────────────────────────────────────────── */

const CSS_ALLOWED_AT = new Set(['media', 'supports', 'keyframes', '-webkit-keyframes']);
const CSS_URL_HOST = /^["']?https:\/\/brand\.devfellowship\.com\/[A-Za-z0-9._~\/-]+["']?$/;

/* ── text-wide patterns ──────────────────────────────────────────────────── */

const DANGEROUS_SCHEMES = [
  'javascript:', 'vbscript:', 'livescript:', 'data:text/html', 'data:image/svg',
  'data:application', 'data:text/javascript',
];

const SECRET_LIKE = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a PEM private key'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'a GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'a GitHub fine-grained token'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'an API secret key (sk-...)'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key id'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./, 'a JWT'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
];

/* ── helpers ─────────────────────────────────────────────────────────────── */

const NAMED_ENTITIES = { colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')', sol: '/', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Decode HTML entities, CSS escapes and percent-escapes, drop whitespace and
 * control characters, and lower-case — so `jav&#x61;script:`, `java\nscript:`
 * and `JAVASCRIPT:` all read as `javascript:`.
 */
export function normalizeForSchemes(text) {
  let s = text;
  for (let pass = 0; pass < 3; pass++) {
    s = s
      .replace(/&#x([0-9a-f]+);?/gi, (_, h) => safeFromCodePoint(parseInt(h, 16)))
      .replace(/&#([0-9]+);?/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
      .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m)
      .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => safeFromCodePoint(parseInt(h, 16)))
      .replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  // eslint-disable-next-line no-control-regex
  return s.replace(new RegExp('[\\s\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\ufeff\\\\]', 'g'), '').toLowerCase();
}

function safeFromCodePoint(n) {
  try {
    return String.fromCodePoint(n);
  } catch {
    return '�';
  }
}

function scanTextWide(file, text, out) {
  const norm = normalizeForSchemes(text);
  for (const scheme of DANGEROUS_SCHEMES) {
    if (norm.includes(scheme)) {
      out.push({ rule: 'dangerous-url', file, detail: `contains a "${scheme}" URL (after entity/escape decoding). A component never needs one.` });
    }
  }
  for (const [re, what] of SECRET_LIKE) {
    if (re.test(text)) {
      out.push({ rule: 'secret-like', file, detail: `contains what looks like ${what}. This repository is PUBLIC.` });
    }
  }
}

/* ── Mustache ────────────────────────────────────────────────────────────── */

/**
 * The names a component template may reference: every slot, and for each
 * `select` slot `x` with option `v`, the view flag `x__v` (plan, "Component
 * format": `{{#type__ia}}<svg…>{{/type__ia}}`).
 */
export function allowedVariables(schema) {
  const names = new Set();
  for (const [name, prop] of Object.entries(schema?.properties ?? {})) {
    names.add(name);
    if (prop && prop['x-dfl-slot-type'] === 'select' && Array.isArray(prop.enum)) {
      for (const v of prop.enum) names.add(`${name}__${v}`);
    }
  }
  return names;
}

function slotTypeOf(schema, name) {
  return schema?.properties?.[name]?.['x-dfl-slot-type'] ?? null;
}

/** Every `{{...}}` tag in `text`, with what kind of tag it is. */
function mustacheTags(text) {
  const tags = [];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1];
    const sigil = raw.trimStart()[0] ?? '';
    tags.push({ raw: m[0], sigil, name: raw.trim().replace(/^[#^/!&>={]\s*/, '').replace(/\s*[}=]$/, '').trim(), index: m.index });
  }
  return tags;
}

function checkMustache(file, text, vars, out) {
  if (/\{\{\{/.test(text)) out.push({ rule: 'mustache-unescaped', file, detail: 'uses a triple mustache {{{...}}}, which renders a value as raw HTML.' });
  for (const t of mustacheTags(text)) {
    if (t.sigil === '&') out.push({ rule: 'mustache-unescaped', file, detail: `uses ${t.raw}, which renders a value as raw HTML.` });
    else if (t.sigil === '{') continue; // reported above
    else if (t.sigil === '=') out.push({ rule: 'mustache-delimiter', file, detail: `uses ${t.raw}: a delimiter change hides tags from this check.` });
    else if (t.sigil === '>') out.push({ rule: 'mustache-partial', file, detail: `uses the partial ${t.raw}: a component is one self-contained file.` });
    else if (t.sigil === '!') continue;
    else if (!vars.has(t.name)) {
      out.push({ rule: 'unknown-variable', file, detail: `references ${t.raw}, which is not a slot in schema.json (nor a select view flag slot__value).` });
    }
  }
  // An unclosed `{{` hides the rest of the line from the parser above.
  const opens = (text.match(/\{\{/g) ?? []).length;
  const closes = (text.match(/\}\}/g) ?? []).length;
  if (opens !== closes) out.push({ rule: 'parse-error', file, detail: `has ${opens} "{{" but ${closes} "}}".` });
}

/* ── HTML tokenizer ──────────────────────────────────────────────────────── */

/**
 * Walk component.html. Text may hold Mustache; a tag is
 * `<name attr="value" ...>` or `</name>`. Anything else that starts with `<`
 * is refused, as is a Mustache tag anywhere inside a tag but outside a quoted
 * attribute value (it would let a slot value write an attribute).
 */
function checkHtml(file, html, schema, out) {
  const vars = allowedVariables(schema);
  checkMustache(file, html, vars, out);

  const stack = [];
  let svgDepth = 0;
  let i = 0;
  const n = html.length;
  const err = (rule, detail) => out.push({ rule, file, detail });

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    i = lt;
    if (html.startsWith('<!--', i)) {
      err('html-comment', 'contains an HTML comment. Put notes in config.yaml (`description:`); comments are a known parser-confusion vector.');
      const end = html.indexOf('-->', i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[i + 1] === '!' || html[i + 1] === '?') {
      err('html-declaration', `contains "${html.slice(i, i + 12)}…": no doctype, CDATA or processing instruction in a component.`);
      const end = html.indexOf('>', i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const closing = html[i + 1] === '/';
    const nameStart = i + (closing ? 2 : 1);
    const nameMatch = /^[A-Za-z][A-Za-z0-9:-]*/.exec(html.slice(nameStart));
    if (!nameMatch) {
      err('raw-lt', `has a "<" that does not start a tag at offset ${i} ("${html.slice(i, i + 12)}…"). Write &lt; for a literal "<".`);
      i += 1;
      continue;
    }
    const tagName = nameMatch[0].toLowerCase();
    let j = nameStart + nameMatch[0].length;

    if (FORBIDDEN_TAGS.has(tagName)) err('forbidden-tag', `uses <${tagName}>. It can run script, load a document or restyle the host.`);
    else if (!ALLOWED_TAGS.has(tagName)) err('unknown-tag', `uses <${tagName}>, which is not on the component element allow-list.`);

    if (closing) {
      const close = /^\s*>/.exec(html.slice(j));
      if (!close) {
        err('parse-error', `the closing tag </${tagName}> holds more than its name.`);
        const end = html.indexOf('>', j);
        i = end === -1 ? n : end + 1;
        continue;
      }
      i = j + close[0].length;
      if (stack.length === 0 || stack[stack.length - 1] !== tagName) {
        err('parse-error', `</${tagName}> does not close the open element (<${stack[stack.length - 1] ?? 'none'}>).`);
      } else {
        stack.pop();
        if (tagName === 'svg') svgDepth--;
      }
      continue;
    }

    // attributes
    let selfClosed = false;
    let ok = true;
    const attrs = [];
    for (;;) {
      const ws = /^\s*/.exec(html.slice(j))[0];
      j += ws.length;
      if (j >= n) { err('parse-error', `<${tagName}> is never closed with ">".`); ok = false; break; }
      if (html.startsWith('/>', j)) { selfClosed = true; j += 2; break; }
      if (html[j] === '>') { j += 1; break; }
      if (html.startsWith('{{', j)) {
        err('mustache-in-tag', `<${tagName}> has a Mustache tag in attribute position: a slot value would write an attribute.`);
        const end = html.indexOf('}}', j);
        j = end === -1 ? n : end + 2;
        continue;
      }
      if (ws.length === 0 && attrs.length > 0) {
        err('parse-error', `<${tagName}> has two attributes with no space between them.`);
      }
      const an = /^[^\s"'<>\/=]+/.exec(html.slice(j));
      if (!an) { err('parse-error', `<${tagName}> has an unparseable character "${html[j]}" in its attribute list.`); ok = false; break; }
      const attrName = an[0].toLowerCase();
      j += an[0].length;
      let value = null;
      let quoted = false;
      const eq = /^\s*=\s*/.exec(html.slice(j));
      if (eq) {
        j += eq[0].length;
        const q = html[j];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, j + 1);
          if (end === -1) { err('parse-error', `<${tagName} ${attrName}=…> has an unterminated quoted value.`); ok = false; break; }
          value = html.slice(j + 1, end);
          quoted = true;
          j = end + 1;
        } else {
          const uv = /^[^\s>]*/.exec(html.slice(j))[0];
          value = uv;
          j += uv.length;
        }
      }
      attrs.push({ name: attrName, value, quoted });
    }
    if (!ok) {
      // Keep scanning from where the tag broke, so a tag hidden behind the
      // broken one (`<scr<script>ipt>`) is still examined.
      i = Math.max(j, i + 1);
      continue;
    }
    i = j;

    const seen = new Set();
    for (const a of attrs) {
      if (seen.has(a.name)) err('parse-error', `<${tagName}> declares ${a.name} twice; browsers keep only the first, so a check of the second proves nothing.`);
      seen.add(a.name);
      checkAttribute(tagName, a, schema, err);
    }

    if (VOID_TAGS.has(tagName)) {
      // <img>, <br>: no content, no close tag.
    } else if (selfClosed) {
      if (!(svgDepth > 0 && SVG_SHAPES.has(tagName))) {
        err('parse-error', `<${tagName}/> is self-closed, which HTML ignores outside an SVG shape: the element stays open.`);
      }
    } else {
      stack.push(tagName);
      if (tagName === 'svg') svgDepth++;
    }
  }
  if (stack.length) err('parse-error', `elements left open at the end: <${stack.join('>, <')}>.`);
}

function checkAttribute(tag, attr, schema, err) {
  const { name, value, quoted } = attr;
  if (/^on/.test(name)) {
    err('event-handler-attr', `<${tag}> has the event handler attribute ${name}=, which runs script.`);
    return;
  }
  if (FORBIDDEN_ATTRS.has(name)) {
    err('forbidden-attr', `<${tag}> has ${name}=. It can load a URL or bypass the CSS checks.`);
    return;
  }
  if (!ALLOWED_ATTRS.has(name) && !ARIA_OR_DATA.test(name)) {
    err('unknown-attr', `<${tag}> has ${name}=, which is not on the component attribute allow-list.`);
    return;
  }
  const hasMustache = value != null && value.includes('{{');
  if (hasMustache && !quoted) {
    err('mustache-unquoted-attr', `<${tag} ${name}=${value}>: a Mustache value in an UNQUOTED attribute lets a space in the slot value start a new attribute.`);
  }
  if (hasMustache && !MUSTACHE_ATTRS.has(name) && !ARIA_OR_DATA.test(name)) {
    err('mustache-attr-not-allowed', `<${tag}> puts a slot value in ${name}=. Slot values may go only in class, alt, title, src (img), aria-* and data-*.`);
  }
  if (name === 'src') {
    if (tag !== 'img') {
      err('forbidden-attr', `<${tag}> has src=. Only <img> may load a source.`);
      return;
    }
    const v = (value ?? '').trim();
    const only = /^\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}$/.exec(v);
    if (only) {
      if (slotTypeOf(schema, only[1]) !== 'image') {
        err('img-src', `<img src="${v}">: src may hold only an \`image\` slot, whose value is checked against the https host allowlist.`);
      }
    } else if (hasMustache) {
      err('img-src', `<img src="${v}">: src must be exactly one image slot ({{slot}}), not a URL built from parts.`);
    } else if (!STATIC_SRC.test(v)) {
      err('img-src', `<img src="${v}">: a static src must be an https URL on brand.devfellowship.com.`);
    }
  }
}

/* ── CSS ─────────────────────────────────────────────────────────────────── */

function checkCss(file, css, out) {
  const err = (rule, detail) => out.push({ rule, file, detail });
  if (css.includes('{{') || css.includes('}}')) err('css-mustache', 'contains Mustache. Component CSS is static; slot values never reach it.');
  if (css.includes('\\')) err('css-escape', 'contains a backslash. CSS escapes can spell url( or expression( so that no check sees them.');
  if (css.includes('<')) err('css-markup', 'contains "<". Component CSS is inlined into a <style> element, where "</style" ends it.');

  // strip comments
  let stripped = '';
  let k = 0;
  while (k < css.length) {
    const open = css.indexOf('/*', k);
    if (open === -1) { stripped += css.slice(k); break; }
    stripped += css.slice(k, open);
    const close = css.indexOf('*/', open + 2);
    if (close === -1) { err('parse-error', 'has an unterminated /* comment.'); return; }
    k = close + 2;
  }
  const lower = stripped.toLowerCase();
  if (/expression\s*\(/.test(lower)) err('css-expression', 'uses expression(), which runs script in old engines.');
  if (/(^|[;{\s])(behavior|-moz-binding)\s*:/.test(lower)) err('css-expression', 'uses behavior: or -moz-binding:, which load script.');
  for (const m of stripped.matchAll(/url\s*\(\s*([^)]*)\)/gi)) {
    if (!CSS_URL_HOST.test(m[1].trim())) err('css-url', `uses url(${m[1].trim()}). A component may load a URL only from https://brand.devfellowship.com/.`);
  }
  if (/url\s*\(/i.test(stripped) && !/url\s*\([^)]*\)/i.test(stripped)) err('parse-error', 'has an unterminated url(.');
  if (/image-set\s*\(|src\s*\(/i.test(stripped)) err('css-url', 'uses image-set() or src(), which load a URL outside the url() check.');

  walkCssBlock(stripped, 0, stripped.length, false, err);
}

/** Recursive walk over `selector { body }` and `@rule ... { ... }` blocks. */
function walkCssBlock(css, start, end, inKeyframes, err) {
  let i = start;
  while (i < end) {
    const ws = /^[\s;]*/.exec(css.slice(i, end))[0];
    i += ws.length;
    if (i >= end) return;
    const open = css.indexOf('{', i);
    const semi = css.indexOf(';', i);
    if (css[i] === '@') {
      const at = /^@([A-Za-z-]+)/.exec(css.slice(i));
      const atName = at ? at[1].toLowerCase() : '';
      if (!CSS_ALLOWED_AT.has(atName)) {
        err(atName === 'import' ? 'css-import' : 'css-at-rule', `uses @${atName}. Allowed at-rules: @${[...CSS_ALLOWED_AT].join(', @')}.`);
      }
      if (semi !== -1 && (open === -1 || semi < open)) { i = semi + 1; continue; }
    }
    if (open === -1 || open >= end) {
      err('parse-error', `has text after the last block: "${css.slice(i, Math.min(end, i + 30)).trim()}".`);
      return;
    }
    const close = matchBrace(css, open, end);
    if (close === -1) { err('parse-error', 'has an unbalanced "{".'); return; }
    const prelude = css.slice(i, open).trim();
    if (prelude.startsWith('@')) {
      const atName = (/^@([A-Za-z-]+)/.exec(prelude)?.[1] ?? '').toLowerCase();
      walkCssBlock(css, open + 1, close, atName.endsWith('keyframes'), err);
    } else if (!inKeyframes) {
      for (const sel of splitSelectors(prelude)) {
        if (!/^\.tpl-root(?![A-Za-z0-9_-])/.test(sel)) {
          err('css-unscoped', `selector "${sel}" is not scoped under .tpl-root, so it would style the host editor or deck.`);
        }
      }
      const body = css.slice(open + 1, close);
      if (body.includes('{')) err('parse-error', `selector "${prelude}" holds a nested block; CSS nesting is not allowed in a component.`);
    }
    i = close + 1;
  }
}

function matchBrace(css, open, end) {
  let depth = 0;
  for (let i = open; i < end; i++) {
    const c = css[i];
    if (c === '"' || c === "'") {
      const e = css.indexOf(c, i + 1);
      if (e === -1) return -1;
      i = e;
    } else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitSelectors(prelude) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of prelude) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/* ── slot values (layer 2 reference) ─────────────────────────────────────── */

const ANNOTATION_KEYS = new Set(['description', 'default', 'format', 'title', 'examples', '$schema', '$id', '$comment']);

/**
 * Validate slot values against a component `schema.json`. It knows exactly the
 * subset `component-format.mjs` emits, and THROWS on any other keyword, so a
 * schema that grows a rule this validator does not enforce cannot pass it.
 *
 * @returns {string[]} problems; empty = valid
 */
export function validateSlotValues(schema, values) {
  const problems = [];
  const known = new Set(['type', 'additionalProperties', 'required', 'properties']);
  for (const key of Object.keys(schema)) {
    if (!known.has(key) && !ANNOTATION_KEYS.has(key) && !key.startsWith('x-')) {
      throw new Error(`schema keyword "${key}" is not supported by validateSlotValues; refusing to validate.`);
    }
  }
  if (schema.type !== 'object' || schema.additionalProperties !== false) {
    throw new Error('a component schema must be type:object with additionalProperties:false.');
  }
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    return ['slot values must be a JSON object keyed by slot name.'];
  }
  const props = schema.properties ?? {};
  for (const key of Object.keys(values)) {
    if (!Object.prototype.hasOwnProperty.call(props, key)) problems.push(`"${key}" is not a slot of this component.`);
  }
  for (const req of schema.required ?? []) {
    if (values[req] === undefined) problems.push(`"${req}" is required.`);
  }
  for (const [name, prop] of Object.entries(props)) {
    const v = values[name];
    if (v === undefined) continue;
    for (const key of Object.keys(prop)) {
      if (!['type', 'enum', 'minLength', 'maxLength', 'pattern'].includes(key) && !ANNOTATION_KEYS.has(key) && !key.startsWith('x-')) {
        throw new Error(`slot "${name}": schema keyword "${key}" is not supported by validateSlotValues; refusing to validate.`);
      }
    }
    if (prop.type !== 'string') throw new Error(`slot "${name}": only string slots are supported.`);
    if (typeof v !== 'string') { problems.push(`"${name}" must be a string.`); continue; }
    const len = [...v].length;
    if (prop.enum && !prop.enum.includes(v)) problems.push(`"${name}" must be one of ${prop.enum.join(', ')}.`);
    if (prop.minLength != null && len < prop.minLength) problems.push(`"${name}" is shorter than ${prop.minLength} characters.`);
    if (prop.maxLength != null && len > prop.maxLength) problems.push(`"${name}" is longer than ${prop.maxLength} characters.`);
    if (prop.pattern != null && !new RegExp(prop.pattern, 'u').test(v)) problems.push(`"${name}" does not match ${prop.pattern}.`);
  }
  return problems;
}

/* ── one component ───────────────────────────────────────────────────────── */

/**
 * Check one component, given its file names and text contents.
 *
 * @param {{ id: string, files: Record<string, string|null>, entries?: {name:string, kind:'file'|'dir'|'symlink'|'other'}[] }} input
 *   `files` maps a file name to its UTF-8 text (null for a binary preview).
 * @returns {{ rule: string, file: string, detail: string }[]} findings; empty = safe
 */
export function checkComponentSafety({ id, files, entries }) {
  const out = [];
  if (!COMPONENT_ID.test(id)) out.push({ rule: 'bad-id', file: '.', detail: `directory name "${id}" must match ${COMPONENT_ID}.` });

  for (const e of entries ?? Object.keys(files).map((name) => ({ name, kind: 'file' }))) {
    if (e.kind !== 'file') {
      out.push({ rule: 'unexpected-file', file: e.name, detail: `is a ${e.kind}. A component directory holds plain files only.` });
    } else if (!REQUIRED_FILES.includes(e.name) && !OPTIONAL_FILES.includes(e.name) && !PREVIEW_FILE.test(e.name)) {
      out.push({ rule: 'unexpected-file', file: e.name, detail: `is not part of the component format (${[...REQUIRED_FILES, ...OPTIONAL_FILES, 'preview-<theme>.png'].join(', ')}).` });
    }
  }
  for (const req of REQUIRED_FILES) {
    if (typeof files[req] !== 'string') out.push({ rule: 'missing-file', file: req, detail: 'is required.' });
  }

  for (const [name, text] of Object.entries(files)) {
    if (typeof text === 'string') scanTextWide(name, text, out);
  }

  let schema = null;
  if (typeof files['schema.json'] === 'string') {
    try {
      schema = JSON.parse(files['schema.json']);
      if (!schema || typeof schema !== 'object' || !schema.properties || !schema['x-dfl-component']) {
        out.push({ rule: 'schema', file: 'schema.json', detail: 'is not a generated component schema (no properties / x-dfl-component). Run npm run gen:component-schema.' });
        schema = null;
      }
    } catch (e) {
      out.push({ rule: 'schema', file: 'schema.json', detail: `does not parse: ${e.message}` });
    }
  }

  if (typeof files['component.html'] === 'string') {
    if (!schema) out.push({ rule: 'schema', file: 'component.html', detail: 'cannot be checked without a valid schema.json (the slot list).' });
    else checkHtml('component.html', files['component.html'], schema, out);
  }
  if (typeof files['component.css'] === 'string') checkCss('component.css', files['component.css'], out);

  if (typeof files['sample.json'] === 'string' && schema) {
    let sample;
    try {
      sample = JSON.parse(files['sample.json']);
    } catch (e) {
      out.push({ rule: 'sample', file: 'sample.json', detail: `does not parse: ${e.message}` });
    }
    if (sample !== undefined) {
      try {
        for (const p of validateSlotValues(schema, sample)) out.push({ rule: 'sample', file: 'sample.json', detail: p });
      } catch (e) {
        out.push({ rule: 'schema', file: 'schema.json', detail: e.message });
      }
    }
  }
  return out;
}

/** Read a component directory from disk (no symlink is followed). */
export function readComponentDir(dir) {
  const entries = [];
  const files = {};
  for (const name of readdirSync(dir)) {
    const st = lstatSync(join(dir, name));
    const kind = st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other';
    entries.push({ name, kind });
    if (kind !== 'file') continue;
    files[name] = name.endsWith('.png') ? null : readFileSync(join(dir, name), 'utf8');
  }
  return { id: basename(dir), files, entries };
}

/** Every component directory under the given roots (relative to the repo). */
export function listComponentDirs(roots = COMPONENT_ROOTS) {
  const dirs = [];
  for (const root of roots) {
    const abs = join(REPO_ROOT, root);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      const st = lstatSync(join(abs, name));
      if (st.isDirectory() || st.isSymbolicLink()) dirs.push(join(abs, name));
    }
  }
  return dirs;
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

function main(argv) {
  const dirs = argv.length ? argv.map((d) => (d.startsWith('/') ? d : join(process.cwd(), d))) : listComponentDirs();
  if (dirs.length === 0) {
    console.error('check-component-safety: no component directory found. Refusing a vacuous pass (fixtures/components/ must hold at least one).');
    return 1;
  }
  let bad = 0;
  for (const dir of dirs) {
    const rel = relative(REPO_ROOT, dir) || dir;
    let findings;
    try {
      if (lstatSync(dir).isSymbolicLink()) throw new Error('is a symlink');
      findings = checkComponentSafety(readComponentDir(dir));
    } catch (e) {
      findings = [{ rule: 'unreadable', file: '.', detail: e.message }];
    }
    if (findings.length === 0) {
      console.log(`ok    ${rel}`);
    } else {
      bad++;
      console.error(`FAIL  ${rel}: ${findings.length} finding(s)`);
      for (const f of findings) console.error(`        x [${f.rule}] ${f.file}: ${f.detail}`);
    }
  }
  if (bad) {
    console.error(`\n${bad} of ${dirs.length} component(s) refused. Plan 20261119-lesson-studio-overlay-components ADR-2: no script may enter through a component.`);
    return 1;
  }
  console.log(`\ncomponent safety OK: ${dirs.length} component(s).`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}

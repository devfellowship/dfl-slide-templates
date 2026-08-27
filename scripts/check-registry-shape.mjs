/**
 * check-registry-shape.mjs — assert that `registry.json` still holds the shape
 * its readers and its one automated writer depend on.
 *
 * WHY THIS FILE EXISTS
 *   `registry.json` has two consumers that live in OTHER repositories:
 *
 *     • `dfl-mcp-studio:rank.ts` scores `search_templates` on `name`,
 *       `when_to_use`, `media_profile`, `tags`, `layout` and `category`. A
 *       template that loses any of them stops being findable. Nothing in this
 *       repository renders that metadata, so no other guard reads it.
 *     • `dfl-schema:supabase/functions/publish-template` is the only automated
 *       WRITER. It edits this document as TEXT — it replaces the span of one
 *       entry and re-encodes nothing else — so that a version bump over MCP no
 *       longer deletes the six fields above (plan Gap 4). That strategy rests on
 *       one property of THIS file: the `templates[]` section must be exactly
 *       `JSON.stringify(_, null, 2)` output, and each `themes[]` entry must sit
 *       on its own single line. If the formatting drifts, the writer still runs
 *       and produces a diff nobody expected.
 *
 *   The writer used to live here, with its own suite, under the CI job
 *   "Registry merge (write path)". The writer moved to the repository that
 *   actually deploys it (`dfl-schema` PR #889) and its suite moved with it. What
 *   could NOT move is the half that asserts the LIVE document, because
 *   `dfl-schema` can only test against a vendored snapshot. This job is that
 *   half, and it is why the old `guard|` line could be retired instead of simply
 *   deleted.
 *
 *   Dependency-free node, the same posture as `lint-css.mjs` and
 *   `.github/scripts/automerge-decide.mjs`: a guard must not run third-party
 *   code to decide whether this repository is well formed.
 *
 * Run:  npm run check:registry
 * Exit: 0 = the shape holds. 1 = it does not, and every failure is named.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const REGISTRY_PATH = join(REPO_ROOT, 'registry.json');

/** The v2 shape. Every one of these must be present and non-empty. */
const TEMPLATE_FIELDS = [
  'id',
  'version',
  'category',
  'name',
  'when_to_use',
  'avoid_when',
  'media_profile',
  'text_density',
  'layout',
  'tags',
];

/** What `dfl-mcp-studio:rank.ts` scores on. A subset, named so the reason is visible. */
const RANKED_FIELDS = ['name', 'when_to_use', 'media_profile', 'tags', 'layout', 'category'];

/** The `themes[]` shape `list_themes` serves as the source of truth. */
const THEME_FIELDS = ['id', 'name', 'file', 'mode'];

const failures = [];
function fail(msg) {
  failures.push(msg);
}

function isEmptyValue(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

const text = readFileSync(REGISTRY_PATH, 'utf8');

let parsed;
try {
  parsed = JSON.parse(text);
} catch (err) {
  console.error(`registry.json does not parse as JSON: ${err.message}`);
  process.exit(1);
}

/* ── top level ───────────────────────────────────────────────────────────── */

if (String(parsed.$schema_version) !== '2') {
  fail(
    `$schema_version is ${JSON.stringify(parsed.$schema_version)}, expected "2". ` +
      `A version bump here is a cross-repo contract change: dfl-mcp-studio reads this file, ` +
      `and dfl-schema:publish-template writes it.`,
  );
}
for (const key of ['themes', 'templates']) {
  if (!Array.isArray(parsed[key])) {
    fail(`there is no top-level "${key}" array. publish-template FAILS CLOSED on that, so no template or theme could be published.`);
  }
}
if (failures.length) {
  report();
}

/* ── formatting: what the surgical writer depends on ─────────────────────── */

// `dfl-schema:publish-template/registry-merge.ts` re-encodes ONE entry with
// `JSON.stringify(entry, null, 2)` and splices it over that entry's span. That
// is only a no-op for an unchanged entry while this holds.
const restringified = JSON.stringify(parsed, null, 2) + '\n';
const here = text.indexOf('"templates"');
const there = restringified.indexOf('"templates"');
if (text.slice(here) !== restringified.slice(there)) {
  fail(
    'the templates[] section is no longer exactly JSON.stringify(_, null, 2) output. ' +
      'The publish-template writer splices a re-encoded entry into this document by offset, ' +
      'so a formatting drift here makes an unchanged entry produce a diff. ' +
      'Reformat templates[] with two-space indentation, one field per line.',
  );
}

// Each themes[] entry occupies ONE line, hand-aligned. The writer detects that
// style and appends a new theme in it; if an entry becomes multi-line, a theme
// publish reformats a block it was never asked to touch.
{
  const open = text.indexOf('"themes"');
  const close = text.indexOf('"templates"');
  const block = text.slice(open, close);
  for (const theme of parsed.themes) {
    const needle = `"id": "${theme.id}"`;
    const line = block.split('\n').find((l) => l.includes(needle));
    if (!line) {
      fail(`the themes[] entry for '${theme.id}' does not sit on a single line, which the writer's append style assumes.`);
      continue;
    }
    for (const field of THEME_FIELDS) {
      if (!line.includes(`"${field}"`)) {
        fail(`the themes[] entry for '${theme.id}' spans more than one line (${field} is on another line).`);
        break;
      }
    }
  }
}

/* ── no ambiguous target ─────────────────────────────────────────────────── */

for (const key of ['templates', 'themes']) {
  const seen = new Map();
  for (const entry of parsed[key]) {
    seen.set(entry.id, (seen.get(entry.id) ?? 0) + 1);
  }
  for (const [id, n] of seen) {
    if (n > 1) {
      fail(
        `${key}[] carries the id '${id}' ${n} times. publish-template REFUSES an ambiguous target, ` +
          `so no publish for that id can succeed until the duplicate is removed.`,
      );
    }
  }
}

/* ── templates[]: the v2 shape, and what the ranker needs ────────────────── */

for (const entry of parsed.templates) {
  const id = entry.id ?? '<no id>';
  for (const field of TEMPLATE_FIELDS) {
    if (isEmptyValue(entry[field])) {
      const why = RANKED_FIELDS.includes(field)
        ? `dfl-mcp-studio:rank.ts scores search_templates on it, so the template becomes unfindable`
        : `the v2 registry shape declares it`;
      fail(`templates[] entry '${id}' has no ${field}: ${why}.`);
    }
  }
  if (!Array.isArray(entry.tags)) {
    fail(`templates[] entry '${id}' has a non-array tags field; rank.ts tokenises it as a list.`);
  }
  if (!existsSync(join(REPO_ROOT, 'templates', String(entry.id)))) {
    fail(`templates[] entry '${id}' has no templates/${id}/ directory, so nothing can render it.`);
  }
}

/* ── themes[]: the catalogue list_themes serves ──────────────────────────── */

for (const entry of parsed.themes) {
  const id = entry.id ?? '<no id>';
  for (const field of THEME_FIELDS) {
    if (isEmptyValue(entry[field])) {
      fail(`themes[] entry '${id}' has no ${field}: list_themes serves this array as the source of truth, so a missing field is served as truth.`);
    }
  }
  // The writer DERIVES `file` from the id so the two can never disagree. Assert
  // the same relation on the document, or an entry written by hand can.
  if (entry.file && entry.file !== `themes/${id}.css`) {
    fail(`themes[] entry '${id}' declares file '${entry.file}', but publish-template always derives 'themes/${id}.css'. A hand edit and a publish would disagree.`);
  }
  if (entry.file && !existsSync(join(REPO_ROOT, String(entry.file)))) {
    fail(`themes[] entry '${id}' points at '${entry.file}', which is not in this repository.`);
  }
  if (entry.mode && !['light', 'dark'].includes(entry.mode)) {
    fail(`themes[] entry '${id}' has mode '${entry.mode}', expected 'light' or 'dark'.`);
  }
}

/* ── every template directory is registered ──────────────────────────────── */
/*
 * The reverse direction of the check above. An unregistered template renders in
 * `check:theme` and is invisible to `search_templates`, which is the same
 * outcome as losing its metadata — arrived at from the other side.
 */
{
  const registered = new Set(parsed.templates.map((t) => String(t.id)));
  const dirs = readdirSafe(join(REPO_ROOT, 'templates'));
  for (const dir of dirs) {
    if (!registered.has(dir)) {
      fail(`templates/${dir}/ exists but has no registry.json entry, so search_templates can never return it.`);
    }
  }
}

function readdirSafe(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

report();

function report() {
  if (failures.length === 0) {
    console.log(
      `registry.json shape OK: ${parsed.templates.length} templates, ${parsed.themes.length} themes.`,
    );
    process.exit(0);
  }
  console.error(`registry.json shape: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  x ${f}`);
  console.error(
    '\nWhy this is blocking: registry.json is read by dfl-mcp-studio and written by\n' +
      'dfl-schema:publish-template, and neither of them can see a problem in this file\n' +
      'until a user cannot find a template.',
  );
  process.exit(1);
}

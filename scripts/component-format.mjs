/**
 * component-format.mjs — the overlay component format: validate a component
 * `config.yaml`, generate its `schema.json` (the slot contract), and build the
 * Mustache view a renderer uses.
 *
 * WHY THIS FILE EXISTS
 *   Plan 20261119-lesson-studio-overlay-components, ADR-6: "the slot contract is
 *   generated from config.yaml". Studio, the studio MCP tools and the
 *   `long-tutorial` skill all read `components/<id>/schema.json`, pinned to a
 *   commit SHA. One source, no copy by hand. `npm run gen:component-schema`
 *   writes the file; CI runs it with `--check` and fails when the committed file
 *   is not exactly what the generator produces from config.yaml.
 *
 *   The format is deliberately small (ADR-2): three slot types (`text` with a
 *   length cap, `select` with an option list, `image` as an https URL on the DFL
 *   media allowlist). No `richText`, no `json`, no `items`. Unknown keys are
 *   refused, so a key that a consumer does not enforce cannot slip in.
 *
 * Run:  npm run gen:component-schema              (write every schema.json)
 *       npm run gen:component-schema -- --check   (CI: fail on drift)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { REPO_ROOT, listComponentDirs, validateSlotValues } from './check-component-safety.mjs';

/** Placement presets a component may allow (plan, "Component format"). */
export const ANCHORS = ['bottom-left', 'bottom-right', 'top-left', 'top-right', 'lower-third'];

/** The ONLY slot types of components v1 (ADR-2). */
export const SLOT_TYPES = ['text', 'select', 'image'];

/**
 * An `image` slot value: an https URL on the dfl-render media allowlist
 * (`*.devfellowship.com`, `*.supabase.co`, `*.s3.amazonaws.com`). The host must
 * be followed by `/` or the end, so `devfellowship.com.evil.example` and
 * `x.devfellowship.com@evil.example` do not match. No port, no userinfo.
 */
export const IMAGE_URL_PATTERN =
  '^https://([a-z0-9-]+\\.)*(devfellowship\\.com|supabase\\.co|s3\\.amazonaws\\.com)(/[^\\s"\'<>\\\\]*)?$';
export const IMAGE_URL_MAX = 2048;

const CONFIG_KEYS = ['id', 'name', 'version', 'kind', 'description', 'box', 'anchors', 'default_anchor', 'duration_ms', 'slots'];
const SLOT_KEYS = {
  common: ['name', 'type', 'required', 'description', 'sample'],
  text: ['max_length', 'max_words'],
  select: ['options', 'default'],
  image: [],
};
const SLOT_NAME = /^[a-z][a-zA-Z0-9]*$/;
const OPTION = /^[a-z][a-z0-9_]*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/**
 * Validate a parsed component config.yaml.
 * @returns {string[]} problems; empty = valid
 */
export function validateConfig(config, dirName) {
  const p = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return ['config.yaml must be a YAML mapping.'];
  for (const k of Object.keys(config)) if (!CONFIG_KEYS.includes(k)) p.push(`unknown key "${k}" (allowed: ${CONFIG_KEYS.join(', ')}).`);
  if (config.kind !== 'component') p.push('kind must be "component".');
  if (typeof config.id !== 'string' || config.id !== dirName) p.push(`id must equal the directory name "${dirName}".`);
  if (typeof config.name !== 'string' || !config.name.trim()) p.push('name is required.');
  if (typeof config.version !== 'string' || !SEMVER.test(config.version)) p.push('version must be a quoted semver string, e.g. "1.0.0".');
  if (config.description !== undefined && typeof config.description !== 'string') p.push('description must be a string.');

  const box = config.box;
  if (!box || typeof box !== 'object' || Object.keys(box).sort().join() !== 'height,width') p.push('box must be {width, height} and nothing else.');
  else {
    if (!isInt(box.width, 1, 1920)) p.push('box.width must be an integer 1..1920 (design pixels on the 1920x1080 canvas).');
    if (!isInt(box.height, 1, 1080)) p.push('box.height must be an integer 1..1080.');
  }

  if (!Array.isArray(config.anchors) || config.anchors.length === 0) p.push(`anchors must be a non-empty list of ${ANCHORS.join(', ')}.`);
  else {
    for (const a of config.anchors) if (!ANCHORS.includes(a)) p.push(`anchor "${a}" is not one of ${ANCHORS.join(', ')}.`);
    if (new Set(config.anchors).size !== config.anchors.length) p.push('anchors has a duplicate.');
    if (!config.anchors.includes(config.default_anchor)) p.push('default_anchor must be one of anchors.');
  }
  if (!isInt(config.duration_ms, 500, 600000)) p.push('duration_ms must be an integer 500..600000 (the default window length).');

  if (!Array.isArray(config.slots) || config.slots.length === 0) {
    p.push('slots must be a non-empty list.');
    return p;
  }
  const names = new Set();
  for (const [i, s] of config.slots.entries()) {
    const at = `slots[${i}]${s && s.name ? ` (${s.name})` : ''}`;
    if (!s || typeof s !== 'object') { p.push(`${at} must be a mapping.`); continue; }
    if (!SLOT_TYPES.includes(s.type)) {
      p.push(`${at}: type "${s.type}" is not a component slot type. Allowed: ${SLOT_TYPES.join(', ')} (no richText, json or items in components, ADR-2).`);
      continue;
    }
    const allowed = [...SLOT_KEYS.common, ...SLOT_KEYS[s.type]];
    for (const k of Object.keys(s)) if (!allowed.includes(k)) p.push(`${at}: unknown key "${k}" for a ${s.type} slot (allowed: ${allowed.join(', ')}).`);
    if (typeof s.name !== 'string' || !SLOT_NAME.test(s.name)) p.push(`${at}: name must match ${SLOT_NAME} (camelCase, no "__").`);
    else if (names.has(s.name)) p.push(`${at}: duplicate slot name.`);
    names.add(s.name);
    if (s.required !== undefined && typeof s.required !== 'boolean') p.push(`${at}: required must be true or false.`);
    if (s.description !== undefined && typeof s.description !== 'string') p.push(`${at}: description must be a string.`);
    if (s.type === 'text') {
      if (!isInt(s.max_length, 1, 500)) p.push(`${at}: a text slot needs max_length, an integer 1..500.`);
      if (s.max_words !== undefined && !isInt(s.max_words, 1, 100)) p.push(`${at}: max_words must be an integer 1..100.`);
    }
    if (s.type === 'select') {
      if (!Array.isArray(s.options) || s.options.length === 0 || s.options.length > 50) p.push(`${at}: options must be a list of 1..50 values.`);
      else {
        for (const o of s.options) if (typeof o !== 'string' || !OPTION.test(o)) p.push(`${at}: option ${JSON.stringify(o)} must match ${OPTION} (it also names the view flag ${s.name}__<option>).`);
        if (new Set(s.options).size !== s.options.length) p.push(`${at}: options has a duplicate.`);
        if (s.default !== undefined && !s.options.includes(s.default)) p.push(`${at}: default must be one of options.`);
      }
    }
  }
  if (p.length === 0) {
    // Each sample: value must itself be a valid slot value.
    const sample = {};
    for (const s of config.slots) if (s.sample !== undefined) sample[s.name] = s.sample;
    // A config may leave a sample out, so "is required" is not a problem here.
    for (const prob of validateSlotValues(buildSchema(config), sample)) {
      if (!prob.endsWith('is required.')) p.push(`sample: ${prob}`);
    }
  }
  return p;
}

function textPattern(maxWords) {
  // 1..maxWords words separated by whitespace; surrounding whitespace allowed.
  return maxWords === 1 ? '^\\s*\\S+\\s*$' : `^\\s*\\S+(\\s+\\S+){0,${maxWords - 1}}\\s*$`;
}

/**
 * The JSON Schema (draft-07) of a component's slot values. Key order is fixed,
 * so the output is byte-stable for the CI drift check.
 */
export function buildSchema(config) {
  const properties = {};
  const required = [];
  const viewFlags = {};
  for (const s of config.slots) {
    const prop = { type: 'string' };
    if (s.type === 'text') {
      if (s.required) prop.minLength = 1;
      prop.maxLength = s.max_length;
      if (s.max_words) prop.pattern = textPattern(s.max_words);
    } else if (s.type === 'select') {
      prop.enum = [...s.options];
      if (s.default !== undefined) prop.default = s.default;
      viewFlags[s.name] = s.options.map((o) => `${s.name}__${o}`);
    } else if (s.type === 'image') {
      prop.format = 'uri';
      prop.maxLength = IMAGE_URL_MAX;
      prop.pattern = IMAGE_URL_PATTERN;
    }
    if (s.description) prop.description = s.description;
    prop['x-dfl-slot-type'] = s.type;
    if (s.type === 'text' && s.max_words) prop['x-dfl-max-words'] = s.max_words;
    properties[s.name] = prop;
    if (s.required) required.push(s.name);
  }
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `urn:dfl-slide-templates:component:${config.id}`,
    title: `${config.name} — overlay component slots`,
    description:
      `GENERATED from config.yaml next to this file by scripts/component-format.mjs (npm run gen:component-schema). ` +
      `Do not edit by hand: CI fails when this file drifts from config.yaml. ` +
      `This is the slot contract that Lesson Studio, the studio MCP tools and the long-tutorial skill read.`,
    type: 'object',
    additionalProperties: false,
    required,
    properties,
    'x-dfl-component': {
      id: config.id,
      name: config.name,
      version: config.version,
      box: { width: config.box.width, height: config.box.height },
      anchors: [...config.anchors],
      default_anchor: config.default_anchor,
      duration_ms: config.duration_ms,
      view_flags: viewFlags,
    },
  };
}

/** The exact bytes of schema.json for a config. */
export function schemaText(config) {
  return JSON.stringify(buildSchema(config), null, 2) + '\n';
}

/**
 * The Mustache view for a component: the slot values, a select slot's default
 * when the value is absent, and for each select slot `x` with value `v` the flag
 * `x__v: true`. Every renderer (Studio, /render-view, this repository's
 * guards) builds the view this way, so `{{#type__ia}}…{{/type__ia}}` means the
 * same thing everywhere.
 */
export function componentView(config, values) {
  const view = { ...values };
  for (const s of config.slots) {
    if (s.type !== 'select') continue;
    const v = view[s.name] ?? s.default;
    if (v === undefined) continue;
    view[s.name] = v;
    if (s.options.includes(v)) view[`${s.name}__${v}`] = true;
  }
  return view;
}

export function readConfig(dir) {
  return parseYaml(readFileSync(join(dir, 'config.yaml'), 'utf8'));
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

function main(argv) {
  const check = argv.includes('--check');
  const dirs = listComponentDirs();
  if (dirs.length === 0) {
    console.error('gen:component-schema: no component directory found. Refusing a vacuous pass.');
    return 1;
  }
  let bad = 0;
  for (const dir of dirs) {
    const rel = relative(REPO_ROOT, dir);
    const id = basename(dir);
    let config;
    try {
      config = readConfig(dir);
    } catch (e) {
      console.error(`FAIL  ${rel}/config.yaml: ${e.message}`);
      bad++;
      continue;
    }
    const problems = validateConfig(config, id);
    if (problems.length) {
      bad++;
      console.error(`FAIL  ${rel}/config.yaml: ${problems.length} problem(s)`);
      for (const p of problems) console.error(`        x ${p}`);
      continue;
    }
    const want = schemaText(config);
    const path = join(dir, 'schema.json');
    const have = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (check) {
      if (have !== want) {
        bad++;
        console.error(`FAIL  ${rel}/schema.json ${have === null ? 'is missing' : 'drifts from config.yaml'}. Run: npm run gen:component-schema`);
      } else console.log(`ok    ${rel}/schema.json`);
    } else if (have !== want) {
      writeFileSync(path, want);
      console.log(`wrote ${rel}/schema.json`);
    } else console.log(`same  ${rel}/schema.json`);
  }
  if (bad) {
    console.error(`\n${bad} component(s) failed.`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}

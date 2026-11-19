/**
 * components.test.mjs — named cases for the overlay component format:
 * the safety lint (layer 1), slot value validation (layer 2 reference), the
 * schema.json generator, and the Mustache view.
 *
 * Plan 20261119-lesson-studio-overlay-components, Verification row 2 (a): a
 * component template with <script>, with onerror=, with a javascript: URL, or
 * with {{{x}}} fails check-component-safety. Each named case asserts the RULE
 * that refuses it, not only "it failed": the HTML check is an allow-list, so a
 * removed deny rule still fails the component (as `unknown-tag`), and only a
 * rule-level assertion shows that the named guard itself holds. The PR body
 * carries the mutation proof (each guard removed -> its case goes red).
 *
 * Run: npm run test:components
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { REPO_ROOT, checkComponentSafety, readComponentDir, validateSlotValues, normalizeForSchemes } from './check-component-safety.mjs';
import { buildSchema, componentView, schemaText, validateConfig } from './component-format.mjs';

const FIXTURE = join(REPO_ROOT, 'fixtures', 'components', 'fixture-chip');
const SAFETY_CLI = join(REPO_ROOT, 'scripts', 'check-component-safety.mjs');
const base = () => readComponentDir(FIXTURE);
const html = () => base().files['component.html'];
const css = () => base().files['component.css'];
const schema = () => JSON.parse(base().files['schema.json']);
const config = () => parseYaml(readFileSync(join(FIXTURE, 'config.yaml'), 'utf8'));

/** Check the fixture with some files replaced. */
function withFiles(over) {
  const c = base();
  return checkComponentSafety({ ...c, files: { ...c.files, ...over }, entries: undefined });
}
const rules = (findings) => findings.map((f) => f.rule);
const SLOT_LINE = '<span class="tpl-cmp-fixture-chip__term">{{term}}</span>';
const inject = (snippet) => html().replace(SLOT_LINE, `${SLOT_LINE}\n  ${snippet}`);

function expectRule(findings, rule) {
  assert.ok(findings.length > 0, 'the component must be refused');
  assert.ok(rules(findings).includes(rule), `expected rule "${rule}", got: ${JSON.stringify(rules(findings))}`);
}

/* ── baseline ────────────────────────────────────────────────────────────── */

test('baseline: the fixture component is safe', () => {
  assert.deepEqual(checkComponentSafety(base()), []);
});

/* ── Verification row 2 (a): the four named cases ────────────────────────── */

test('named case <script>: a component with a script element fails (forbidden-tag)', () => {
  expectRule(withFiles({ 'component.html': inject('<script>alert(1)</script>') }), 'forbidden-tag');
});

test('named case onerror=: a component with an event handler attribute fails (event-handler-attr)', () => {
  const h = html().replace('alt="{{term}}">', 'alt="{{term}}" onerror="alert(1)">');
  assert.notEqual(h, html());
  expectRule(withFiles({ 'component.html': h }), 'event-handler-attr');
});

test('named case javascript: — a component with a javascript: URL fails (dangerous-url)', () => {
  expectRule(withFiles({ 'component.html': inject('<img src="javascript:alert(1)" alt="x">') }), 'dangerous-url');
});

test('named case {{{x}}}: a component with a triple mustache fails (mustache-unescaped)', () => {
  const h = html().replace('>{{term}}</span>', '>{{{term}}}</span>');
  assert.notEqual(h, html());
  expectRule(withFiles({ 'component.html': h }), 'mustache-unescaped');
});

/* ── variants of the four, and the rest of layer 1 ───────────────────────── */

const LAYER1 = [
  ['mixed-case <ScRiPt>', { 'component.html': () => inject('<ScRiPt>alert(1)</ScRiPt>') }, 'forbidden-tag'],
  ['<iframe>', { 'component.html': () => inject('<iframe></iframe>') }, 'forbidden-tag'],
  ['<style> in the HTML', { 'component.html': () => inject('<style>.x{}</style>') }, 'forbidden-tag'],
  ['SVG <foreignObject>', { 'component.html': () => inject('<svg viewBox="0 0 1 1"><foreignObject></foreignObject></svg>') }, 'forbidden-tag'],
  ['SVG <animate> (can set href)', { 'component.html': () => inject('<svg viewBox="0 0 1 1"><animate></animate></svg>') }, 'forbidden-tag'],
  ['an element not on the allow-list', { 'component.html': () => inject('<marquee>x</marquee>') }, 'unknown-tag'],
  ['ONERROR in upper case', { 'component.html': () => html().replace('alt="{{term}}">', 'alt="{{term}}" ONERROR="alert(1)">') }, 'event-handler-attr'],
  ['onload on an svg', { 'component.html': () => html().replace('aria-hidden="true">', 'aria-hidden="true" onload="alert(1)">') }, 'event-handler-attr'],
  ['entity-encoded jav&#x61;script:', { 'component.html': () => inject('<img src="jav&#x61;script:alert(1)" alt="x">') }, 'dangerous-url'],
  ['javascript: split by a newline', { 'component.html': () => inject('<img src="java\nscript:alert(1)" alt="x">') }, 'dangerous-url'],
  ['data:text/html', { 'component.html': () => inject('<img src="data:text/html,x" alt="x">') }, 'dangerous-url'],
  ['javascript: in the CSS', { 'component.css': () => css() + '\n.tpl-root .x { background: url(javascript:alert(1)); }\n' }, 'dangerous-url'],
  ['{{&x}} (unescaped ampersand form)', { 'component.html': () => html().replace('>{{term}}</span>', '>{{&term}}</span>') }, 'mustache-unescaped'],
  ['{{=<% %>=}} (delimiter change)', { 'component.html': () => inject('{{=<% %>=}}') }, 'mustache-delimiter'],
  ['{{>partial}}', { 'component.html': () => inject('{{>evil}}') }, 'mustache-partial'],
  ['a variable that is no slot', { 'component.html': () => inject('<span>{{secret}}</span>') }, 'unknown-variable'],
  ['Mustache in attribute-name position', { 'component.html': () => inject('<span {{term}}>x</span>') }, 'mustache-in-tag'],
  ['Mustache in an unquoted attribute', { 'component.html': () => inject('<span class={{term}}>x</span>') }, 'mustache-unquoted-attr'],
  ['a slot value in a non-allowed attribute', { 'component.html': () => inject('<span id="{{term}}">x</span>') }, 'mustache-attr-not-allowed'],
  ['style= attribute', { 'component.html': () => inject('<span style="color:red">x</span>') }, 'forbidden-attr'],
  ['href= attribute', { 'component.html': () => inject('<span href="https://x">x</span>') }, 'forbidden-attr'],
  ['an attribute not on the allow-list', { 'component.html': () => inject('<span tabindex="1">x</span>') }, 'unknown-attr'],
  ['img src from a text slot', { 'component.html': () => inject('<img src="{{term}}" alt="x">') }, 'img-src'],
  ['img src built from parts', { 'component.html': () => inject('<img src="https://brand.devfellowship.com/{{term}}" alt="x">') }, 'img-src'],
  ['img src on a foreign host', { 'component.html': () => inject('<img src="https://evil.example/x.png" alt="x">') }, 'img-src'],
  ['an HTML comment', { 'component.html': () => inject('<!-- note -->') }, 'html-comment'],
  ['a raw "<" in text', { 'component.html': () => inject('<span>a < b</span>') }, 'raw-lt'],
  ['a tag split to hide <script>', { 'component.html': () => inject('<scr<script>ipt>') }, 'forbidden-tag'],
  ['an element left open', { 'component.html': () => inject('<div>') }, 'parse-error'],
  ['a duplicate attribute', { 'component.html': () => inject('<span class="a" class="b">x</span>') }, 'parse-error'],
  ['CSS @import', { 'component.css': () => '@import "https://evil.example/x.css";\n' + css() }, 'css-import'],
  ['CSS url() off the brand host', { 'component.css': () => css() + '\n.tpl-root .x { background: url(https://evil.example/x.png); }\n' }, 'css-url'],
  ['CSS selector not under .tpl-root', { 'component.css': () => css() + '\nbody { display: none; }\n' }, 'css-unscoped'],
  ['CSS .tpl-rootx prefix trick', { 'component.css': () => css() + '\n.tpl-rootx, html { display: none; }\n' }, 'css-unscoped'],
  ['CSS escape (u\\72l)', { 'component.css': () => css() + '\n.tpl-root .x { background: u\\72l(x); }\n' }, 'css-escape'],
  ['CSS expression()', { 'component.css': () => css() + '\n.tpl-root .x { width: expression(alert(1)); }\n' }, 'css-expression'],
  ['CSS </style> breakout', { 'component.css': () => css() + '\n/* </style><script>alert(1)</script> */\n' }, 'css-markup'],
  ['CSS @font-face (loads a URL)', { 'component.css': () => css() + '\n@font-face { font-family: x; }\n' }, 'css-at-rule'],
  ['Mustache in the CSS', { 'component.css': () => css() + '\n.tpl-root .x { color: {{term}}; }\n' }, 'css-mustache'],
  ['a secret-like string', { 'config.yaml': () => base().files['config.yaml'] + '\n# ghp_' + 'a'.repeat(36) + '\n' }, 'secret-like'],
  ['a sample value off the contract', { 'sample.json': () => JSON.stringify({ type: '<script>alert(1)</script>', term: 'AI SEO' }) }, 'sample'],
];

for (const [name, over, rule] of LAYER1) {
  test(`layer 1: ${name} fails (${rule})`, () => {
    const files = Object.fromEntries(Object.entries(over).map(([k, fn]) => [k, fn()]));
    expectRule(withFiles(files), rule);
  });
}

test('layer 1: a file outside the format (a .js) fails (unexpected-file)', () => {
  const c = base();
  const findings = checkComponentSafety({
    ...c,
    files: { ...c.files, 'evil.js': 'alert(1)' },
    entries: [...c.entries, { name: 'evil.js', kind: 'file' }],
  });
  expectRule(findings, 'unexpected-file');
});

test('layer 1: a missing schema.json fails closed (missing-file + schema)', () => {
  const c = base();
  const files = { ...c.files };
  delete files['schema.json'];
  const findings = checkComponentSafety({ id: c.id, files });
  expectRule(findings, 'missing-file');
  expectRule(findings, 'schema');
});

test('normalizeForSchemes decodes entities, CSS escapes and whitespace', () => {
  assert.ok(normalizeForSchemes('jav&#97;script&colon;').includes('javascript:'));
  assert.ok(normalizeForSchemes('JaVa\tScRiPt:').includes('javascript:'));
  assert.ok(normalizeForSchemes('\\6a avascript:').includes('javascript:'));
});

/* ── the CLI fails closed ────────────────────────────────────────────────── */

function cli(args) {
  return spawnSync(process.execPath, [SAFETY_CLI, ...args], { encoding: 'utf8' });
}

test('CLI: the fixture passes (exit 0)', () => {
  const r = cli([FIXTURE]);
  assert.equal(r.status, 0, r.stderr);
});

test('CLI: a copy of the fixture with <script> exits 1 and names the rule', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmp-'));
  try {
    const target = join(dir, 'fixture-chip');
    cpSync(FIXTURE, target, { recursive: true });
    writeFileSync(join(target, 'component.html'), inject('<script>alert(1)</script>'));
    const r = cli([target]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\[forbidden-tag\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: an unreadable or missing directory exits 1', () => {
  const r = cli([join(tmpdir(), 'no-such-component-dir-xyz')]);
  assert.equal(r.status, 1);
});

test('CLI: a symlinked file in a component exits 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmp-'));
  try {
    const target = join(dir, 'fixture-chip');
    cpSync(FIXTURE, target, { recursive: true });
    rmSync(join(target, 'component.css'));
    symlinkSync('/etc/hostname', join(target, 'component.css'));
    const r = cli([target]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\[unexpected-file\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ── layer 2 reference: slot values ──────────────────────────────────────── */

test('layer 2: a valid value set passes', () => {
  assert.deepEqual(validateSlotValues(schema(), { type: 'ia', term: 'AI SEO', image: 'https://media.devfellowship.com/abc.png' }), []);
  assert.deepEqual(validateSlotValues(schema(), { term: 'Stripe', image: 'https://xyz.supabase.co/storage/v1/object/public/a.png' }), []);
});

const LAYER2 = [
  ['<script> in a select slot', { type: '<script>alert(1)</script>', term: 'x' }, /must be one of/],
  ['a value off the enum', { type: 'video', term: 'x' }, /must be one of/],
  ['a non-https image', { term: 'x', image: 'http://media.devfellowship.com/a.png' }, /does not match/],
  ['an off-allowlist image', { term: 'x', image: 'https://evil.example/a.png' }, /does not match/],
  ['a javascript: image', { term: 'x', image: 'javascript:alert(1)' }, /does not match/],
  ['a host-suffix trick', { term: 'x', image: 'https://devfellowship.com.evil.example/a.png' }, /does not match/],
  ['a userinfo trick', { term: 'x', image: 'https://media.devfellowship.com@evil.example/a.png' }, /does not match/],
  ['a quote in the image URL', { term: 'x', image: 'https://media.devfellowship.com/a.png" onerror="alert(1)' }, /does not match/],
  ['a term over max_length', { term: 'x'.repeat(41) }, /longer than 40/],
  ['a term of 4 words', { term: 'one two three four' }, /does not match/],
  ['an empty term', { term: '' }, /shorter than 1/],
  ['a missing required term', { type: 'ia' }, /required/],
  ['a slot that does not exist', { term: 'x', onclick: 'alert(1)' }, /not a slot/],
  ['a non-string value', { term: { toString: 'x' } }, /must be a string/],
];

for (const [name, values, re] of LAYER2) {
  test(`layer 2: ${name} is refused`, () => {
    const problems = validateSlotValues(schema(), values);
    assert.ok(problems.some((p) => re.test(p)), `expected ${re}, got ${JSON.stringify(problems)}`);
  });
}

test('layer 2: a text value with markup is ACCEPTED (Mustache escapes it at render; check-component-render proves it shows as text)', () => {
  assert.deepEqual(validateSlotValues(schema(), { term: '<img src=x onerror=alert(1)>' }).filter((p) => !/does not match/.test(p)), []);
});

test('layer 2: the validator refuses a schema keyword it does not enforce', () => {
  const s = schema();
  s.properties.term.oneOf = [];
  assert.throws(() => validateSlotValues(s, { term: 'x' }), /not supported/);
});

/* ── the generator (ADR-6) ───────────────────────────────────────────────── */

test('generator: the committed schema.json is exactly what config.yaml generates', () => {
  assert.equal(readFileSync(join(FIXTURE, 'schema.json'), 'utf8'), schemaText(config()));
});

test('generator: the fixture config is valid', () => {
  assert.deepEqual(validateConfig(config(), 'fixture-chip'), []);
});

test('generator: the slot vocabulary matches the long-video call-out spec (6 types, short term, optional https image)', () => {
  const s = buildSchema(config());
  assert.deepEqual(s.properties.type.enum, ['conceito', 'ferramenta', 'ia', 'giria', 'codigo', 'noticia']);
  assert.equal(s.properties.type.default, 'conceito');
  assert.equal(s.properties.term['x-dfl-max-words'], 3);
  assert.equal(s.properties.image['x-dfl-slot-type'], 'image');
  assert.ok(!s.required.includes('image'));
});

const BAD_CONFIGS = [
  ['a richText slot', (c) => { c.slots[1].type = 'richText'; }, /not a component slot type/],
  ['a json slot', (c) => { c.slots[1].type = 'json'; }, /not a component slot type/],
  ['an items slot', (c) => { c.slots[1].type = 'items'; }, /not a component slot type/],
  ['a missing kind', (c) => { delete c.kind; }, /kind must be "component"/],
  ['an unknown top-level key', (c) => { c.script = 'x'; }, /unknown key "script"/],
  ['an unknown slot key', (c) => { c.slots[1].html = true; }, /unknown key "html"/],
  ['a text slot with no max_length', (c) => { delete c.slots[1].max_length; }, /max_length/],
  ['an anchor off the preset list', (c) => { c.anchors = ['center']; c.default_anchor = 'center'; }, /not one of/],
  ['default_anchor not in anchors', (c) => { c.default_anchor = 'top-left'; c.anchors = ['bottom-left']; }, /default_anchor/],
  ['an option with a dash', (c) => { c.slots[0].options = ['a-b']; c.slots[0].default = 'a-b'; c.slots[0].sample = 'a-b'; }, /must match/],
  ['a select default off its options', (c) => { c.slots[0].default = 'video'; }, /default must be one of/],
  ['a box larger than the canvas', (c) => { c.box.width = 4000; }, /box.width/],
  ['an id that differs from the directory', (c) => { c.id = 'other'; }, /directory name/],
  ['a sample off the contract', (c) => { c.slots[1].sample = 'one two three four'; }, /sample:/],
  ['a slot name with "__"', (c) => { c.slots[1].name = 'term__x'; }, /camelCase/],
];

for (const [name, mutate, re] of BAD_CONFIGS) {
  test(`generator: config with ${name} is refused`, () => {
    const c = config();
    mutate(c);
    const problems = validateConfig(c, 'fixture-chip');
    assert.ok(problems.some((p) => re.test(p)), `expected ${re}, got ${JSON.stringify(problems)}`);
  });
}

/* ── the Mustache view ───────────────────────────────────────────────────── */

test('view: a select value sets its flag, and an absent select takes its default', () => {
  const c = config();
  assert.deepEqual(componentView(c, { type: 'ia', term: 'x' }), { type: 'ia', term: 'x', type__ia: true });
  assert.deepEqual(componentView(c, { term: 'x' }), { type: 'conceito', term: 'x', type__conceito: true });
  assert.equal(componentView(c, { type: 'nope', term: 'x' }).type__nope, undefined);
});

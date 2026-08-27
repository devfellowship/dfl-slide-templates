/**
 * registry-merge.test.mjs — the regression suite for plan Gap 4.
 *
 * Run:  npm run test:registry-merge
 *
 * Dependency-free, `node`-only, same posture as
 * `.github/scripts/automerge-decide.test.mjs`: the write path into this
 * repository must not need an install step to be tested.
 *
 * The headline case is Verification criterion 8 of the plan:
 *   "Call update_template on an existing template with a version bump. Then
 *    call search_templates with that template's own when_to_use phrase and
 *    assert it still ranks first. This test FAILS on today's main."
 *
 * It is reproduced here against the REAL `registry.json`, with the ranker's
 * inputs asserted directly (this repository has no ranker — `rank.ts` lives in
 * `dfl-mcp-server`, where the same criterion is asserted against the real
 * scorer). `assertCriterion8` runs the SAME case through both writers, the old
 * one and the new one, and requires the old one to fail. A regression test
 * that cannot go red is not a regression test.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import {
  mergePatch,
  applyRegistryEntry,
  registryPatchFor,
  RegistryMergeError,
} from './registry-merge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const REGISTRY_PATH = join(REPO_ROOT, 'registry.json');
const REGISTRY_TEXT = readFileSync(REGISTRY_PATH, 'utf8');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push({ name, err });
  }
}

/* ─────────────────────────────────────────────── the old writer, verbatim ── */

/**
 * `publish-template/index.ts` as it stood on `main` before this change. Kept
 * so the suite can PROVE the defect instead of describing it. Do not "fix" it.
 */
function legacyWriter(registryText, arrayKey, entry) {
  const registry = JSON.parse(registryText);
  const list = registry[arrayKey] ?? [];
  const idx = list.findIndex((t) => t.id === entry.id);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  registry[arrayKey] = list;
  return JSON.stringify(registry, null, 2) + '\n';
}

function entryFor(text, arrayKey, id) {
  return JSON.parse(text)[arrayKey].find((t) => t.id === id);
}

/* ───────────────────────────────────────────────────────── mergePatch ── */

test('mergePatch preserves a key the patch omits', () => {
  const out = mergePatch({ a: 1, b: 2 }, { a: 9 });
  assert.deepEqual(out, { a: 9, b: 2 });
});

test('mergePatch deletes a key the patch sets to null', () => {
  const out = mergePatch({ a: 1, b: 2 }, { b: null });
  assert.deepEqual(out, { a: 1 });
  assert.equal('b' in out, false);
});

test('mergePatch replaces an array wholesale, never element-wise', () => {
  const out = mergePatch({ tags: ['a', 'b', 'c'] }, { tags: ['z'] });
  assert.deepEqual(out, { tags: ['z'] });
});

test('mergePatch recurses into a nested object', () => {
  const out = mergePatch({ n: { keep: 1, drop: 2 } }, { n: { drop: null, add: 3 } });
  assert.deepEqual(out, { n: { keep: 1, add: 3 } });
});

test('mergePatch keeps the target key ORDER and appends new keys', () => {
  const out = mergePatch({ id: 'x', version: '1', category: 'c' }, { version: '2', tags: ['t'] });
  assert.deepEqual(Object.keys(out), ['id', 'version', 'category', 'tags']);
});

/* ──────────────────────────────────────────── criterion 8 — red vs green ── */

/**
 * The exact call `update_template` makes today when a caller bumps a version:
 * three fields, nothing else.
 */
const VERSION_BUMP = { id: 'title', version: '1.1.0', category: 'content' };

/** Everything `dfl-mcp-studio:rank.ts` scores on. */
const RANKED_FIELDS = ['name', 'when_to_use', 'media_profile', 'tags', 'layout', 'category'];

function assertCriterion8(writer) {
  const before = entryFor(REGISTRY_TEXT, 'templates', 'title');
  const text = writer(REGISTRY_TEXT, 'templates', VERSION_BUMP);
  const after = entryFor(text, 'templates', 'title');
  assert.equal(after.version, '1.1.0', 'the version bump must land');
  for (const field of RANKED_FIELDS) {
    assert.deepEqual(
      after[field],
      before[field],
      `rank.ts scores on '${field}' and the version bump changed it`,
    );
  }
}

test("criterion 8 — the OLD writer LOSES the ranked metadata (this is the defect)", () => {
  let threw = null;
  try {
    assertCriterion8(legacyWriter);
  } catch (err) {
    threw = err;
  }
  assert.ok(
    threw,
    'the old full-replacement writer passed criterion 8, which means this suite is asserting nothing',
  );
  assert.match(String(threw.message), /rank\.ts scores on/);
});

test('criterion 8 — the NEW writer keeps every field rank.ts scores on', () => {
  assertCriterion8((text, key, entry) => applyRegistryEntry(text, key, entry).text);
});

test("criterion 8 — the template's own when_to_use phrase still has tokens to match", () => {
  const before = entryFor(REGISTRY_TEXT, 'templates', 'title');
  const { text } = applyRegistryEntry(REGISTRY_TEXT, 'templates', VERSION_BUMP);
  const after = entryFor(text, 'templates', 'title');
  // rank.ts tokenises when_to_use / tags / name. If any of them is gone the
  // template scores 0 for its own phrase and drops out of the shortlist.
  assert.ok(before.when_to_use.length > 0);
  assert.equal(after.when_to_use, before.when_to_use);
  assert.ok(Array.isArray(after.tags) && after.tags.length > 0);
});

/* ─────────────────────────────────────────── formatting + ordering ── */

test('the templates[] section of registry.json is exactly JSON.stringify(_, null, 2)', () => {
  // The whole surgical strategy rests on this: a re-encoded entry whose values
  // did not change is byte-identical to the one it replaced.
  const restringified = JSON.stringify(JSON.parse(REGISTRY_TEXT), null, 2) + '\n';
  const a = REGISTRY_TEXT.indexOf('"templates"');
  const b = restringified.indexOf('"templates"');
  assert.equal(REGISTRY_TEXT.slice(a), restringified.slice(b));
});

test('a no-op write returns the document byte-identical', () => {
  const current = entryFor(REGISTRY_TEXT, 'templates', 'title');
  const res = applyRegistryEntry(REGISTRY_TEXT, 'templates', {
    id: 'title',
    version: current.version,
    category: current.category,
  });
  assert.equal(res.action, 'unchanged');
  assert.equal(res.text, REGISTRY_TEXT);
});

test('a one-entry change touches ONLY that entry — one line in the whole file', () => {
  const { text } = applyRegistryEntry(REGISTRY_TEXT, 'templates', VERSION_BUMP);
  const before = REGISTRY_TEXT.split('\n');
  const after = text.split('\n');
  assert.equal(after.length, before.length, 'the line count must not move');
  const changed = before.map((l, i) => (l === after[i] ? null : i)).filter((i) => i !== null);
  assert.deepEqual(changed.length, 1, `expected 1 changed line, got ${changed.length}`);
  assert.match(after[changed[0]], /"version": "1\.1\.0"/);
});

test('the hand-aligned themes[] block is NOT reformatted by a template write', () => {
  const themesBlock = (t) => t.slice(t.indexOf('"themes"'), t.indexOf('"templates"'));
  const { text } = applyRegistryEntry(REGISTRY_TEXT, 'templates', VERSION_BUMP);
  assert.equal(themesBlock(text), themesBlock(REGISTRY_TEXT));
});

test('the OLD writer DID reformat the themes[] block on every template write', () => {
  // Recorded so the second, quieter half of the defect cannot come back
  // unnoticed: 4 hand-aligned lines became 24 on every publish.
  const themesBlock = (t) => t.slice(t.indexOf('"themes"'), t.indexOf('"templates"'));
  const text = legacyWriter(REGISTRY_TEXT, 'templates', VERSION_BUMP);
  assert.notEqual(themesBlock(text), themesBlock(REGISTRY_TEXT));
});

test('entry order is preserved exactly', () => {
  const ids = (t) => JSON.parse(t).templates.map((x) => x.id);
  const { text } = applyRegistryEntry(REGISTRY_TEXT, 'templates', VERSION_BUMP);
  assert.deepEqual(ids(text), ids(REGISTRY_TEXT));
});

test('a NEW template is appended at the END, after every existing entry', () => {
  const { text, action } = applyRegistryEntry(REGISTRY_TEXT, 'templates', {
    id: 'brand-new-thing',
    version: '1.0.0',
    category: 'content',
    name: 'Brand New Thing',
    when_to_use: 'When a brand new thing is needed.',
    media_profile: 'text-heavy',
    tags: ['new'],
  });
  assert.equal(action, 'created');
  const idsBefore = JSON.parse(REGISTRY_TEXT).templates.map((x) => x.id);
  const idsAfter = JSON.parse(text).templates.map((x) => x.id);
  assert.deepEqual(idsAfter, [...idsBefore, 'brand-new-thing']);
});

test('the whole file is unchanged above the appended entry', () => {
  const { text } = applyRegistryEntry(REGISTRY_TEXT, 'templates', {
    id: 'brand-new-thing',
    version: '1.0.0',
    category: 'content',
    name: 'Brand New Thing',
    when_to_use: 'When a brand new thing is needed.',
    media_profile: 'text-heavy',
    tags: ['new'],
  });
  const before = REGISTRY_TEXT.split('\n');
  const after = text.split('\n');
  // The first divergence must be the previous last entry's closing brace,
  // which gains a comma. Everything above it is byte-identical.
  let i = 0;
  while (i < before.length && before[i] === after[i]) i++;
  assert.equal(before[i], '    }');
  assert.equal(after[i], '    },');
  assert.deepEqual(before.slice(0, i), after.slice(0, i));
  // And everything BELOW the inserted block is byte-identical too, so the
  // whole diff is one comma plus the appended entry.
  const grown = after.length - before.length;
  assert.deepEqual(after.slice(i + 1 + grown), before.slice(i + 1));
});

/* ───────────────────────────────────────────────────── unknown keys ── */

test('an unknown key inside the TARGET entry survives the merge', () => {
  const seeded = REGISTRY_TEXT.replace(
    '"id": "title",\n      "version"',
    '"id": "title",\n      "future_field": { "nested": [1, 2] },\n      "version"',
  );
  assert.notEqual(seeded, REGISTRY_TEXT, 'the fixture seed must apply');
  const { text } = applyRegistryEntry(seeded, 'templates', VERSION_BUMP);
  assert.deepEqual(entryFor(text, 'templates', 'title').future_field, { nested: [1, 2] });
});

test('an unknown TOP-LEVEL registry key survives the merge', () => {
  const seeded = REGISTRY_TEXT.replace('{\n  "$schema_version"', '{\n  "future_top": 42,\n  "$schema_version"');
  const { text } = applyRegistryEntry(seeded, 'templates', VERSION_BUMP);
  assert.equal(JSON.parse(text).future_top, 42);
  assert.ok(text.includes('"future_top": 42'));
});

test('an unknown key inside ANOTHER entry survives untouched', () => {
  const seeded = REGISTRY_TEXT.replace(
    '"id": "quote",',
    '"id": "quote",\n      "future_field": "kept",',
  );
  assert.notEqual(seeded, REGISTRY_TEXT, 'the fixture seed must apply');
  const { text } = applyRegistryEntry(seeded, 'templates', VERSION_BUMP);
  assert.equal(entryFor(text, 'templates', 'quote').future_field, 'kept');
});

/* ────────────────────────────────────────────── deletion semantics ── */

test('an omitted field is PRESERVED (this is the fix)', () => {
  const { text } = applyRegistryEntry(REGISTRY_TEXT, 'templates', VERSION_BUMP);
  assert.ok(entryFor(text, 'templates', 'title').when_to_use);
});

test('an explicit null DELETES the field, and only that field', () => {
  const before = entryFor(REGISTRY_TEXT, 'templates', 'title');
  const { text, action } = applyRegistryEntry(REGISTRY_TEXT, 'templates', {
    id: 'title',
    avoid_when: null,
  });
  assert.equal(action, 'updated');
  const after = entryFor(text, 'templates', 'title');
  assert.equal('avoid_when' in after, false);
  assert.equal(after.when_to_use, before.when_to_use);
  assert.equal(after.version, before.version);
});

test('an empty string is a VALUE, not a deletion — it is written as given', () => {
  // Stated explicitly so nobody later "helpfully" treats '' as a clear. The
  // registry-no-metadata-loss gate refuses an emptied field, which is the
  // layer that decides whether such a diff may merge.
  const { text } = applyRegistryEntry(REGISTRY_TEXT, 'templates', { id: 'title', layout: '' });
  assert.equal(entryFor(text, 'templates', 'title').layout, '');
});

/* ──────────────────────────────────────────────────── themes[] ── */

test('an EXISTING theme re-registers as a no-op', () => {
  const res = applyRegistryEntry(REGISTRY_TEXT, 'themes', {
    id: 'itera',
    file: 'themes/itera.css',
  });
  assert.equal(res.action, 'unchanged');
  assert.equal(res.text, REGISTRY_TEXT);
});

test('an existing theme keeps its name and mode when only the file is sent', () => {
  const { text } = applyRegistryEntry(REGISTRY_TEXT, 'themes', {
    id: 'itera',
    file: 'themes/itera.css',
    mode: 'light',
  });
  const t = JSON.parse(text).themes.find((x) => x.id === 'itera');
  assert.equal(t.name, 'Itera', 'the display name must survive');
  assert.equal(t.mode, 'light');
});

test('a NEW theme is appended on ONE line, in the array style already used', () => {
  const { text, action } = applyRegistryEntry(REGISTRY_TEXT, 'themes', {
    id: 'acme',
    name: 'Acme',
    file: 'themes/acme.css',
    mode: 'dark',
  });
  assert.equal(action, 'created');
  const added = text.split('\n').filter((l) => !REGISTRY_TEXT.split('\n').includes(l));
  assert.ok(
    added.some((l) => l.includes('"id": "acme"') && l.includes('"mode": "dark"')),
    'the new theme must occupy a single line',
  );
  assert.equal(text.split('\n').length, REGISTRY_TEXT.split('\n').length + 1);
  assert.deepEqual(
    JSON.parse(text).themes.map((t) => t.id),
    [...JSON.parse(REGISTRY_TEXT).themes.map((t) => t.id), 'acme'],
  );
});

test('a NEW theme without a name or a mode is REFUSED, never guessed', () => {
  assert.throws(
    () => applyRegistryEntry(REGISTRY_TEXT, 'themes', { id: 'acme', file: 'themes/acme.css' }),
    (err) => err instanceof RegistryMergeError && /name, mode/.test(err.message),
  );
});

test('a template write does not touch themes[], and a theme write does not touch templates[]', () => {
  const templatesBlock = (t) => t.slice(t.indexOf('"templates"'));
  const { text } = applyRegistryEntry(REGISTRY_TEXT, 'themes', {
    id: 'acme',
    name: 'Acme',
    file: 'themes/acme.css',
    mode: 'dark',
  });
  assert.equal(templatesBlock(text), templatesBlock(REGISTRY_TEXT));
});

/* ─────────────────────────────────────────────── registryPatchFor ── */

test('a theme publish ALWAYS registers, even with no registryEntry at all', () => {
  // This is the second Gap 4 instance: `update_theme` sent no registryEntry,
  // so the old code never touched registry.json and the theme stayed out of
  // the catalogue `list_themes` reads.
  const target = registryPatchFor('theme', 'itera', undefined);
  assert.equal(target.arrayKey, 'themes');
  assert.deepEqual(target.patch, { id: 'itera', file: 'themes/itera.css' });
});

test('a theme entry file is DERIVED, never taken from the caller', () => {
  const target = registryPatchFor('theme', 'itera', { file: 'themes/somewhere-else.css' });
  assert.equal(target.patch.file, 'themes/itera.css');
});

test('a theme publish carries the name and mode the caller sent', () => {
  const target = registryPatchFor('theme', 'acme', { name: 'Acme', mode: 'dark' });
  assert.deepEqual(target.patch, {
    name: 'Acme',
    mode: 'dark',
    id: 'acme',
    file: 'themes/acme.css',
  });
});

test('a template publish with no registryEntry leaves registry.json alone', () => {
  assert.equal(registryPatchFor('template', 'title', undefined), null);
});

test('a template patch id always comes from the request id, not the entry body', () => {
  const target = registryPatchFor('template', 'title', { id: 'something-else', version: '2' });
  assert.equal(target.arrayKey, 'templates');
  assert.equal(target.patch.id, 'title');
});

test('end to end: update_theme on an existing theme is a complete no-op', () => {
  const target = registryPatchFor('theme', 'itera', undefined);
  const res = applyRegistryEntry(REGISTRY_TEXT, target.arrayKey, target.patch);
  assert.equal(res.action, 'unchanged');
  assert.equal(res.text, REGISTRY_TEXT);
});

test('end to end: update_theme on a brand-new theme registers it in themes[]', () => {
  const target = registryPatchFor('theme', 'acme', { name: 'Acme', mode: 'dark' });
  const res = applyRegistryEntry(REGISTRY_TEXT, target.arrayKey, target.patch);
  assert.equal(res.action, 'created');
  const added = JSON.parse(res.text).themes.at(-1);
  assert.deepEqual(added, { name: 'Acme', mode: 'dark', id: 'acme', file: 'themes/acme.css' });
});

test('a multi-byte character survives the round trip through the merge', () => {
  // registry.json is full of em-dashes. The old code read the file with a
  // byte-wise `atob` and re-encoded it as UTF-8, which turned every one of
  // them into mojibake on EVERY publish. This asserts the merged text still
  // holds the real characters.
  assert.ok(REGISTRY_TEXT.includes('\u2014'), 'the fixture must contain an em-dash');
  const { text } = applyRegistryEntry(REGISTRY_TEXT, 'templates', VERSION_BUMP);
  assert.equal(
    (text.match(/\u2014/g) || []).length,
    (REGISTRY_TEXT.match(/\u2014/g) || []).length,
  );
  assert.equal(text.includes('\u00e2\u0080\u0094'), false, 'no mojibake');
});

/* ─────────────────────────────────────────────────── fail closed ── */

test('a missing array is refused, not created', () => {
  assert.throws(
    () => applyRegistryEntry('{\n  "templates": []\n}\n', 'themes', { id: 'a', name: 'A', file: 'f', mode: 'dark' }),
    (err) => err instanceof RegistryMergeError && /no top-level "themes" array/.test(err.message),
  );
});

test('an entry with no id is refused', () => {
  assert.throws(
    () => applyRegistryEntry(REGISTRY_TEXT, 'templates', { version: '2.0.0' }),
    (err) => err instanceof RegistryMergeError && /non-empty string id/.test(err.message),
  );
});

test('a duplicated id is refused rather than half-written', () => {
  const dupe = REGISTRY_TEXT.replace(
    '"templates": [\n    {\n      "id": "title",',
    '"templates": [\n    {\n      "id": "title",\n      "dupe_marker": true,',
  ).replace(
    '  "templates": [\n',
    '  "templates": [\n    { "id": "title", "version": "0.0.1", "category": "content" },\n',
  );
  assert.throws(
    () => applyRegistryEntry(dupe, 'templates', VERSION_BUMP),
    (err) => err instanceof RegistryMergeError && /2 times/.test(err.message),
  );
});

test('a new template with no discoverability metadata WARNS but still writes', () => {
  const res = applyRegistryEntry(REGISTRY_TEXT, 'templates', {
    id: 'thin-one',
    version: '1.0.0',
    category: 'content',
  });
  assert.equal(res.action, 'created');
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /search_templates cannot rank it/);
});

test('an empty array accepts its first entry without reformatting the document', () => {
  const doc = '{\n  "keep": 1,\n  "themes": [],\n  "tail": 2\n}\n';
  const { text, action } = applyRegistryEntry(doc, 'themes', {
    id: 'a',
    name: 'A',
    file: 'themes/a.css',
    mode: 'dark',
  });
  assert.equal(action, 'created');
  assert.deepEqual(JSON.parse(text), {
    keep: 1,
    themes: [{ id: 'a', name: 'A', file: 'themes/a.css', mode: 'dark' }],
    tail: 2,
  });
  assert.ok(text.startsWith('{\n  "keep": 1,\n'));
  assert.ok(text.endsWith('  "tail": 2\n}\n'));
});

test('a string holding a brace or a bracket does not confuse the scanner', () => {
  const doc =
    '{\n  "templates": [\n    {\n      "id": "a",\n      "version": "1",\n      "category": "c",\n      "layout": "a } weird [ \\" string"\n    }\n  ]\n}\n';
  const { text } = applyRegistryEntry(doc, 'templates', { id: 'a', version: '2' });
  const e = JSON.parse(text).templates[0];
  assert.equal(e.version, '2');
  assert.equal(e.layout, 'a } weird [ " string');
});

/* ──────────────────────────────────────────────────────── report ── */

console.log(`registry-merge: ${passed} passed, ${failures.length} failed`);
for (const f of failures) {
  console.error(`\n  ✗ ${f.name}\n    ${f.err && f.err.message}`);
}
process.exit(failures.length ? 1 : 0);

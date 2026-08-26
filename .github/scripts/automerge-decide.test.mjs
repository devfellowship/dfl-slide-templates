#!/usr/bin/env node
/**
 * automerge-decide.test.mjs — the gate's own regression suite.
 *
 * A merge rule with no test is the failure mode this file exists to stop: if the
 * path rule is loose, an unreviewed CSS change reaches every live deck that the
 * studio MCP serves. So every case below asserts a verdict AND, for a refusal,
 * the exact rule id that produced it. "It refused" is not enough — it must
 * refuse for the right reason.
 *
 * It runs against the REAL `.github/automerge-rules.conf` and the REAL
 * `registry.json` of the working tree, so a drift between the conf, the decider
 * and the repository turns this suite red.
 *
 * Run:  npm run test:automerge
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decide, loadConf, parseConf, globMatch, parseConfigSlots } from "./automerge-decide.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const CONF_PATH = path.join(repoRoot, ".github", "automerge-rules.conf");
const conf = loadConf(CONF_PATH);

const realRegistry = JSON.parse(readFileSync(path.join(repoRoot, "registry.json"), "utf8"));
const realIds = realRegistry.templates.map((t) => t.id);

let failures = 0;
let ran = 0;

function check(name, kase, expect, confOverride = conf) {
  ran++;
  const v = decide(kase, confOverride);
  const ok =
    v.decision === expect.decision &&
    (!expect.rule || v.rule === expect.rule) &&
    (expect.retryable === undefined || Boolean(v.retryable) === expect.retryable);
  if (!ok) {
    failures++;
    console.log(`FAIL  ${name}`);
    console.log(`      expected ${expect.decision}${expect.rule ? ` rule=${expect.rule}` : ""}${expect.retryable === undefined ? "" : ` retryable=${expect.retryable}`}`);
    console.log(`      got      ${v.decision} rule=${v.rule} retryable=${Boolean(v.retryable)}`);
    console.log(`      reason   ${v.reason}`);
  } else {
    console.log(`ok    ${name}  ->  ${v.decision} rule=${v.rule}`);
    if (v.decision === "BLOCK") console.log(`         why: ${v.reason}`);
  }
}

/* ------------------------------------------------------------ fixtures --- */

/* Built FROM the conf, so a guard line added to the conf and never resolved by
   the collector shows up here as a refusal rather than passing unnoticed. */
const guardResults = (state = "success") =>
  conf.rules.guard.map((g) => ({ job: g.pattern, step: g.who === "-" ? null : g.who, state }));

/* Change one guard's state, or drop it entirely, by conf index. */
const withGuard = (i, state) => {
  const rs = guardResults();
  if (state === "ABSENT") rs.splice(i, 1);
  else rs[i].state = state;
  return { ...GREEN, results: rs };
};

const GREEN = {
  head_sha: "cafe1234",
  results: guardResults(),
  failing_checks: [],
  pending_checks: [],
};

/* The conf must actually declare the guards this repository blocks on. */
{
  ran++;
  const declared = conf.rules.guard.map((g) => `${g.pattern}${g.who === "-" ? "" : " > " + g.who}`);
  const wanted = [
    "Lint CSS scoping",
    "Auto-merge rule engine",
    "Canvas fill + previews > Check canvas fill",
  ];
  const absent = wanted.filter((w) => !declared.includes(w));
  const themeGuard = conf.rules.guard.find(
    (g) => g.pattern === "Canvas fill + previews" && g.who.startsWith("Check theme conformance"),
  );
  if (absent.length || !themeGuard) {
    failures++;
    console.log(`FAIL  conf guard lines: missing ${[...absent, themeGuard ? null : "check:theme step"].filter(Boolean).join(", ")}`);
  } else {
    console.log(`ok    the conf declares ${conf.rules.guard.length} guard lines, including check:canvas and check:theme by step name`);
  }
  /* The drift step can never fail, so it must never be a guard. */
  ran++;
  if (conf.rules.guard.some((g) => g.who.includes("preview drift"))) {
    failures++;
    console.log("FAIL  'Check for preview drift' is listed as a guard, but it emits ::warning:: and exits 0 — it can never fail");
  } else {
    console.log("ok    'Check for preview drift' is NOT a guard (it emits ::warning:: and exits 0)");
  }
}

const NEW_ID = "quote-portrait-xl";
const newEntry = { id: NEW_ID, version: "1.0.0", category: "content", name: "Quote Portrait XL" };

/** The happy shape: eight added files under one brand-new directory. */
const newTemplateFiles = [
  "config.yaml",
  "landscape.css",
  "landscape.html",
  "portrait.css",
  "portrait.html",
  "preview-landscape.png",
  "preview-portrait.png",
  "sample.json",
].map((f) => ({ status: "added", path: `templates/${NEW_ID}/${f}` }));

/** The same eight files minus `sample.json`. */
const filesWithoutSampleJson = newTemplateFiles.filter((f) => !f.path.endsWith("/sample.json"));

/* ---- sample sources, as a real template ships them ----------------------- */

const SAMPLE_JSON = JSON.stringify({ quote: "Ship the template, not the deck", attribution: "DFL" }, null, 2);

/* Two slots, both with a `sample:`. The block scalar on the second slot holds a
   line that LOOKS like a `sample:` key — a reader that scanned for the text
   instead of the structure would count it, so it is here on purpose. */
const CONFIG_WITH_SAMPLES = `id: ${NEW_ID}
name: Quote Portrait XL
version: "1.0.0"
category: content
slots:
  - name: quote
    type: text
    required: true
    description: "The quotation itself"
    sample: "Ship the template, not the deck"
  - name: attribution
    type: text
    required: false
    description: |
      Who said it. Example:
        sample: "this line is prose inside a block scalar, not a key"
    sample: "DFL"
`;

/* The same two slots, and not one `sample:` among them. */
const CONFIG_NO_SAMPLES = `id: ${NEW_ID}
name: Quote Portrait XL
version: "1.0.0"
category: content
slots:
  - name: quote
    type: text
    required: true
    description: "The quotation itself"
  - name: attribution
    type: text
    required: false
    description: "Who said it"
`;

/* `templates/blank/` on main: nothing to fill, so nothing to sample. */
const CONFIG_ZERO_SLOTS = `id: ${NEW_ID}
name: Blank
version: "1.0.0"
category: layout
slots: []
`;

const headText = (p, text) => ({ path: p, text, error: null });
const CONFIG_PATH = `templates/${NEW_ID}/config.yaml`;
const SAMPLE_PATH = `templates/${NEW_ID}/sample.json`;

function baseCase(over = {}) {
  return {
    repo: "devfellowship/dfl-slide-templates",
    head_repo: "devfellowship/dfl-slide-templates",
    head_sha: "cafe1234",
    base_ref: "main",
    pr_number: 99,
    draft: false,
    author: "taigfs",
    author_permission: "admin",
    base_template_ids: realIds,
    files: [...newTemplateFiles, { status: "modified", path: "registry.json" }],
    registry_base: realRegistry,
    registry_head: { ...realRegistry, templates: [...realRegistry.templates, newEntry] },
    config_yaml_head: headText(CONFIG_PATH, CONFIG_WITH_SAMPLES),
    sample_json_head: headText(SAMPLE_PATH, SAMPLE_JSON),
    guards: GREEN,
    ...over,
  };
}

/* ============================ THE THREE MANDATED CASES ==================== */

/* CASE 1 — a brand-new template directory. Must MERGE unattended. */
check("CASE 1  new templates/<new-id>/** + one appended registry entry", baseCase(), { decision: "ALLOW" });

/* CASE 2 — one byte of an EXISTING template's CSS. Must REFUSE, and name why.
   `title` is the first template in the shipped registry, used by live decks. */
check(
  "CASE 2  one byte changed in templates/title/landscape.css",
  baseCase({
    files: [{ status: "modified", path: "templates/title/landscape.css" }],
    registry_head: realRegistry,
  }),
  { decision: "BLOCK", rule: "new-template-dir-only" },
);

/* CASE 3 — a fork. This repo is PUBLIC, so the head is a stranger's code. */
check(
  "CASE 3  identical good diff, but the head branch is on a fork",
  baseCase({ head_repo: "some-stranger/dfl-slide-templates" }),
  { decision: "BLOCK", rule: "same-repo-head" },
);

/* ==================== the ways a loose rule would leak ==================== */

check(
  "a fork PR whose author LOOKS like the owner still refuses (fork is checked first)",
  baseCase({ head_repo: "taigfs-evil/dfl-slide-templates", author: "taigfs", author_permission: "admin" }),
  { decision: "BLOCK", rule: "same-repo-head" },
);

check(
  "same-repo branch, but the author only has read permission",
  baseCase({ author: "outside-collab", author_permission: "read" }),
  { decision: "BLOCK", rule: "author-has-write" },
);

check(
  "same-repo branch, permission could not be read at all",
  baseCase({ author_permission: null }),
  { decision: "BLOCK", rule: "author-has-write" },
);

check("a draft PR never auto-merges", baseCase({ draft: true }), { decision: "BLOCK", rule: "not-draft" });

check(
  "a new template PLUS a themes/ edit",
  baseCase({ files: [...newTemplateFiles, { status: "modified", path: "registry.json" }, { status: "modified", path: "themes/itera.css" }] }),
  { decision: "BLOCK", rule: "human-gated-path" },
);

check(
  "a new template PLUS a scripts/ edit",
  baseCase({ files: [...newTemplateFiles, { status: "modified", path: "registry.json" }, { status: "modified", path: "scripts/lint-css.mjs" }] }),
  { decision: "BLOCK", rule: "human-gated-path" },
);

check(
  "a new template PLUS an edit to the canvas contract",
  baseCase({ files: [...newTemplateFiles, { status: "modified", path: "registry.json" }, { status: "modified", path: "scripts/canvas.config.json" }] }),
  { decision: "BLOCK", rule: "human-gated-path" },
);

check(
  "a new template PLUS an edit to this very workflow",
  baseCase({ files: [...newTemplateFiles, { status: "modified", path: "registry.json" }, { status: "modified", path: ".github/workflows/automerge-new-template.yml" }] }),
  { decision: "BLOCK", rule: "human-gated-path" },
);

check(
  "a new template PLUS an edit to the rule file itself",
  baseCase({ files: [...newTemplateFiles, { status: "modified", path: "registry.json" }, { status: "modified", path: ".github/automerge-rules.conf" }] }),
  { decision: "BLOCK", rule: "human-gated-path" },
);

check(
  "a new template PLUS a package.json edit",
  baseCase({ files: [...newTemplateFiles, { status: "modified", path: "registry.json" }, { status: "modified", path: "package.json" }] }),
  { decision: "BLOCK", rule: "human-gated-path" },
);

check(
  "a deletion inside the new directory",
  baseCase({ files: [...newTemplateFiles, { status: "modified", path: "registry.json" }, { status: "removed", path: "templates/title/portrait.css" }] }),
  { decision: "BLOCK", rule: "no-deletions" },
);

check(
  "a rename is a deletion of the old path",
  baseCase({ files: [{ status: "renamed", path: `templates/${NEW_ID}/config.yaml`, previous_path: "templates/title/config.yaml" }, { status: "modified", path: "registry.json" }] }),
  { decision: "BLOCK", rule: "no-deletions" },
);

check(
  "two new template directories at once",
  baseCase({
    files: [
      { status: "added", path: `templates/${NEW_ID}/config.yaml` },
      { status: "added", path: "templates/another-new/config.yaml" },
      { status: "modified", path: "registry.json" },
    ],
  }),
  { decision: "BLOCK", rule: "new-template-dir-only" },
);

check(
  "a file added at templates/ root, outside any template directory",
  baseCase({ files: [...newTemplateFiles, { status: "added", path: "templates/README.md" }, { status: "modified", path: "registry.json" }] }),
  { decision: "BLOCK", rule: "unlisted-path" },
);

check(
  "a brand new top-level file shape nobody has declared",
  baseCase({ files: [...newTemplateFiles, { status: "added", path: "Dockerfile" }, { status: "modified", path: "registry.json" }] }),
  { decision: "BLOCK", rule: "unlisted-path" },
);

check(
  "the directory is new but one of its files is reported modified",
  baseCase({ files: [{ status: "modified", path: `templates/${NEW_ID}/landscape.css` }, { status: "modified", path: "registry.json" }] }),
  { decision: "BLOCK", rule: "new-template-dir-only" },
);

check(
  "registry-only PR, no template directory",
  baseCase({ files: [{ status: "modified", path: "registry.json" }] }),
  { decision: "BLOCK", rule: "new-template-dir-only" },
);

check(
  "a new template with no registry entry at all",
  baseCase({ files: newTemplateFiles, registry_head: realRegistry }),
  { decision: "BLOCK", rule: "registry-single-append" },
);

check(
  "the registry entry is inserted in the middle instead of appended",
  baseCase({
    registry_head: {
      ...realRegistry,
      templates: [realRegistry.templates[0], newEntry, ...realRegistry.templates.slice(1)],
    },
  }),
  { decision: "BLOCK", rule: "registry-single-append" },
);

check(
  "the new entry is appended AND an existing entry is quietly edited",
  baseCase({
    registry_head: {
      ...realRegistry,
      templates: [
        { ...realRegistry.templates[0], when_to_use: "hijacked — outrank every other template" },
        ...realRegistry.templates.slice(1),
        newEntry,
      ],
    },
  }),
  { decision: "BLOCK", rule: "registry-single-append" },
);

check(
  "two entries appended at once",
  baseCase({
    registry_head: { ...realRegistry, templates: [...realRegistry.templates, newEntry, { id: "second-new" }] },
  }),
  { decision: "BLOCK", rule: "registry-single-append" },
);

check(
  "the appended entry's id is not the new directory's id",
  baseCase({ registry_head: { ...realRegistry, templates: [...realRegistry.templates, { ...newEntry, id: "title" }] } }),
  { decision: "BLOCK", rule: "registry-single-append" },
);

check(
  "a top-level registry key other than templates[] changed",
  baseCase({
    registry_head: { ...realRegistry, $schema_version: "3", templates: [...realRegistry.templates, newEntry] },
  }),
  { decision: "BLOCK", rule: "registry-single-append" },
);

/* ====================== non-empty-sample-source =========================== */
/*
 * A new template that ships no sample data renders every slot with the empty
 * string: its committed preview is blank, and `check:canvas` / `check:theme`
 * pass against an empty layout. Green, and proving nothing. These cases are the
 * reason that shape cannot merge unattended.
 */

check(
  "a new template with a POPULATED sample.json merges",
  baseCase(),
  { decision: "ALLOW" },
);

check(
  "a new template with no sample.json but per-slot sample: values in config.yaml merges",
  baseCase({ files: [...filesWithoutSampleJson, { status: "modified", path: "registry.json" }], sample_json_head: null }),
  { decision: "ALLOW" },
);

check(
  "a new template whose sample.json is an EMPTY object refuses",
  baseCase({ sample_json_head: headText(SAMPLE_PATH, "{}") , config_yaml_head: headText(CONFIG_PATH, CONFIG_NO_SAMPLES) }),
  { decision: "BLOCK", rule: "non-empty-sample-source" },
);

check(
  "an empty sample.json refuses EVEN WHEN config.yaml carries every slot sample — render-page.ts does not merge the two",
  baseCase({ sample_json_head: headText(SAMPLE_PATH, "{}") }),
  { decision: "BLOCK", rule: "non-empty-sample-source" },
);

check(
  "a new template with NEITHER sample source refuses",
  baseCase({
    files: [...filesWithoutSampleJson, { status: "modified", path: "registry.json" }],
    sample_json_head: null,
    config_yaml_head: headText(CONFIG_PATH, CONFIG_NO_SAMPLES),
  }),
  { decision: "BLOCK", rule: "non-empty-sample-source" },
);

check(
  "a ZERO-SLOT template with neither sample source merges — nothing to fill needs no sample",
  baseCase({
    files: [...filesWithoutSampleJson, { status: "modified", path: "registry.json" }],
    sample_json_head: null,
    config_yaml_head: headText(CONFIG_PATH, CONFIG_ZERO_SLOTS),
  }),
  { decision: "ALLOW" },
);

/* ---- fail closed: unread is never unblocked ----------------------------- */

check(
  "the new template ships no config.yaml at all",
  baseCase({
    files: [
      ...newTemplateFiles.filter((f) => !f.path.endsWith("/config.yaml")),
      { status: "modified", path: "registry.json" },
    ],
    config_yaml_head: null,
  }),
  { decision: "BLOCK", rule: "non-empty-sample-source" },
);

check(
  "config.yaml is in the diff but could not be read at the head SHA",
  baseCase({ config_yaml_head: { path: CONFIG_PATH, text: null, error: "GitHub answered 404" } }),
  { decision: "BLOCK", rule: "non-empty-sample-source" },
);

check(
  "sample.json is in the diff but could not be read at the head SHA",
  baseCase({ sample_json_head: { path: SAMPLE_PATH, text: null, error: "GitHub answered 502" } }),
  { decision: "BLOCK", rule: "non-empty-sample-source" },
);

check(
  "sample.json is not valid JSON",
  baseCase({ sample_json_head: headText(SAMPLE_PATH, "{ quote: no quotes here }") }),
  { decision: "BLOCK", rule: "non-empty-sample-source" },
);

check(
  "sample.json is a JSON array, not an object keyed by slot name",
  baseCase({ sample_json_head: headText(SAMPLE_PATH, '["quote"]') }),
  { decision: "BLOCK", rule: "non-empty-sample-source" },
);

check(
  "config.yaml is a shape the reader does not understand",
  baseCase({
    files: [...filesWithoutSampleJson, { status: "modified", path: "registry.json" }],
    sample_json_head: null,
    config_yaml_head: headText(CONFIG_PATH, `id: ${NEW_ID}\nslots: [{name: quote}]\n`),
  }),
  { decision: "BLOCK", rule: "non-empty-sample-source" },
);

check(
  "deleting the sample invariant from the conf BREAKS the gate, it does not relax it",
  baseCase(),
  { decision: "BLOCK", rule: "conf-incomplete" },
  parseConf(readFileSync(CONF_PATH, "utf8").split("\n").filter((l) => !l.startsWith("invariant|non-empty-sample-source")).join("\n")),
);

/* ---- the config.yaml reader, against the REAL templates ----------------- */
/*
 * The reader is hand-written, because this gate never runs `npm ci` and cannot
 * import `yaml`. So it is asserted against every config.yaml this repository
 * actually ships: a reader that mis-parsed one of them would either refuse a
 * good template or, worse, count a sample that is not there.
 */
{
  const templatesDir = path.join(repoRoot, "templates");
  const ids = readdirSync(templatesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

  ran++;
  const unreadable = [];
  const blankPreviewRisk = [];
  for (const id of ids) {
    const parsed = parseConfigSlots(readFileSync(path.join(templatesDir, id, "config.yaml"), "utf8"));
    if (parsed.error) {
      unreadable.push(`${id}: ${parsed.error}`);
      continue;
    }
    /* Every shipped template must satisfy the invariant it now enforces:
       zero slots, or a sample source. `blank` is the zero-slot one. */
    const hasSampleJson = existsSync(path.join(templatesDir, id, "sample.json"));
    if (parsed.slots > 0 && !hasSampleJson && parsed.withSample === 0) blankPreviewRisk.push(id);
  }
  if (unreadable.length) {
    failures++;
    console.log(`FAIL  parseConfigSlots could not read ${unreadable.length} shipped config.yaml: ${unreadable.join("; ")}`);
  } else if (blankPreviewRisk.length) {
    failures++;
    console.log(`FAIL  shipped template(s) with slots but no sample source: ${blankPreviewRisk.join(", ")}`);
  } else {
    console.log(`ok    parseConfigSlots reads all ${ids.length} shipped config.yaml, and every one satisfies non-empty-sample-source`);
  }

  /* `blank` is the ONE zero-slot template on main, and the reason the exemption
     exists. If it ever gains a slot, it needs a sample source like the rest. */
  ran++;
  const blank = parseConfigSlots(readFileSync(path.join(templatesDir, "blank", "config.yaml"), "utf8"));
  if (blank.error || blank.slots !== 0) {
    failures++;
    console.log(`FAIL  templates/blank/config.yaml should declare zero slots, got ${JSON.stringify(blank)}`);
  } else {
    console.log("ok    templates/blank/ declares zero slots, which is why it may ship no sample.json");
  }
}

/* ---- the reader's own edge cases ---------------------------------------- */
{
  const readerCases = [
    ["slots: []", `id: x\nslots: []\n`, { slots: 0, withSample: 0 }],
    ["slots: with nothing under it", `id: x\nslots:\n`, { slots: 0, withSample: 0 }],
    [
      "a `sample:` line inside a block scalar is prose, not a key",
      `id: x\nslots:\n  - name: a\n    description: |\n      prose\n        sample: "not a key"\n    type: text\n`,
      { slots: 1, withSample: 0 },
    ],
    ["a nested block `sample:` counts", `id: x\nslots:\n  - name: a\n    sample:\n      - text: "hi"\n`, { slots: 1, withSample: 1 }],
    ["an empty `sample:` key does not count", `id: x\nslots:\n  - name: a\n    sample:\n`, { slots: 1, withSample: 0 }],
    ["`sample: []` holds nothing", `id: x\nslots:\n  - name: a\n    sample: []\n`, { slots: 1, withSample: 0 }],
    ["a sample with no slot name is unusable", `id: x\nslots:\n  - type: text\n    sample: "hi"\n`, { slots: 1, withSample: 0 }],
    ["comments and blank lines are ignored", `id: x\nslots:\n  # why\n  - name: a\n    sample: "v"\n\n`, { slots: 1, withSample: 1 }],
  ];
  for (const [label, text, expected] of readerCases) {
    ran++;
    const got = parseConfigSlots(text);
    if (got.error || got.slots !== expected.slots || got.withSample !== expected.withSample) {
      failures++;
      console.log(`FAIL  reader: ${label} -> ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    } else {
      console.log(`ok    reader: ${label} -> ${JSON.stringify(got)}`);
    }
  }

  /* A shape it does not understand must ERROR, which the decider turns into a
     refusal. Silently returning "no sample" would be the fail-open. */
  const mustError = [
    ["a TAB indent", `id: x\nslots:\n\t- name: a\n`],
    ["a flow sequence", `id: x\nslots: [{name: a}]\n`],
    ["an indent that fits no level", `id: x\nslots:\n  - name: a\n      stray: 1\n`],
    ["no slots key at all", `id: x\nname: y\n`],
  ];
  for (const [label, text] of mustError) {
    ran++;
    const got = parseConfigSlots(text);
    if (!got.error) {
      failures++;
      console.log(`FAIL  reader: ${label} should error, got ${JSON.stringify(got)}`);
    } else {
      console.log(`ok    reader errors on ${label}: ${got.error}`);
    }
  }
}

/* --------------------------------- guards -------------------------------- */

check("the first guard is red", baseCase({ guards: withGuard(0, "failure") }), { decision: "BLOCK", rule: "guards-green", retryable: false });
check(
  "the first guard is still running — retryable, never mergeable",
  baseCase({ guards: withGuard(0, "in_progress") }),
  { decision: "BLOCK", rule: "guards-green", retryable: true },
);
check(
  "a guard the collector could not resolve at all is ABSENT, and absent is not passing",
  baseCase({ guards: withGuard(0, "ABSENT") }),
  { decision: "BLOCK", rule: "guards-green" },
);
check(
  "a guard line with no result list at all",
  baseCase({ guards: { ...GREEN, results: undefined } }),
  { decision: "BLOCK", rule: "guards-green", retryable: true },
);
check(
  "a conf with no guard line proves nothing green",
  baseCase(),
  { decision: "BLOCK", rule: "guards-green" },
  parseConf(readFileSync(CONF_PATH, "utf8").split("\n").filter((l) => !l.startsWith("guard|")).join("\n")),
);
check(
  "a human-gated path is NEVER retryable — polling must not soften a refusal",
  baseCase({ files: [{ status: "modified", path: "themes/itera.css" }] }),
  { decision: "BLOCK", rule: "human-gated-path", retryable: false },
);
{
  /* Every guard line, one at a time: red, renamed-away, and pending. */
  const last = conf.rules.guard.length - 1;
  for (let i = 0; i <= last; i++) {
    const g = conf.rules.guard[i];
    const label = `${g.pattern}${g.who === "-" ? "" : " > " + g.who}`;
    check(`guard ${i} red   (${label})`, baseCase({ guards: withGuard(i, "failure") }), {
      decision: "BLOCK",
      rule: "guards-green",
      retryable: false,
    });
    check(`guard ${i} renamed away (${label})`, baseCase({ guards: withGuard(i, "ABSENT") }), {
      decision: "BLOCK",
      rule: "guards-green",
    });
    check(`guard ${i} pending (${label})`, baseCase({ guards: withGuard(i, "queued") }), {
      decision: "BLOCK",
      rule: "guards-green",
      retryable: true,
    });
  }
}
check(
  "guards were read for a different SHA than the head",
  baseCase({ guards: { ...GREEN, head_sha: "deadbeef" } }),
  { decision: "BLOCK", rule: "guards-green" },
);
check(
  "another check on the head SHA is failing",
  baseCase({ guards: { ...GREEN, failing_checks: ["Studio CI / Build"] } }),
  { decision: "BLOCK", rule: "guards-green" },
);
check(
  "another check on the head SHA is still running",
  baseCase({ guards: { ...GREEN, pending_checks: ["Studio CI / Lint"] } }),
  { decision: "BLOCK", rule: "guards-green" },
);
check("no guard results collected at all", baseCase({ guards: null }), { decision: "BLOCK", rule: "guards-green" });

/* ------------------------------ conf integrity --------------------------- */

check(
  "an invariant line deleted from the conf BREAKS the gate, it does not relax it",
  baseCase(),
  { decision: "BLOCK", rule: "conf-incomplete" },
  parseConf(readFileSync(CONF_PATH, "utf8").split("\n").filter((l) => !l.startsWith("invariant|no-deletions")).join("\n")),
);

check(
  "an invariant the decider does not implement refuses",
  baseCase(),
  { decision: "BLOCK", rule: "conf-unknown-invariant" },
  parseConf(readFileSync(CONF_PATH, "utf8") + "\ninvariant|vibes-are-good|nobody|made up\n"),
);

check(
  "a malformed conf line refuses",
  baseCase(),
  { decision: "BLOCK", rule: "conf-integrity" },
  parseConf(readFileSync(CONF_PATH, "utf8") + "\nhuman|only|three\n"),
);

check(
  "a conf with no automerge glob refuses everything",
  baseCase(),
  { decision: "BLOCK", rule: "conf-integrity" },
  parseConf(readFileSync(CONF_PATH, "utf8").split("\n").filter((l) => !l.startsWith("automerge|")).join("\n")),
);

/* --------------------------- the glob matcher ---------------------------- */

const globCases = [
  ["templates/*/**", "templates/foo/config.yaml", true],
  ["templates/*/**", "templates/foo/sub/deep.css", true],
  ["templates/*/**", "templates/README.md", false],
  ["templates/*/**", "registry.json", false],
  ["themes/**", "themes/itera.css", true],
  ["themes/**", "themes/nested/x.css", true],
  [".github/**", ".github/workflows/ci.yml", true],
  ["registry.json", "registry.json", true],
  ["registry.json", "studio/registry.json", false],
  ["package.json", "package-lock.json", false],
  ["scripts/**", "scripts/canvas.config.json", true],
];
for (const [glob, p, expected] of globCases) {
  ran++;
  const got = globMatch(glob, p);
  if (got !== expected) {
    failures++;
    console.log(`FAIL  glob '${glob}' vs '${p}': expected ${expected}, got ${got}`);
  } else {
    console.log(`ok    glob '${glob}' vs '${p}' -> ${got}`);
  }
}

/* -------------------- the conf must match the repository ----------------- */
/* Every top-level path that exists on disk today must be classified by SOME
   rule. A path that is neither human-gated nor automerge-listed would refuse
   with `unlisted-path`, which is safe — but it is better found here, by name. */
{
  ran++;
  const humanGlobs = conf.rules.human.map((r) => r.pattern);
  const autoGlobs = conf.rules.automerge.map((r) => r.pattern);
  const topLevel = [
    "themes/itera.css",
    "scripts/lint-css.mjs",
    "scripts/canvas.config.json",
    "studio/package.json",
    "supabase/config.toml",
    ".github/workflows/ci.yml",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "renovate.json",
    "README.md",
    "showcase.html",
    ".gitignore",
  ];
  const unclassified = topLevel.filter(
    (p) => !humanGlobs.some((g) => globMatch(g, p)) && !autoGlobs.some((g) => globMatch(g, p)),
  );
  if (unclassified.length) {
    failures++;
    console.log(`FAIL  paths classified by no conf rule: ${unclassified.join(", ")}`);
  } else {
    console.log("ok    every current top-level path is classified by a conf rule");
  }
}

console.log(`\n${ran - failures}/${ran} checks passed`);
if (failures) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}

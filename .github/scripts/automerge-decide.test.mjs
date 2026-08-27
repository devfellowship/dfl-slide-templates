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
 * 🚦 NO SHIPPED RULE MAY LACK AN ASSERTION. Two meta-checks at the foot of this
 * file enforce it mechanically rather than by review: every name in
 * `KNOWN_INVARIANTS` must appear as the expected `rule` of at least one BLOCK
 * case, and every `human|` glob in the conf must be proven to refuse. Add a rule
 * without a test and this suite goes red naming the rule.
 *
 * Run:  npm run test:automerge
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decide, loadConf, parseConf, globMatch, parseConfigSlots, KNOWN_INVARIANTS } from "./automerge-decide.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const CONF_PATH = path.join(repoRoot, ".github", "automerge-rules.conf");
const conf = loadConf(CONF_PATH);

const realRegistry = JSON.parse(readFileSync(path.join(repoRoot, "registry.json"), "utf8"));
const realIds = realRegistry.templates.map((t) => t.id);

let failures = 0;
let ran = 0;

/* Every rule id this suite actually asserts a refusal on. Read by the meta-check
   at the foot of the file, so a new rule cannot ship untested. */
const assertedRules = new Set();

function check(name, kase, expect, confOverride = conf) {
  ran++;
  if (expect.decision === "BLOCK" && expect.rule) assertedRules.add(expect.rule);
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
    labels: [],
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

/* ============================ THE FOUR MANDATED CASES ==================== */

/* CASE 1 — a brand-new template directory. Must MERGE unattended. */
check("CASE 1  new templates/<new-id>/** + one appended registry entry", baseCase(), {
  decision: "ALLOW",
  rule: "new-template",
});

/* CASE 2 — one byte of an EXISTING template's CSS.
   🚦 THIS CASE INVERTED ON 2026-08-27 (ADR-14). It used to be the headline
   refusal: "one bad merge to an existing template breaks every live deck".
   Tainan weighed that against this repo's CI — lint:css, check:canvas and
   check:theme all blocking, check:theme rendering every template against every
   theme over a hostile page colour — and decided "It's ok to auto merge this
   here, why not?". A CSS change that breaks a render goes red before it can
   merge, so it merges unattended now. `title` is the first template in the
   shipped registry and is used by live decks: that is the point of the case. */
check(
  "CASE 2  one byte changed in templates/title/landscape.css MERGES (ADR-14)",
  baseCase({
    files: [{ status: "modified", path: "templates/title/landscape.css" }],
    registry_head: realRegistry,
  }),
  { decision: "ALLOW", rule: "no-human-gated-path" },
);

/* CASE 2b — what replaced it. The deny-list is what still refuses, and it holds
   the paths where a green CI proves nothing because the change alters WHAT CI
   RUNS. `scripts/lint-css.mjs` IS a guard: the guards run the head copy, so a
   pull request that weakens it turns that guard green. */
check(
  "CASE 2b one byte changed in scripts/lint-css.mjs still REFUSES",
  baseCase({
    files: [{ status: "modified", path: "scripts/lint-css.mjs" }],
    registry_head: realRegistry,
  }),
  { decision: "BLOCK", rule: "human-gated-path" },
);

/* CASE 3 — a fork. This repo is PUBLIC, so the head is a stranger's code.
   🚨 THE MOST IMPORTANT LINE IN THE CONF. ADR-14 relaxed the review rules and
   relaxed NONE of the safety invariants; this one may never be relaxed. */
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

/* An unreadable diff is a refusal in every class: the deny-list cannot be
   applied to a file list that is empty or capped. */
check("an empty changed-file list refuses", baseCase({ files: [] }), { decision: "BLOCK", rule: "no-files" });
check("a changed-file list that is not a list refuses", baseCase({ files: null }), { decision: "BLOCK", rule: "no-files" });
check(
  "a changed-file list truncated by the API refuses — the deny-list cannot judge a diff it cannot see in full",
  baseCase({ files_truncated: true }),
  { decision: "BLOCK", rule: "no-files" },
);

/* 🚦 INVERTED BY ADR-14. `themes/**` was the first human line in the conf, and
   its reason — "a theme file restyles every one of the 46 templates at once" —
   is exactly the risk `check:theme` measures: every template × every theme ×
   every declared canvas, 404 renders today, over a hostile magenta page, with
   the computed styles read back. A theme change that breaks a template is red
   before it can merge. This is the relaxation ADR-14 names by evidence. */
check(
  "a new template PLUS a themes/ edit MERGES (ADR-14: check:theme covers it)",
  baseCase({ files: [...newTemplateFiles, { status: "modified", path: "registry.json" }, { status: "modified", path: "themes/itera.css" }] }),
  { decision: "ALLOW", rule: "new-template" },
);

check(
  "a themes/ edit ON ITS OWN merges",
  baseCase({ files: [{ status: "modified", path: "themes/itera.css" }], registry_head: realRegistry }),
  { decision: "ALLOW", rule: "no-human-gated-path" },
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

/* 🚦 INVERTED BY ADR-14. The conf was default-DENY, so an undeclared file shape
   refused with `unlisted-path`. It is default-ALLOW now: one `automerge|**`
   line, and the specificity moved into the deny-list. A file directly under
   `templates/` sits inside no template directory, so it is an ordinary repo
   file and the new-template invariants do not judge it. */
check(
  "a file added at templates/ root, outside any template directory, merges",
  baseCase({ files: [...newTemplateFiles, { status: "added", path: "templates/README.md" }, { status: "modified", path: "registry.json" }] }),
  { decision: "ALLOW", rule: "new-template" },
);

check(
  "a brand new top-level file shape merges under the catch-all",
  baseCase({ files: [...newTemplateFiles, { status: "added", path: "Dockerfile" }, { status: "modified", path: "registry.json" }] }),
  { decision: "ALLOW", rule: "new-template" },
);

/* …and `unlisted-path` is NOT dead code. It is the default-deny backstop, and it
   fires the moment somebody narrows the catch-all — which is what makes
   narrowing this conf a safe operation and widening it the one that needs an
   argument. Asserted against a conf whose `**` has been replaced by the old
   narrow globs. */
{
  const narrowed = parseConf(
    readFileSync(CONF_PATH, "utf8")
      .split("\n")
      .map((l) => (l.startsWith("automerge|**|") ? "automerge|templates/*/**|x|narrowed for this test\nautomerge|registry.json|x|narrowed for this test" : l))
      .join("\n"),
  );
  check(
    "narrowing the catch-all restores default-deny: an undeclared shape refuses",
    baseCase({ files: [...newTemplateFiles, { status: "added", path: "Dockerfile" }, { status: "modified", path: "registry.json" }] }),
    { decision: "BLOCK", rule: "unlisted-path" },
    narrowed,
  );
  check(
    "the same narrowed conf still merges the shape it does declare",
    baseCase(),
    { decision: "ALLOW", rule: "new-template" },
    narrowed,
  );
}

check(
  "the directory is new but one of its files is reported modified",
  baseCase({ files: [{ status: "modified", path: `templates/${NEW_ID}/landscape.css` }, { status: "modified", path: "registry.json" }] }),
  { decision: "BLOCK", rule: "new-template-dir-only" },
);

/* 🚦 INVERTED BY ADR-14, and it is the case that shows the class scoping working.
   No template directory is introduced, so the class is `change` and the three
   new-template invariants are N/A — but `registry-no-metadata-loss` still runs,
   which is what stops a registry-only pull request from being a free rewrite. */
check(
  "registry-only PR, no template directory, appending an entry",
  baseCase({ files: [{ status: "modified", path: "registry.json" }] }),
  { decision: "ALLOW", rule: "no-human-gated-path" },
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
  baseCase({ registry_head: { ...realRegistry, templates: [...realRegistry.templates, { ...newEntry, id: "not-the-new-one" }] } }),
  { decision: "BLOCK", rule: "registry-single-append" },
);

/* The same shape with an id that ALREADY EXISTS is corruption, not a mismatch,
   and `registry-no-metadata-loss` catches it first — a duplicated id means no
   entry can be compared against its base version at all. */
check(
  "the appended entry re-uses an existing id",
  baseCase({ registry_head: { ...realRegistry, templates: [...realRegistry.templates, { ...newEntry, id: "title" }] } }),
  { decision: "BLOCK", rule: "registry-no-metadata-loss" },
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

/* ============================ no-hold-label ============================== */
/*
 * ADR-14 turned the path list into a deny-list, which removed the mechanism that
 * used to hold ONE pull request for review. The `hold` label replaces it, and
 * the label set is the same one `pr-merge-sweeper.sh` honours, so a single label
 * holds a pull request against both. Case-insensitive and trimmed, because a
 * human types the label.
 */

for (const label of ["hold", "do-not-merge", "do_not_merge", "hold-for-review", "no-merge", "wip"]) {
  check(`a '${label}' label holds the pull request`, baseCase({ labels: [label] }), {
    decision: "BLOCK",
    rule: "no-hold-label",
  });
}

check(
  "the hold label is matched case-insensitively and trimmed",
  baseCase({ labels: ["documentation", "  Do-Not-Merge  "] }),
  { decision: "BLOCK", rule: "no-hold-label" },
);

check(
  "an unrelated label does not hold the pull request",
  baseCase({ labels: ["documentation", "templates"] }),
  { decision: "ALLOW", rule: "new-template" },
);

check(
  "no labels at all is not a hold",
  baseCase({ labels: [] }),
  { decision: "ALLOW", rule: "new-template" },
);

check(
  "a label list that could not be read is a REFUSAL, not an absent hold",
  baseCase({ labels: null }),
  { decision: "BLOCK", rule: "no-hold-label" },
);

check(
  "a hold label beats a perfect diff with every guard green",
  baseCase({ labels: ["hold"], guards: GREEN }),
  { decision: "BLOCK", rule: "no-hold-label" },
);

/* ==================== the `change` class, which ADR-14 opened ============= */
/*
 * Everything here refused before 2026-08-27 and merges now. Each case names the
 * conf reason string it retires, so the argument is visible next to the verdict
 * rather than only in a commit message.
 */

const changeCase = (files) => baseCase({ files, registry_head: realRegistry, config_yaml_head: null, sample_json_head: null });

check(
  "a README edit merges — the old reason was 'docs state the contract', but the two documented staleness incidents (PR #81 vs #83) BOTH arrived through human-merged pull requests",
  changeCase([{ status: "modified", path: "README.md" }]),
  { decision: "ALLOW", rule: "no-human-gated-path" },
);

check(
  "a showcase.html edit merges — it is a generated artefact with NO CI guard at all, so the human gate protected nothing",
  changeCase([{ status: "modified", path: "showcase.html" }]),
  { decision: "ALLOW", rule: "no-human-gated-path" },
);

check(
  "an existing template's HTML, CSS and preview together merge",
  changeCase([
    { status: "modified", path: "templates/title/landscape.html" },
    { status: "modified", path: "templates/title/landscape.css" },
    { status: "modified", path: "templates/title/preview-landscape.png" },
  ]),
  { decision: "ALLOW", rule: "no-human-gated-path" },
);

check(
  "an existing template needs NO sample.json and NO registry entry — the three new-template invariants are n/a for this class",
  changeCase([{ status: "modified", path: "templates/title/sample.json" }]),
  { decision: "ALLOW", rule: "no-human-gated-path" },
);

check(
  "two EXISTING template directories in one diff merge — 'exactly one directory' was a new-template rule, not a review rule",
  changeCase([
    { status: "modified", path: "templates/title/landscape.css" },
    { status: "modified", path: "templates/quote/landscape.css" },
  ]),
  { decision: "ALLOW", rule: "no-human-gated-path" },
);

check(
  "a new top-level documentation file merges",
  changeCase([{ status: "added", path: "CONTRIBUTING.md" }]),
  { decision: "ALLOW", rule: "no-human-gated-path" },
);

/* ---- what the `change` class does NOT relax ----------------------------- */

check(
  "a deletion still refuses in the change class — no-deletions is a safety invariant and ADR-14 kept every one",
  changeCase([{ status: "removed", path: "templates/title/portrait.css" }]),
  { decision: "BLOCK", rule: "no-deletions" },
);

check(
  "a fork still refuses in the change class",
  baseCase({
    files: [{ status: "modified", path: "templates/title/landscape.css" }],
    registry_head: realRegistry,
    head_repo: "some-stranger/dfl-slide-templates",
  }),
  { decision: "BLOCK", rule: "same-repo-head" },
);

check(
  "a read-only author still refuses in the change class",
  baseCase({
    files: [{ status: "modified", path: "templates/title/landscape.css" }],
    registry_head: realRegistry,
    author_permission: "read",
  }),
  { decision: "BLOCK", rule: "author-has-write" },
);

check(
  "a red guard still refuses in the change class",
  baseCase({
    files: [{ status: "modified", path: "templates/title/landscape.css" }],
    registry_head: realRegistry,
    guards: withGuard(0, "failure"),
  }),
  { decision: "BLOCK", rule: "guards-green" },
);

/* ================== the deny-list, one case per shipped rule ============== */
/*
 * Built FROM the conf, so a `human|` line added and never tested turns this red,
 * and a line deleted takes its assertion with it. No shipped rule lacks a case.
 */
{
  /* A path that this glob, and no other intent, would match. */
  const probeFor = (glob) => glob.replace(/\*\*/g, "zzz/probe.txt").replace(/(?<!\.)\*/g, "zzz");
  for (const r of conf.rules.human) {
    const probe = probeFor(r.pattern);
    ran++;
    if (!globMatch(r.pattern, probe)) {
      failures++;
      console.log(`FAIL  deny-list probe '${probe}' does not match its own glob '${r.pattern}'`);
      continue;
    }
    console.log(`ok    deny-list probe '${probe}' matches '${r.pattern}'`);
    check(
      `deny-list: '${r.pattern}' refuses (${r.why.slice(0, 60)}…)`,
      baseCase({ files: [{ status: "modified", path: probe }], registry_head: realRegistry }),
      { decision: "BLOCK", rule: "human-gated-path" },
    );
  }
}

check(
  "the catch-all does NOT swallow the deny-list: a Dockerfile merges, scripts/ in the same diff does not",
  baseCase({
    files: [
      { status: "added", path: "Dockerfile" },
      { status: "modified", path: "scripts/preview-gen.ts" },
    ],
    registry_head: realRegistry,
  }),
  { decision: "BLOCK", rule: "human-gated-path" },
);

/* ===================== registry-no-metadata-loss ========================== */
/*
 * `registry.json` used to be auto-mergeable only as a single append, which made
 * destruction impossible by construction. It is editable now, so the protection
 * has to be stated. CI does NOT see this class of damage: `check:theme` asserts
 * that templates/ and registry.json agree about which templates EXIST, and
 * `lint:css` that registry.json and theme.config.json agree about which themes
 * exist — neither reads `when_to_use`, `avoid_when` or `tags`. Drop those and
 * all four guards stay green while `search_templates` stops ranking the template
 * for its own phrase. That is plan Gap 4, and `update_template` does it today.
 */
{
  const regCase = (headTemplates, over = {}) =>
    baseCase({
      files: [{ status: "modified", path: "registry.json" }],
      registry_head: { ...realRegistry, templates: headTemplates },
      ...over,
    });

  const first = realRegistry.templates[0];
  const rest = realRegistry.templates.slice(1);

  check(
    "an entry that loses `when_to_use` refuses — four green guards do not see it",
    regCase([Object.fromEntries(Object.entries(first).filter(([k]) => k !== "when_to_use")), ...rest]),
    { decision: "BLOCK", rule: "registry-no-metadata-loss" },
  );

  check(
    "an entry that EMPTIES `when_to_use` refuses — the same harm as deleting it",
    regCase([{ ...first, when_to_use: "" }, ...rest]),
    { decision: "BLOCK", rule: "registry-no-metadata-loss" },
  );

  check(
    "an entry that empties `tags` to [] refuses",
    regCase([{ ...first, tags: [] }, ...rest]),
    { decision: "BLOCK", rule: "registry-no-metadata-loss" },
  );

  check(
    "an entry that disappears refuses",
    regCase(rest),
    { decision: "BLOCK", rule: "registry-no-metadata-loss" },
  );

  check(
    "reordering entries is NOT a loss — the change class does not require append order",
    regCase([...rest, first]),
    { decision: "ALLOW", rule: "no-human-gated-path" },
  );

  check(
    "a CHANGED value is allowed: a version bump is legitimate and visible in the diff",
    regCase([{ ...first, version: "1.1.0" }, ...rest]),
    { decision: "ALLOW", rule: "no-human-gated-path" },
  );

  check(
    "a duplicated id refuses — no entry could then be compared against its base version",
    regCase([...realRegistry.templates, { ...first }]),
    { decision: "BLOCK", rule: "registry-no-metadata-loss" },
  );

  check(
    "a lost TOP-LEVEL key refuses",
    baseCase({
      files: [{ status: "modified", path: "registry.json" }],
      registry_head: Object.fromEntries(Object.entries(realRegistry).filter(([k]) => k !== "themes")),
    }),
    { decision: "BLOCK", rule: "registry-no-metadata-loss" },
  );

  check(
    "registry.json in the diff but unreadable at the head SHA refuses",
    baseCase({ files: [{ status: "modified", path: "registry.json" }], registry_head: null }),
    { decision: "BLOCK", rule: "registry-no-metadata-loss" },
  );

  check(
    "registry.json NOT in the diff is not judged by this invariant",
    baseCase({ files: [{ status: "modified", path: "templates/title/landscape.css" }], registry_head: null }),
    { decision: "ALLOW", rule: "no-human-gated-path" },
  );

  check(
    "deleting the metadata-loss invariant from the conf BREAKS the gate, it does not relax it",
    baseCase(),
    { decision: "BLOCK", rule: "conf-incomplete" },
    parseConf(readFileSync(CONF_PATH, "utf8").split("\n").filter((l) => !l.startsWith("invariant|registry-no-metadata-loss")).join("\n")),
  );

  check(
    "deleting the hold-label invariant from the conf BREAKS the gate, it does not relax it",
    baseCase(),
    { decision: "BLOCK", rule: "conf-incomplete" },
    parseConf(readFileSync(CONF_PATH, "utf8").split("\n").filter((l) => !l.startsWith("invariant|no-hold-label")).join("\n")),
  );
}

/* ================= the class boundary, and its loopholes ================== */

check(
  "MIXED: a new template PLUS an edit to an existing one still refuses — otherwise a new template could dodge registry-single-append and non-empty-sample-source by touching a second directory",
  baseCase({
    files: [
      ...newTemplateFiles,
      { status: "modified", path: "templates/title/landscape.css" },
      { status: "modified", path: "registry.json" },
    ],
  }),
  { decision: "BLOCK", rule: "new-template-dir-only" },
);

/* 🚨 THE LOOPHOLE THE COUNT CHECK EXISTS FOR, and the only case that proves it.
   In the two MIXED cases below the existing template's file is `modified`, so
   the `status=added` half of new-template-dir-only catches them and the count
   check is never exercised. Here every file is ADDED — a new template plus a
   new file dropped into an EXISTING template directory. Only "exactly one
   template directory" refuses it. A mutation that relaxed the count to "exactly
   one NEW directory" survived the whole suite until this case was added. */
check(
  "MIXED, all files ADDED: a new template plus a new file inside an EXISTING template directory refuses",
  baseCase({
    files: [
      ...newTemplateFiles,
      { status: "added", path: "templates/title/social-portrait.css" },
      { status: "modified", path: "registry.json" },
    ],
  }),
  { decision: "BLOCK", rule: "new-template-dir-only" },
);

check(
  "MIXED the other way: an existing-template edit that also adds a HALF-FORMED new template refuses",
  baseCase({
    files: [
      { status: "added", path: `templates/${NEW_ID}/config.yaml` },
      { status: "modified", path: "templates/title/landscape.css" },
    ],
  }),
  { decision: "BLOCK", rule: "new-template-dir-only" },
);

check(
  "a new template dodging the sample invariant by ALSO editing a theme still ships its sample source",
  baseCase({
    files: [...filesWithoutSampleJson, { status: "modified", path: "registry.json" }, { status: "modified", path: "themes/revera.css" }],
    sample_json_head: null,
    config_yaml_head: headText(CONFIG_PATH, CONFIG_NO_SAMPLES),
  }),
  { decision: "BLOCK", rule: "non-empty-sample-source" },
);

check(
  "templates/ is touched but the base directory listing could not be read — the class is unknown, and unknown is a refusal",
  baseCase({ base_template_ids: null }),
  { decision: "BLOCK", rule: "new-template-dir-only" },
);

check(
  "a diff that touches NO template directory needs no base listing to be classified",
  baseCase({
    files: [{ status: "modified", path: "README.md" }],
    base_template_ids: null,
    registry_head: realRegistry,
  }),
  { decision: "ALLOW", rule: "no-human-gated-path" },
);

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
  baseCase({ files: [{ status: "modified", path: "scripts/check-theme.ts" }] }),
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
/*
 * Not "is every path classified?" — under a catch-all that is true by
 * construction, which is the "passes by construction" trap. This asserts the
 * DECISION each real path gets, so the relaxation is pinned by name: a future
 * edit that quietly re-gates `themes/**`, or quietly un-gates `scripts/**`,
 * turns this red naming the path.
 */
{
  const humanGlobs = conf.rules.human.map((r) => r.pattern);
  const decisionFor = (p) => (humanGlobs.some((g) => globMatch(g, p)) ? "human" : "automerge");

  /* `automerge` here means "no human needed for the PATH". The invariants and
     the guards still apply — this table is about the deny-list only. */
  const expected = [
    ["scripts/lint-css.mjs", "human", "the guards run the HEAD copy, so a weakened guard turns itself green"],
    ["scripts/check-theme.ts", "human", "same"],
    ["scripts/canvas.config.json", "human", "cross-repo canvas contract; the counterpart check lives in another repo"],
    ["canvas.config.json", "human", "the contract's future path, guarded before it moves"],
    [".github/workflows/ci.yml", "human", "the gate judges with the BASE copy, so a weakened head conf hits the NEXT PR"],
    [".github/automerge-rules.conf", "human", "same"],
    ["package.json", "human", "it defines what every guard command actually runs"],
    ["package-lock.json", "human", "it chooses the code the guards execute"],
    ["tsconfig.json", "human", "it changes how the ts-node guards compile"],
    ["studio/src/App.tsx", "human", "deployed code with no test suite"],
    ["supabase/functions/publish-template/index.ts", "human", "the write path INTO this repo, tested by no job here"],
    ["renovate.json", "human", "it configures what lands unattended"],
    [".gitignore", "human", "it can hide a file from the diff"],
    /* Relaxed by ADR-14 — every one of these was `human` before 2026-08-27. */
    ["themes/itera.css", "automerge", "ADR-14: check:theme renders every template × every theme over a hostile page"],
    ["themes/devfellowship.css", "automerge", "ADR-14"],
    ["templates/title/landscape.css", "automerge", "ADR-14: a broken render is red before it merges"],
    ["templates/title/sample.json", "automerge", "ADR-14"],
    ["registry.json", "automerge", "guarded by registry-no-metadata-loss instead of by a human"],
    ["README.md", "automerge", "the human gate did not stop the two documented staleness incidents"],
    ["showcase.html", "automerge", "a generated artefact with no CI guard at all; the gate protected nothing"],
    ["CONTRIBUTING.md", "automerge", "the catch-all"],
  ];
  for (const [p, want, why] of expected) {
    ran++;
    const got = decisionFor(p);
    if (got !== want) {
      failures++;
      console.log(`FAIL  conf decision for '${p}': expected ${want}, got ${got}  (${why})`);
    } else {
      console.log(`ok    conf decision for '${p}' is ${got}  (${why})`);
    }
  }
}

/* ==================== META: no shipped rule lacks a test ================== */
/*
 * `test_path_gate.sh` discipline, mechanised. A rule with no assertion is the
 * failure mode this whole file exists to stop, so the property is checked rather
 * than reviewed.
 */
{
  /* Conditional invariants are asserted through the rule id they emit. */
  ran++;
  const untested = KNOWN_INVARIANTS.filter((name) => !assertedRules.has(name));
  if (untested.length) {
    failures++;
    console.log(`FAIL  invariant(s) implemented by the decider with NO blocking assertion: ${untested.join(", ")}`);
  } else {
    console.log(`ok    all ${KNOWN_INVARIANTS.length} implemented invariants are asserted by at least one BLOCK case`);
  }

  /* Every non-invariant verdict the decider can emit, asserted too. */
  ran++;
  const otherRules = ["human-gated-path", "unlisted-path", "no-files", "conf-incomplete", "conf-unknown-invariant", "conf-integrity"];
  const missing = otherRules.filter((r) => !assertedRules.has(r));
  if (missing.length) {
    failures++;
    console.log(`FAIL  non-invariant rule id(s) with no assertion: ${missing.join(", ")}`);
  } else {
    console.log(`ok    every non-invariant rule id the decider emits is asserted`);
  }

  /* And the conf must list exactly what the decider implements, in both
     directions — the fail-closed contract, asserted against the SHIPPED file. */
  ran++;
  const listed = conf.rules.invariant.map((r) => r.pattern).sort();
  const known = [...KNOWN_INVARIANTS].sort();
  if (JSON.stringify(listed) !== JSON.stringify(known)) {
    failures++;
    console.log(`FAIL  the shipped conf lists [${listed.join(", ")}] but the decider implements [${known.join(", ")}]`);
  } else {
    console.log(`ok    the shipped conf lists exactly the ${known.length} invariants the decider implements`);
  }
}

console.log(`\n${ran - failures}/${ran} checks passed`);
if (failures) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}

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

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decide, loadConf, parseConf, globMatch } from "./automerge-decide.mjs";

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

const GREEN = {
  head_sha: "cafe1234",
  lint_css_job: "success",
  preview_regen_job: "success",
  check_canvas_step: "success",
  check_theme_step: "success",
  failing_checks: [],
  pending_checks: [],
};

const NEW_ID = "quote-portrait-xl";
const newEntry = { id: NEW_ID, version: "1.0.0", category: "content", name: "Quote Portrait XL" };

/** The happy shape: seven added files under one brand-new directory. */
const newTemplateFiles = [
  "config.yaml",
  "landscape.css",
  "landscape.html",
  "portrait.css",
  "portrait.html",
  "preview-landscape.png",
  "preview-portrait.png",
].map((f) => ({ status: "added", path: `templates/${NEW_ID}/${f}` }));

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

/* --------------------------------- guards -------------------------------- */

check("lint-css red", baseCase({ guards: { ...GREEN, lint_css_job: "failure" } }), { decision: "BLOCK", rule: "guards-green", retryable: false });
check(
  "lint-css still running is retryable, never mergeable",
  baseCase({ guards: { ...GREEN, lint_css_job: "in_progress" } }),
  { decision: "BLOCK", rule: "guards-green", retryable: true },
);
check(
  "a human-gated path is NEVER retryable — polling must not soften a refusal",
  baseCase({ files: [{ status: "modified", path: "themes/itera.css" }] }),
  { decision: "BLOCK", rule: "human-gated-path", retryable: false },
);
check("preview-regen red", baseCase({ guards: { ...GREEN, preview_regen_job: "failure" } }), { decision: "BLOCK", rule: "guards-green" });
check(
  "the check:canvas STEP was renamed away, so it cannot be found",
  baseCase({ guards: { ...GREEN, check_canvas_step: null } }),
  { decision: "BLOCK", rule: "guards-green" },
);
check(
  "the check:theme STEP failed — not retryable",
  baseCase({ guards: { ...GREEN, check_theme_step: "failure" } }),
  { decision: "BLOCK", rule: "guards-green", retryable: false },
);
check(
  "the check:theme STEP was renamed away, so it cannot be found",
  baseCase({ guards: { ...GREEN, check_theme_step: undefined } }),
  { decision: "BLOCK", rule: "guards-green" },
);
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

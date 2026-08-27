#!/usr/bin/env node
/**
 * automerge-collect.mjs — gathers the FACTS the gate decides on, and nothing else.
 *
 * It never decides and it never merges. It reads the GitHub API and the BASE
 * checkout on disk, and writes one `case.json`. `automerge-decide.mjs` is the
 * only place a verdict is formed, which is what keeps the verdict unit-testable
 * with no network.
 *
 * IT NEVER EXECUTES HEAD CODE. The head side is read as FOUR pieces of DATA
 * only: the changed-file list, the text of `registry.json` at the head SHA, and
 * the text of the new template's `config.yaml` and `sample.json` at that same
 * SHA. All four are text; the decider parses them. No head checkout, no `npm ci`
 * of a head lockfile, no head script ever runs in this job — and this job holds
 * a write token. Nothing here is `import`ed, `eval`ed or executed.
 *
 * The pull request's LABELS are collected too, for `no-hold-label`. They come
 * from the pull-request object, never from the `labeled`/`unlabeled` event
 * payload, so a re-run reads the labels as they are now.
 *
 * Usage:
 *   GITHUB_TOKEN=... node automerge-collect.mjs \
 *     --repo owner/name --pr 123 --base-checkout /path/to/base > case.json
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseConf } from "./automerge-decide.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const REPO = arg("repo");
const PR = arg("pr");
const BASE = arg("base-checkout", ".");
/* The gate's own check run. Excluded from the "is anything still running?"
   sweep, because it is running right now — otherwise it waits for itself. */
const SELF_CHECK_NAME = arg("self-check-name", "Auto-merge gate");
const CONF = arg("conf", path.join(path.dirname(new URL(import.meta.url).pathname), "..", "automerge-rules.conf"));
const TOKEN = process.env.GITHUB_TOKEN;

if (!REPO || !PR || !TOKEN) {
  console.error("usage: GITHUB_TOKEN=... automerge-collect.mjs --repo owner/name --pr N [--base-checkout DIR]");
  process.exit(2);
}

const API = "https://api.github.com";

async function gh(pathname, { raw = false } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "dfl-slide-templates-automerge-gate",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`GET ${pathname} -> ${res.status}: ${body.slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  return raw ? res.text() : res.json();
}

/** Absent facts stay ABSENT. Never substitute a permissive default. */
async function softGh(pathname, opts) {
  try {
    return await gh(pathname, opts);
  } catch (err) {
    process.stderr.write(`note: ${err.message}\n`);
    return null;
  }
}

async function paged(pathname, limitPages = 30) {
  const out = [];
  for (let page = 1; page <= limitPages; page++) {
    const sep = pathname.includes("?") ? "&" : "?";
    const batch = await gh(`${pathname}${sep}per_page=100&page=${page}`);
    const items = Array.isArray(batch) ? batch : [];
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
}

/* --------------------------------------------------------------- the case */

const pr = await gh(`/repos/${REPO}/pulls/${PR}`);
const headSha = pr.head.sha;
const headRepo = pr.head.repo ? pr.head.repo.full_name : null;
const sameRepo = headRepo === REPO;

/* Permission from the collaborator API. Never from the author name, and never
   from `author_association` (which says CONTRIBUTOR for a brand-new org member
   and OWNER for anyone who happens to own a fork of this repo). */
let authorPermission = null;
if (pr.user && pr.user.login) {
  const perm = await softGh(`/repos/${REPO}/collaborators/${encodeURIComponent(pr.user.login)}/permission`);
  authorPermission = perm && typeof perm.permission === "string" ? perm.permission : null;
}

const rawFiles = await paged(`/repos/${REPO}/pulls/${PR}/files`);
const files = rawFiles.map((f) => ({
  status: f.status,
  path: f.filename,
  previous_path: f.previous_filename ?? null,
}));
/* The files endpoint caps at 3000. A capped list is an unreadable diff. */
const filesTruncated = typeof pr.changed_files === "number" && files.length < pr.changed_files;

/* Base side, read from the BASE checkout on disk — trusted code, trusted data. */
const templatesDir = path.join(BASE, "templates");
const baseTemplateIds = existsSync(templatesDir)
  ? readdirSync(templatesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  : null;

const baseRegistryPath = path.join(BASE, "registry.json");
let registryBase = null;
try {
  registryBase = JSON.parse(readFileSync(baseRegistryPath, "utf8"));
} catch (err) {
  process.stderr.write(`note: base registry.json unreadable: ${err.message}\n`);
}

/* Head side: DATA, never code. Skipped entirely for a fork, whose head SHA is
   not an object of this repository. */
let registryHead = null;
if (sameRepo) {
  const text = await softGh(`/repos/${REPO}/contents/registry.json?ref=${headSha}`, { raw: true });
  if (text !== null) {
    try {
      registryHead = JSON.parse(text);
    } catch (err) {
      process.stderr.write(`note: head registry.json is not valid JSON: ${err.message}\n`);
    }
  }
}

/* The new template's own two files, read as TEXT for `non-empty-sample-source`.
   A template that ships no sample data renders every slot empty, so its preview
   is blank and the guards pass against an empty layout. The decider does all the
   judging; this only carries the bytes, and an unreadable file carries an error
   string rather than a permissive default. */
async function readHeadText(filePath) {
  try {
    /* Encoded segment by segment: a branch may name a file anything, and a raw
       `?` or `#` in a path would otherwise rewrite this URL. */
    const encoded = filePath.split("/").map(encodeURIComponent).join("/");
    const text = await gh(`/repos/${REPO}/contents/${encoded}?ref=${headSha}`, { raw: true });
    return { path: filePath, text, error: null };
  } catch (err) {
    process.stderr.write(`note: ${err.message}\n`);
    return { path: filePath, text: null, error: `GitHub answered ${err.status ?? "an error"} for ${filePath} at ${headSha}` };
  }
}

/* Derived only to know WHICH two files to read, and only for a directory that
   is genuinely absent from the base — an edit to an EXISTING template needs
   neither file, because `non-empty-sample-source` does not apply to it.
   `new-template-dir-only` is judged in the decider and nowhere else. */
const touchedIds = [
  ...new Set(
    files
      .filter((f) => f.path.startsWith("templates/") && f.path.split("/").length >= 3)
      .map((f) => f.path.split("/")[1])
      .filter(Boolean),
  ),
];
const newIds = baseTemplateIds ? touchedIds.filter((id) => !baseTemplateIds.includes(id)) : touchedIds;
const newTemplateId = touchedIds.length === 1 && newIds.length === 1 ? touchedIds[0] : null;

let configYamlHead = null;
let sampleJsonHead = null;
if (sameRepo && newTemplateId) {
  const configPath = `templates/${newTemplateId}/config.yaml`;
  const samplePath = `templates/${newTemplateId}/sample.json`;
  /* Only files the diff actually adds are fetched: a 404 for a file that was
     never in the PR is not a fact worth collecting. */
  if (files.some((f) => f.path === configPath)) configYamlHead = await readHeadText(configPath);
  if (files.some((f) => f.path === samplePath)) sampleJsonHead = await readHeadText(samplePath);
}

/* ------------------------------------------------------------- the guards */
/*
 * The guards are DATA. Every `guard|<job>|<step or ->|<why>` line in
 * `.github/automerge-rules.conf` is resolved here by GitHub display name, across
 * every workflow run for the head SHA. A job or step that cannot be found is
 * reported as ABSENT, and the decider refuses on it — absence is not a pass. A
 * renamed CI step is therefore a one-line conf change, not a code change.
 *
 * 🚨 A GREEN `Canvas fill + previews` JOB IS NOT EVIDENCE THAT THE PREVIEW
 * RASTERS MATCH. Its "Check for preview drift" step emits `::warning::` and exits
 * 0 on purpose, because CI fonts and Chromium differ from a local render. So a
 * template whose PNG changed for a BAD reason still shows a green job. That is
 * plan risk 8 and Verification criterion 2, and it is why the drift step is NOT
 * a guard line and why this gate is scoped to a NEW directory: a new template
 * has no previously approved raster to drift from. Do not widen this gate on the
 * strength of that green.
 */
const guardLines = parseConf(readFileSync(CONF, "utf8")).rules.guard;
const guards = { head_sha: headSha, results: [], failing_checks: [], pending_checks: [] };

if (sameRepo) {
  /* Every run for this SHA, newest first. No workflow-path assumption: a guard
     is found by its job name wherever it lives. */
  const runsResp = await softGh(`/repos/${REPO}/actions/runs?head_sha=${headSha}&per_page=100`);
  const runs = ((runsResp && runsResp.workflow_runs) || []).slice();
  runs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id);

  const jobsByName = new Map(); // first (newest) wins, so a re-run supersedes
  const runUrls = [];
  for (const run of runs) {
    const jobsResp = await softGh(`/repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100`);
    const jobs = (jobsResp && jobsResp.jobs) || [];
    if (jobs.length) runUrls.push(run.html_url);
    for (const job of jobs) {
      if (!jobsByName.has(job.name)) jobsByName.set(job.name, job);
    }
  }
  guards.run_urls = runUrls;

  const state = (o) => (o ? (o.status === "completed" ? o.conclusion : o.status) : null);
  for (const line of guardLines) {
    const job = jobsByName.get(line.pattern);
    if (line.who === "-") {
      guards.results.push({ job: line.pattern, step: null, state: state(job) });
      continue;
    }
    const step = job ? (job.steps || []).find((st) => st.name === line.who) : null;
    guards.results.push({ job: line.pattern, step: line.who, state: state(step) });
  }

  /* Everything else reported on the head SHA. Strict CI-green policy: a red or
     unfinished sibling check refuses too. */
  const checksResp = await softGh(`/repos/${REPO}/commits/${headSha}/check-runs?per_page=100`);
  for (const c of (checksResp && checksResp.check_runs) || []) {
    if (c.name === SELF_CHECK_NAME) continue; // this gate, running right now
    if (c.status !== "completed") {
      guards.pending_checks.push(c.name);
    } else if (!["success", "neutral", "skipped"].includes(c.conclusion)) {
      guards.failing_checks.push(`${c.name} (${c.conclusion})`);
    }
  }
}

process.stdout.write(
  JSON.stringify(
    {
      repo: REPO,
      pr_number: Number(PR),
      head_repo: headRepo,
      head_sha: headSha,
      base_ref: pr.base.ref,
      base_sha: pr.base.sha,
      draft: pr.draft === true,
      /* Always an array, never null when the PR object was read: an absent
         label list is a fact the decider refuses on, and "no labels" must not
         look like "could not read the labels". */
      labels: (pr.labels || []).map((l) => (l && typeof l === "object" ? l.name : l)).filter((n) => typeof n === "string"),
      author: pr.user ? pr.user.login : null,
      author_permission: authorPermission,
      files,
      files_truncated: filesTruncated,
      base_template_ids: baseTemplateIds,
      registry_base: registryBase,
      registry_head: registryHead,
      config_yaml_head: configYamlHead,
      sample_json_head: sampleJsonHead,
      guards,
    },
    null,
    2,
  ) + "\n",
);

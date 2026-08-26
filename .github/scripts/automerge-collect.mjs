#!/usr/bin/env node
/**
 * automerge-collect.mjs — gathers the FACTS the gate decides on, and nothing else.
 *
 * It never decides and it never merges. It reads the GitHub API and the BASE
 * checkout on disk, and writes one `case.json`. `automerge-decide.mjs` is the
 * only place a verdict is formed, which is what keeps the verdict unit-testable
 * with no network.
 *
 * IT NEVER EXECUTES HEAD CODE. The head side is read as two pieces of DATA
 * only: the changed-file list, and the text of `registry.json` at the head SHA,
 * which is JSON.parse'd. No head checkout, no `npm ci` of a head lockfile, no
 * head script ever runs in this job — and this job holds a write token.
 *
 * Usage:
 *   GITHUB_TOKEN=... node automerge-collect.mjs \
 *     --repo owner/name --pr 123 --base-checkout /path/to/base > case.json
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

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

/* Head side: TWO pieces of data, no code. Skipped entirely for a fork, whose
   head SHA is not an object of this repository. */
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

/* ------------------------------------------------------------- the guards */
/*
 * We resolve the three BLOCKING guards by NAME, individually:
 *
 *   - the `lint-css` job                -> "Lint CSS scoping"
 *   - the `preview-regen` job           -> "Canvas fill + previews"
 *   - its step "Check canvas fill"      -> npm run check:canvas
 *   - its step "Check theme conformance"-> npm run check:theme
 *
 * 🚨 THE `preview-regen` JOB BEING GREEN IS NOT EVIDENCE THAT THE PREVIEW
 * RASTERS MATCH. Its "Check for preview drift" step emits `::warning::` and
 * exits 0 on purpose (CI fonts and Chromium differ from a local render), so a
 * template whose PNG changed for a BAD reason still shows a green job. That is
 * plan risk 8 and Verification criterion 2, and it is exactly why this gate is
 * scoped to a NEW directory: for a new template there is no previously approved
 * raster to drift from. Do not widen this gate on the strength of that green.
 *
 * We assert the two STEPS by name, not only the job, so that deleting or
 * renaming a guard step fails closed instead of inheriting the job's green.
 */
const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
const LINT_JOB = "Lint CSS scoping";
const PREVIEW_JOB = "Canvas fill + previews";
const CANVAS_STEP = "Check canvas fill";
const THEME_STEP = "Check theme conformance";

const guards = { head_sha: headSha, failing_checks: [], pending_checks: [] };

if (sameRepo) {
  const runsResp = await softGh(`/repos/${REPO}/actions/runs?head_sha=${headSha}&per_page=100`);
  const ciRuns = ((runsResp && runsResp.workflow_runs) || []).filter((r) => r.path === CI_WORKFLOW_PATH);
  /* Newest attempt wins: a re-run supersedes the run it re-ran. */
  ciRuns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id);
  const ciRun = ciRuns[0];

  if (!ciRun) {
    process.stderr.write(`note: no ${CI_WORKFLOW_PATH} run found for ${headSha}\n`);
  } else {
    guards.ci_run_url = ciRun.html_url;
    const jobsResp = await softGh(`/repos/${REPO}/actions/runs/${ciRun.id}/jobs?per_page=100`);
    const jobs = (jobsResp && jobsResp.jobs) || [];
    const jobState = (job) => (job ? (job.status === "completed" ? job.conclusion : job.status) : null);
    const lintJob = jobs.find((j) => j.name === LINT_JOB);
    const previewJob = jobs.find((j) => j.name === PREVIEW_JOB);
    guards.lint_css_job = jobState(lintJob);
    guards.preview_regen_job = jobState(previewJob);

    const stepState = (job, stepName) => {
      if (!job) return null;
      const step = (job.steps || []).find((s) => s.name === stepName);
      if (!step) return null;
      return step.status === "completed" ? step.conclusion : step.status;
    };
    guards.check_canvas_step = stepState(previewJob, CANVAS_STEP);
    guards.check_theme_step = stepState(previewJob, THEME_STEP);
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
      author: pr.user ? pr.user.login : null,
      author_permission: authorPermission,
      files,
      files_truncated: filesTruncated,
      base_template_ids: baseTemplateIds,
      registry_base: registryBase,
      registry_head: registryHead,
      guards,
    },
    null,
    2,
  ) + "\n",
);

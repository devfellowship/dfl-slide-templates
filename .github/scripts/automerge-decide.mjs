#!/usr/bin/env node
/**
 * automerge-decide.mjs — the ONE decision point of the auto-merge gate.
 *
 * It is a pure function of a "case" object: no network, no git, no clock. The
 * workflow collects the facts (`automerge-collect.mjs`) and this file decides.
 * That split is what makes the gate testable: `automerge-decide.test.mjs`
 * constructs a new-template case, an existing-template-edit case and a fork
 * case and asserts the verdict of each.
 *
 * All path knowledge lives in `.github/automerge-rules.conf`. This file holds
 * the invariants that a glob cannot express, and nothing else.
 *
 * Usage:  node automerge-decide.mjs <case.json> [--conf <path>]
 * Output: one JSON verdict on stdout. Exit 0 = ALLOW, exit 1 = BLOCK.
 *         A BLOCK is a normal, successful outcome of the gate; the workflow
 *         turns it into a comment, never into a merge and never into a failure.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

/** Every invariant this file implements. The conf must list exactly these. */
export const KNOWN_INVARIANTS = [
  "same-repo-head",
  "author-has-write",
  "not-draft",
  "no-deletions",
  "new-template-dir-only",
  "registry-single-append",
  "guards-green",
];

const WRITE_PERMISSIONS = new Set(["admin", "maintain", "write"]);

/* ------------------------------------------------------------------ globs */

/**
 * Same semantics as skills/safe-admin-merge/protected_paths.conf:
 *   `**` crosses `/`, `*` stays inside one segment, `?` is one non-`/` char.
 * Everything else is literal.
 */
export function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(out + "$");
}

export function globMatch(glob, filePath) {
  return globToRegExp(glob).test(filePath);
}

/* ------------------------------------------------------------------- conf */

export function parseConf(text) {
  const rules = { human: [], automerge: [], invariant: [] };
  const errors = [];
  text.split("\n").forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const parts = line.split("|");
    if (parts.length !== 4) {
      errors.push(`line ${idx + 1}: expected 4 '|'-separated fields, got ${parts.length}`);
      return;
    }
    const [decision, pattern, who, why] = parts.map((p) => p.trim());
    if (!rules[decision]) {
      errors.push(`line ${idx + 1}: unknown decision '${decision}'`);
      return;
    }
    if (!pattern || !who || !why) {
      errors.push(`line ${idx + 1}: empty field`);
      return;
    }
    rules[decision].push({ pattern, who, why, line: idx + 1 });
  });
  return { rules, errors };
}

/* ------------------------------------------------------------------ utils */

const block = (rule, reason, who = "Tainan (@taigfs)", retryable = false) => ({
  decision: "BLOCK",
  rule,
  who,
  reason,
  /* `retryable` means ONLY "this fact may still change while CI runs" — the
     workflow polls again instead of commenting. It never means "merge anyway".
     A refusal is a refusal at every poll. */
  retryable,
});

/* Check-run / job states that simply have not finished yet. */
const PENDING_STATES = new Set([null, undefined, "queued", "in_progress", "pending", "waiting", "requested"]);

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** All the top-level keys of the registry except `templates`. */
function registryShell(reg) {
  if (reg === null || typeof reg !== "object" || Array.isArray(reg)) return null;
  const shell = {};
  for (const k of Object.keys(reg).sort()) if (k !== "templates") shell[k] = reg[k];
  return shell;
}

/* --------------------------------------------------------------- decision */

export function decide(kase, conf) {
  /* --- 0. the conf must be complete and implementable. Fail-closed both ways. */
  if (conf.errors.length) {
    return block("conf-integrity", `automerge-rules.conf is unparseable: ${conf.errors.join("; ")}`);
  }
  const listed = conf.rules.invariant.map((r) => r.pattern);
  const unknown = listed.filter((n) => !KNOWN_INVARIANTS.includes(n));
  if (unknown.length) {
    return block(
      "conf-unknown-invariant",
      `automerge-rules.conf lists invariant(s) this decider does not implement: ${unknown.join(", ")}`,
    );
  }
  const missing = KNOWN_INVARIANTS.filter((n) => !listed.includes(n));
  if (missing.length) {
    return block(
      "conf-incomplete",
      `automerge-rules.conf omits invariant(s) this decider enforces: ${missing.join(", ")}. ` +
        `Removing an invariant line does not relax the gate, it breaks it.`,
    );
  }
  if (!conf.rules.automerge.length) {
    return block("conf-integrity", "automerge-rules.conf declares no automerge glob, so nothing may auto-merge");
  }
  const inv = (name) => conf.rules.invariant.find((r) => r.pattern === name);

  /* --- 1. security preconditions, before anything about the diff. --------- */

  /* A fork PR on a PUBLIC repo is an untrusted stranger's code. Compared as
     full names, never as author names. */
  if (!kase.repo || !kase.head_repo || kase.head_repo !== kase.repo) {
    const r = inv("same-repo-head");
    return block(
      "same-repo-head",
      `the head branch lives in '${kase.head_repo ?? "(unknown)"}', not in '${kase.repo ?? "(unknown)"}'. ${r.why}`,
      r.who,
    );
  }

  /* Read from the collaborator-permission API. NEVER inferred from the author
     name, and never from author_association (which reports CONTRIBUTOR for a
     first-time org member and can be spoofed by a maintainer-look-alike). */
  {
    const r = inv("author-has-write");
    if (!WRITE_PERMISSIONS.has(String(kase.author_permission))) {
      return block(
        "author-has-write",
        `author '${kase.author ?? "(unknown)"}' has permission '${kase.author_permission ?? "(unknown)"}' on this repo, ` +
          `which is not one of admin/maintain/write. ${r.why}`,
        r.who,
      );
    }
  }

  if (kase.draft === true) {
    const r = inv("not-draft");
    return block("not-draft", `the pull request is a draft. ${r.why}`, r.who);
  }

  /* --- 2. the diff. ------------------------------------------------------- */

  const files = Array.isArray(kase.files) ? kase.files : null;
  if (!files || files.length === 0) {
    return block("no-files", "the changed-file list is empty or could not be read, so the diff cannot be judged");
  }
  if (kase.files_truncated === true) {
    return block("no-files", "the changed-file list was truncated by the API, so the diff cannot be judged in full");
  }

  const deletions = files.filter((f) => f.status === "removed" || f.status === "renamed");
  if (deletions.length) {
    const r = inv("no-deletions");
    return block(
      "no-deletions",
      `the diff removes or renames ${deletions.length} path(s), e.g. '${deletions[0].path}'. ${r.why}`,
      r.who,
    );
  }

  /* `human` wins over `automerge`, and is evaluated first. */
  for (const f of files) {
    for (const r of conf.rules.human) {
      if (globMatch(r.pattern, f.path)) {
        return block(
          "human-gated-path",
          `'${f.path}' matches the human-gated rule '${r.pattern}' (automerge-rules.conf line ${r.line}): ${r.why}`,
          r.who,
        );
      }
    }
  }

  /* Default deny: no catch-all glob exists, so an unlisted shape refuses. */
  for (const f of files) {
    if (!conf.rules.automerge.some((r) => globMatch(r.pattern, f.path))) {
      return block(
        "unlisted-path",
        `'${f.path}' matches no automerge glob in automerge-rules.conf. The default is deny: ` +
          `a new file shape stays human-gated until somebody adds a line to that file.`,
      );
    }
  }

  /* --- 3. new-template-dir-only ------------------------------------------ */

  const templateFiles = files.filter((f) => f.path.startsWith("templates/"));
  let newId;
  {
    const r = inv("new-template-dir-only");
    if (templateFiles.length === 0) {
      return block(
        "new-template-dir-only",
        `the diff touches no templates/ path, so it is not a new template. ${r.why}`,
        r.who,
      );
    }
    const ids = [...new Set(templateFiles.map((f) => f.path.split("/")[1]))].sort();
    if (ids.length !== 1) {
      return block(
        "new-template-dir-only",
        `the diff touches ${ids.length} template directories (${ids.join(", ")}). Exactly one is allowed. ${r.why}`,
        r.who,
      );
    }
    newId = ids[0];
    const baseIds = Array.isArray(kase.base_template_ids) ? kase.base_template_ids : null;
    if (!baseIds) {
      return block(
        "new-template-dir-only",
        "the list of template directories on the base commit could not be read, so 'new' cannot be established",
        r.who,
      );
    }
    if (baseIds.includes(newId)) {
      return block(
        "new-template-dir-only",
        `'templates/${newId}/' ALREADY EXISTS on ${kase.base_ref ?? "the base branch"}. ` +
          `Editing an existing template changes every live deck that uses it. ${r.why}`,
        r.who,
      );
    }
    const notAdded = templateFiles.filter((f) => f.status !== "added");
    if (notAdded.length) {
      return block(
        "new-template-dir-only",
        `'${notAdded[0].path}' has status '${notAdded[0].status}', not 'added', inside a directory reported as new. ${r.why}`,
        r.who,
      );
    }
  }

  /* --- 4. registry-single-append ----------------------------------------- */

  {
    const r = inv("registry-single-append");
    const touchesRegistry = files.some((f) => f.path === "registry.json");
    if (!touchesRegistry) {
      return block(
        "registry-single-append",
        "the diff adds a template directory but no registry.json entry, so the studio MCP would never list it. " +
          "Add the entry in the same PR.",
        r.who,
      );
    }
    const base = kase.registry_base;
    const head = kase.registry_head;
    if (!base || !head || !Array.isArray(base.templates) || !Array.isArray(head.templates)) {
      return block(
        "registry-single-append",
        "registry.json could not be read and parsed on both the base and the head commit",
        r.who,
      );
    }
    if (!deepEqual(registryShell(base), registryShell(head))) {
      return block(
        "registry-single-append",
        `the diff changes a top-level registry.json key other than templates[]. ${r.why}`,
        r.who,
      );
    }
    if (head.templates.length !== base.templates.length + 1) {
      return block(
        "registry-single-append",
        `registry.json goes from ${base.templates.length} to ${head.templates.length} entries; exactly one more is allowed. ${r.why}`,
        r.who,
      );
    }
    if (!deepEqual(head.templates.slice(0, base.templates.length), base.templates)) {
      return block(
        "registry-single-append",
        "the new registry.json entry is not appended at the END, or a pre-existing entry changed. " +
          "Every pre-existing entry must stay byte-identical and in the same order; the studio MCP serves them live.",
        r.who,
      );
    }
    const appended = head.templates[head.templates.length - 1];
    if (!appended || appended.id !== newId) {
      return block(
        "registry-single-append",
        `the appended registry.json entry has id '${appended && appended.id}', which is not the new template id '${newId}'`,
        r.who,
      );
    }
  }

  /* --- 5. guards-green, on the HEAD SHA ---------------------------------- */

  {
    const r = inv("guards-green");
    const g = kase.guards;
    if (!g || typeof g !== "object") {
      return block("guards-green", "no guard result was collected for the head SHA", r.who, true);
    }
    if (g.head_sha && kase.head_sha && g.head_sha !== kase.head_sha) {
      return block(
        "guards-green",
        `the guard results were read for ${g.head_sha}, not for the head SHA ${kase.head_sha}`,
        r.who,
        true,
      );
    }
    /* Named individually so that a REMOVED or RENAMED guard fails closed
       instead of silently passing. */
    const required = [
      ["lint_css_job", "the lint-css job (Lint CSS scoping)"],
      ["preview_regen_job", "the preview-regen job (Canvas fill + previews)"],
      ["check_canvas_step", "the 'Check canvas fill' step inside preview-regen"],
      ["check_theme_step", "the 'Check theme conformance' step inside preview-regen"],
    ];
    for (const [key, label] of required) {
      if (g[key] !== "success") {
        return block(
          "guards-green",
          `${label} is '${g[key] ?? "absent"}' on the head SHA, not 'success'. ` +
            `An absent guard is not a passing guard.`,
          r.who,
          PENDING_STATES.has(g[key]),
        );
      }
    }
    if (Array.isArray(g.failing_checks) && g.failing_checks.length) {
      return block(
        "guards-green",
        `other check run(s) on the head SHA are not green: ${g.failing_checks.join(", ")}`,
        r.who,
      );
    }
    if (Array.isArray(g.pending_checks) && g.pending_checks.length) {
      return block(
        "guards-green",
        `check run(s) on the head SHA are still running: ${g.pending_checks.join(", ")}`,
        r.who,
        true,
      );
    }
  }

  return {
    decision: "ALLOW",
    rule: "new-template-dir-only",
    who: "nobody — unattended merge",
    reason:
      `the diff adds only the NEW directory templates/${newId}/ (${templateFiles.length} added file(s)) ` +
      `plus one appended registry.json entry for '${newId}', and every blocking guard is green on the head SHA.`,
  };
}

/* --------------------------------------------------------------------- CLI */

export function loadConf(confPath) {
  return parseConf(readFileSync(confPath, "utf8"));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = process.argv.slice(2);
  const casePath = args.find((a) => !a.startsWith("--"));
  const confIdx = args.indexOf("--conf");
  const confPath =
    confIdx >= 0 ? args[confIdx + 1] : path.join(path.dirname(new URL(import.meta.url).pathname), "..", "automerge-rules.conf");

  if (!casePath) {
    console.error("usage: automerge-decide.mjs <case.json> [--conf <path>]");
    process.exit(2);
  }

  let verdict;
  try {
    const kase = JSON.parse(readFileSync(casePath, "utf8"));
    verdict = decide(kase, loadConf(confPath));
  } catch (err) {
    /* Never fail open: an exception is a refusal, not an allowance. */
    verdict = block("internal-error", `the decider threw: ${err && err.message}`);
  }
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.decision === "ALLOW" ? 0 : 1);
}

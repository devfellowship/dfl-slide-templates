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
  "non-empty-sample-source",
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
  const rules = { human: [], automerge: [], invariant: [], guard: [] };
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

/* ------------------------------------------------ config.yaml slot reader */

/*
 * A DELIBERATELY TINY YAML READER, for one question only: how many slots does
 * this template declare, and how many of them carry a usable `sample:` value?
 *
 * It is hand-written because this gate NEVER runs `npm ci`. The workflow checks
 * out the BASE branch and installs nothing, on purpose, so that a head lockfile
 * cannot choose what code runs in a job that holds a write token. `yaml` is
 * therefore not importable here, and it must not become importable.
 *
 * It reads the one shape every config.yaml in this repository uses: top-level
 * scalar keys, `slots:` as a block sequence of mappings (or the empty flow
 * sequence `[]`), block scalars (`|`, `>`) and nested block values. It does NOT
 * implement YAML. Anything it does not recognise returns `{ error }`, and an
 * error is a BLOCK — never "no sample found", and never a pass.
 *
 * It mirrors `scripts/render-page.ts:readConfigSample()`: a slot contributes a
 * sample only when it declares BOTH a non-empty `name:` and a non-empty
 * `sample:`. A rule that counted more than the renderer reads would let a
 * blank preview through.
 */

/** `|`, `|-`, `>`, `>2`, `|+` … — a block scalar header, not a value. */
const BLOCK_SCALAR = /^[|>][-+]?[0-9]*$/;

/** Scalars that are written but hold nothing. `[]` is the one that matters. */
const EMPTY_SCALARS = new Set(["", "[]", "{}", '""', "''", "~", "null", "Null", "NULL"]);

const KEY_LINE = /^([A-Za-z0-9_.-]+):(.*)$/;

export function parseConfigSlots(text) {
  if (typeof text !== "string") return { error: "the file was not read as text" };

  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const indentOf = (l) => l.length - l.replace(/^ +/, "").length;
  const skippable = (l) => l.trim() === "" || l.trim().startsWith("#");
  const snip = (s) => s.trim().slice(0, 60);

  for (let n = 0; n < lines.length; n++) {
    if (/^ *\t/.test(lines[n])) return { error: `line ${n + 1}: indented with a TAB, which YAML forbids` };
  }

  /* How far does a key's nested block or block scalar reach, and does it hold
     anything at all? Used both to skip content and to answer "is this
     `sample:` a header with a block under it, or an empty key?". */
  const spanOf = (at, keyIndent, value) => {
    if (value !== "" && !BLOCK_SCALAR.test(value)) return { hasBlock: false, next: at + 1 };
    let k = at + 1;
    let hasBlock = false;
    while (k < lines.length && (skippable(lines[k]) || indentOf(lines[k]) > keyIndent)) {
      if (!skippable(lines[k])) hasBlock = true;
      k++;
    }
    return { hasBlock, next: k };
  };

  /* --- find the top-level `slots:` key ---------------------------------- */
  /* Walked key by key, skipping the content of every block scalar, so that a
     `slots:` line sitting inside prose is never mistaken for the real key. */
  let i = 0;
  let slotsAt = -1;
  while (i < lines.length) {
    if (skippable(lines[i])) { i++; continue; }
    const ind = indentOf(lines[i]);
    if (ind !== 0) {
      return { error: `line ${i + 1}: unexpected indent ${ind} at the top level ('${snip(lines[i])}')` };
    }
    const m = KEY_LINE.exec(lines[i]);
    if (!m) return { error: `line ${i + 1}: expected a top-level 'key:' line, got '${snip(lines[i])}'` };
    if (m[1] === "slots") { slotsAt = i; break; }
    i = spanOf(i, 0, m[2].trim()).next;
  }
  if (slotsAt < 0) return { error: "no top-level 'slots:' key" };

  /* --- `slots: []` — the zero-slot spelling this repository uses --------- */
  const inline = KEY_LINE.exec(lines[slotsAt])[2].trim();
  if (inline === "[]") return { slots: 0, withSample: 0 };
  if (inline !== "") {
    return { error: `line ${slotsAt + 1}: 'slots:' has the inline value '${inline.slice(0, 40)}'; only a block sequence or [] is understood` };
  }

  /* --- the block sequence ----------------------------------------------- */
  let j = slotsAt + 1;
  while (j < lines.length && skippable(lines[j])) j++;
  /* `slots:` with nothing under it declares no slot. Same outcome as `[]`. */
  if (j >= lines.length || indentOf(lines[j]) === 0) return { slots: 0, withSample: 0 };

  const seqIndent = indentOf(lines[j]);
  if (!lines[j].slice(seqIndent).startsWith("- ")) {
    return { error: `line ${j + 1}: 'slots:' is followed by '${snip(lines[j])}', which is not a '- ' sequence item` };
  }
  const mapIndent = seqIndent + 2;

  let slots = 0;
  let withSample = 0;
  let item = null; // { hasName, hasSample }

  const closeItem = () => {
    if (item && item.hasName && item.hasSample) withSample++;
    item = null;
  };

  while (j < lines.length) {
    if (skippable(lines[j])) { j++; continue; }
    const ind = indentOf(lines[j]);
    if (ind === 0) break; // the next top-level key ends the sequence
    if (ind < seqIndent) {
      return { error: `line ${j + 1}: indent ${ind} is shallower than the slots sequence (${seqIndent}) but not top-level` };
    }

    let keyText;
    if (ind === seqIndent) {
      if (!lines[j].slice(seqIndent).startsWith("- ")) {
        return { error: `line ${j + 1}: expected a '- ' sequence item at indent ${seqIndent}, got '${snip(lines[j])}'` };
      }
      closeItem();
      slots++;
      item = { hasName: false, hasSample: false };
      keyText = lines[j].slice(mapIndent);
    } else if (ind === mapIndent) {
      if (!item) return { error: `line ${j + 1}: a mapping key appears before any '- ' sequence item` };
      keyText = lines[j].slice(mapIndent);
    } else {
      return { error: `line ${j + 1}: indent ${ind} is neither the sequence indent (${seqIndent}) nor the mapping indent (${mapIndent})` };
    }

    const m = KEY_LINE.exec(keyText);
    if (!m) return { error: `line ${j + 1}: expected a 'key: value' mapping, got '${snip(keyText)}'` };
    const key = m[1];
    const value = m[2].trim();
    const span = spanOf(j, mapIndent, value);

    if (key === "name" && !EMPTY_SCALARS.has(value) && !BLOCK_SCALAR.test(value)) item.hasName = true;
    if (key === "sample") {
      /* Non-empty inline scalar, or a block/nested value that actually holds
         lines. `sample:` alone, or `sample: []`, holds nothing. */
      item.hasSample = BLOCK_SCALAR.test(value) || value === "" ? span.hasBlock : !EMPTY_SCALARS.has(value);
    }

    j = span.next;
  }
  closeItem();

  return { slots, withSample };
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

  /* --- 5. non-empty-sample-source ---------------------------------------- */
  /*
   * A new template that ships no sample data renders every slot with the empty
   * string. Its committed preview is blank, and `check:canvas` / `check:theme`
   * then pass against an empty layout — green, and proving nothing about a
   * populated render. A blank template merging unattended is worse than one
   * that is blocked, so the gate refuses it here.
   *
   * The precedence MIRRORS `scripts/render-page.ts:resolveSampleData()`, and it
   * must keep mirroring it: a PRESENT `sample.json` is the whole answer at
   * render time, never merged with `config.yaml`. So an EMPTY `sample.json`
   * blanks the render even when every slot in `config.yaml` carries a
   * `sample:`. A rule that read the two as interchangeable would allow exactly
   * the blank preview it exists to stop.
   */
  let sampleNote;
  {
    const r = inv("non-empty-sample-source");
    const configPath = `templates/${newId}/config.yaml`;
    const samplePath = `templates/${newId}/sample.json`;
    /* Every templates/ path in this diff is `added` and the directory does not
       exist on the base, both already established above. So the changed-file
       list IS the complete listing of the new directory: a file absent from it
       is absent from the template. */
    const shipsConfig = files.some((f) => f.path === configPath);
    const shipsSample = files.some((f) => f.path === samplePath);

    if (!shipsConfig) {
      return block(
        "non-empty-sample-source",
        `the new template ships no ${configPath}, so the gate cannot tell whether it declares any fillable slot. ${r.why}`,
        r.who,
      );
    }

    const cfg = kase.config_yaml_head;
    if (!cfg || typeof cfg.text !== "string") {
      return block(
        "non-empty-sample-source",
        `${configPath} could not be read at the head SHA${cfg && cfg.error ? ` (${cfg.error})` : ""}. ` +
          `A gate that opens when it cannot see is not a gate.`,
        r.who,
      );
    }
    const slotsInfo = parseConfigSlots(cfg.text);
    if (slotsInfo.error) {
      return block(
        "non-empty-sample-source",
        `${configPath} could not be parsed: ${slotsInfo.error}. The sample source is therefore unknown, and unknown is a refusal.`,
        r.who,
      );
    }

    if (slotsInfo.slots === 0) {
      /* The `blank` case, handled ON PURPOSE and not by accident: a template
         that declares no slot has nothing to fill, so it needs no sample and
         its preview is legitimately empty. `templates/blank/` on main ships no
         sample.json for exactly this reason. */
      sampleNote = `${configPath} declares zero slots, so this template has nothing to fill and needs no sample source`;
    } else if (shipsSample) {
      const smp = kase.sample_json_head;
      if (!smp || typeof smp.text !== "string") {
        return block(
          "non-empty-sample-source",
          `${samplePath} is in the diff but could not be read at the head SHA${smp && smp.error ? ` (${smp.error})` : ""}. ` +
            `A gate that opens when it cannot see is not a gate.`,
          r.who,
        );
      }
      let parsed;
      try {
        parsed = JSON.parse(smp.text);
      } catch (err) {
        return block(
          "non-empty-sample-source",
          `${samplePath} is not valid JSON (${err && err.message}), so render-page.ts would throw and no preview could be produced.`,
          r.who,
        );
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return block(
          "non-empty-sample-source",
          `${samplePath} must contain a JSON object keyed by slot name, and render-page.ts throws on anything else.`,
          r.who,
        );
      }
      const keys = Object.keys(parsed);
      if (keys.length === 0) {
        return block(
          "non-empty-sample-source",
          `${samplePath} is an empty JSON object, and ${configPath} declares ${slotsInfo.slots} slot(s) to fill. ` +
            `render-page.ts treats a PRESENT sample.json as the whole answer, so the per-slot \`sample:\` values in ` +
            `config.yaml would NOT be used: every slot renders empty and the committed preview is blank. ${r.why}`,
          r.who,
        );
      }
      sampleNote = `${samplePath} supplies ${keys.length} slot value(s) for ${slotsInfo.slots} declared slot(s)`;
    } else if (slotsInfo.withSample === 0) {
      return block(
        "non-empty-sample-source",
        `the new template ships no ${samplePath}, and none of the ${slotsInfo.slots} slot(s) in ${configPath} carries a ` +
          `\`sample:\` value. Every slot would render empty, the committed preview would be blank, and check:canvas / ` +
          `check:theme would pass against an empty layout. ${r.why}`,
        r.who,
      );
    } else {
      sampleNote = `${configPath} carries a \`sample:\` value on ${slotsInfo.withSample} of its ${slotsInfo.slots} slot(s)`;
    }
  }

  /* --- 6. guards-green, on the HEAD SHA ---------------------------------- */

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
    /* The guards are DATA: every `guard` line in the conf must resolve to a
       successful job or step on the head SHA. A renamed step therefore fails
       closed (absent is not passing) and is fixed by editing one conf line. */
    if (!conf.rules.guard.length) {
      return block("guards-green", "automerge-rules.conf declares no guard line, so nothing can be proven green", r.who);
    }
    const results = Array.isArray(g.results) ? g.results : null;
    if (!results) {
      return block("guards-green", "the guard results were not collected as a list", r.who, true);
    }
    for (const guard of conf.rules.guard) {
      const isJob = guard.who === "-";
      const label = isJob ? `the '${guard.pattern}' job` : `the '${guard.who}' step inside the '${guard.pattern}' job`;
      const hit = results.find((x) => x.job === guard.pattern && (isJob ? !x.step : x.step === guard.who));
      const state = hit ? hit.state : undefined;
      if (state !== "success") {
        return block(
          "guards-green",
          `${label} is '${state ?? "absent"}' on the head SHA, not 'success'. ` +
            `An absent guard is not a passing guard: if the job or the step was renamed, ` +
            `fix the matching guard line in automerge-rules.conf.`,
          r.who,
          PENDING_STATES.has(state),
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
      `plus one appended registry.json entry for '${newId}'; ${sampleNote}; ` +
      `and every blocking guard is green on the head SHA.`,
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

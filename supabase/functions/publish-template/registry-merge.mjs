/**
 * registry-merge.mjs — merge ONE entry into registry.json without losing
 * anything and without reformatting anything else.
 *
 * WHY THIS FILE EXISTS
 *   `publish-template` used to write the registry like this:
 *
 *       if (idx >= 0) currentRegistry.templates[idx] = registryEntry
 *       else          currentRegistry.templates.push(registryEntry)
 *       JSON.stringify(currentRegistry, null, 2)
 *
 *   That is a FULL REPLACEMENT of the entry, and `update_template` supplies
 *   exactly three fields (`id`, `version`, `category`). `registry.json` is
 *   `$schema_version: 2` and carries seven more per template — `name`,
 *   `when_to_use`, `avoid_when`, `media_profile`, `text_density`, `layout`,
 *   `tags` — and those seven are precisely what `dfl-mcp-studio`'s `rank.ts`
 *   scores on. So a version bump over MCP DELETED a template's
 *   discoverability and `search_templates` stopped ranking it for its own
 *   phrase. Every guard stayed green, because no guard reads that metadata.
 *   That is plan Gap 4 / risk 6:
 *   https://plans.devfellowship.com/20260822-branded-image-templates-deterministic-mcp
 *
 *   The re-stringify was a second, quieter defect. `registry.json` writes its
 *   `themes[]` entries one-per-line, column-aligned by hand. A full
 *   `JSON.stringify(…, null, 2)` explodes those 4 lines into 24 on EVERY
 *   template publish — an unrelated section rewritten to change one entry.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DELETION SEMANTICS — RFC 7396 JSON Merge Patch. THIS IS A DECISION.
 * ─────────────────────────────────────────────────────────────────────────
 *   omitted key   → PRESERVED. This is the whole fix. A caller that says
 *                   nothing about `when_to_use` is expressing no opinion, and
 *                   silence must never be read as "delete it".
 *   key: null     → DELETED. Explicit, and visible in the request.
 *   key: <value>  → REPLACED. Arrays replace wholesale (RFC 7396); nested
 *                   objects merge recursively.
 *
 *   Why deletion stays expressible: a merge that can never remove anything is
 *   its own bug. A misspelt or retired key would live in the source of truth
 *   forever with no writer able to reach it, and the only remaining route
 *   would be a hand-edited PR — which is exactly the manual step this write
 *   path exists to remove.
 *
 *   Why `null` and not a `clear_fields: []` side-channel: RFC 7396 is the
 *   standard spelling of this exact pair, `null` is not a legal value for any
 *   v2 registry field, and it keeps ONE object on the wire instead of an
 *   object plus a list that can disagree with it.
 *
 *   ⚠️ AND DELETION IS NOT UNATTENDED. `.github/automerge-rules.conf` carries
 *   the `registry-no-metadata-loss` invariant: a diff that drops an entry, an
 *   entry key, or a top-level key is REFUSED by the merge gate. So an explicit
 *   `null` produces a real PR that a human must merge. Expressible, never
 *   silent. The two layers are deliberately different: this file decides what
 *   a WRITE means, the gate decides what may MERGE unattended.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SURGICAL, NOT RE-SERIALISED
 * ─────────────────────────────────────────────────────────────────────────
 *   The document is edited as TEXT. Only the span of the one entry being
 *   written is replaced. Consequences, each one asserted in the test suite:
 *     • unknown top-level keys survive, because they are never re-encoded;
 *     • unknown keys inside OTHER entries survive for the same reason;
 *     • unknown keys inside the TARGET entry survive because the patch is a
 *       merge, not a replacement;
 *     • entry order never changes — an existing entry is rewritten in place,
 *       a new one is appended at the END (which `registry-single-append`
 *       requires);
 *     • a write that changes nothing produces a byte-identical document.
 *
 *   Dependency-free ESM on purpose: Deno imports it directly, and `node` runs
 *   its test suite with no install step, the same posture as
 *   `.github/scripts/automerge-decide.mjs`.
 */

export class RegistryMergeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegistryMergeError';
  }
}

/* ────────────────────────────────────────────────────────── merge patch ── */

/**
 * RFC 7396 JSON Merge Patch.
 *
 * @param {unknown} target the value already in the registry
 * @param {unknown} patch  the value supplied by the caller
 * @returns {unknown} the merged value
 */
export function mergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    // Scalars, arrays and `null` replace outright. RFC 7396 does not merge
    // arrays element-wise, and neither do we: `tags: ["a"]` means "the tags
    // are exactly a", never "add a".
    return patch;
  }
  const isPlainObject = target !== null && typeof target === 'object' && !Array.isArray(target);
  // Spreading preserves the target's key ORDER; keys the patch introduces are
  // appended after it. That is what keeps the diff of a changed entry small.
  const out = isPlainObject ? { ...target } : {};
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === null) {
      delete out[key];
    } else {
      out[key] = mergePatch(out[key], value);
    }
  }
  return out;
}

/* ───────────────────────────────────────────────────────── json scanner ── */
/*
 * A minimal, allocation-light scanner. It exists so that the document can be
 * edited by OFFSET instead of parsed and re-encoded. `JSON.parse` is still
 * used — on the one entry being written — so the merge itself works on real
 * values rather than on text.
 */

function skipWs(s, i) {
  while (i < s.length && (s[i] === ' ' || s[i] === '\n' || s[i] === '\t' || s[i] === '\r')) i++;
  return i;
}

function skipString(s, i) {
  if (s[i] !== '"') throw new RegistryMergeError(`expected a string at offset ${i}`);
  i++;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') i += 2;
    else if (c === '"') return i + 1;
    else i++;
  }
  throw new RegistryMergeError('unterminated string in registry.json');
}

function skipValue(s, i) {
  i = skipWs(s, i);
  const c = s[i];
  if (c === '"') return skipString(s, i);
  if (c === '{' || c === '[') {
    let depth = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '"') {
        i = skipString(s, i);
        continue;
      }
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    throw new RegistryMergeError('unterminated object or array in registry.json');
  }
  const m = /^(-?\d+(\.\d+)?([eE][-+]?\d+)?|true|false|null)/.exec(s.slice(i));
  if (!m) throw new RegistryMergeError(`unexpected token at offset ${i} in registry.json`);
  return i + m[0].length;
}

/** Offsets of the value of a TOP-LEVEL member, or null when absent. */
function findMemberValue(s, key) {
  let i = skipWs(s, 0);
  if (s[i] !== '{') throw new RegistryMergeError('registry.json is not a JSON object');
  i++;
  for (;;) {
    i = skipWs(s, i);
    if (s[i] === '}') return null;
    const keyEnd = skipString(s, i);
    const name = JSON.parse(s.slice(i, keyEnd));
    i = skipWs(s, keyEnd);
    if (s[i] !== ':') throw new RegistryMergeError(`expected ':' at offset ${i}`);
    const valueStart = skipWs(s, i + 1);
    const valueEnd = skipValue(s, valueStart);
    if (name === key) return { start: valueStart, end: valueEnd };
    i = skipWs(s, valueEnd);
    if (s[i] === ',') i++;
    else if (s[i] === '}') return null;
    else throw new RegistryMergeError(`expected ',' or '}' at offset ${i}`);
  }
}

/** Offsets of every element of the array whose `[` is at `start`. */
function arrayElements(s, start, end) {
  if (s[start] !== '[') throw new RegistryMergeError(`expected an array at offset ${start}`);
  const out = [];
  let i = start + 1;
  for (;;) {
    i = skipWs(s, i);
    if (s[i] === ']') return out;
    if (i >= end) throw new RegistryMergeError('malformed array in registry.json');
    const elStart = i;
    const elEnd = skipValue(s, i);
    out.push({ start: elStart, end: elEnd });
    i = skipWs(s, elEnd);
    if (s[i] === ',') i++;
    else if (s[i] === ']') return out;
    else throw new RegistryMergeError(`expected ',' or ']' at offset ${i}`);
  }
}

/**
 * The run of spaces that opens the line `offset` sits on, but ONLY when
 * `offset` is the first non-space character of that line. An offset in the
 * middle of a line has no indent of its own, and returning one would place a
 * new element at a column nothing else uses.
 */
function indentAt(s, offset) {
  const lineStart = s.lastIndexOf('\n', offset - 1) + 1;
  const head = s.slice(lineStart, offset);
  return /^[ \t]*$/.test(head) ? head : null;
}

/** The leading whitespace of the line containing `offset`, whatever sits on it. */
function lineIndentAt(s, offset) {
  const lineStart = s.lastIndexOf('\n', offset - 1) + 1;
  return /^[ \t]*/.exec(s.slice(lineStart))[0];
}

/* ────────────────────────────────────────────────────────── serialising ── */

/**
 * Render one entry in the style the surrounding array already uses.
 *
 * `registry.json`'s `templates[]` is byte-for-byte `JSON.stringify(_, null, 2)`
 * output — asserted by a test — so a re-encoded entry whose values did not
 * change is byte-identical to the one it replaces. `themes[]` is written one
 * entry per line by hand, so an entry there is rendered on one line.
 */
function serializeEntry(entry, indent, singleLine) {
  if (singleLine) {
    const body = Object.keys(entry)
      .map((k) => `${JSON.stringify(k)}: ${JSON.stringify(entry[k])}`)
      .join(', ');
    return `{ ${body} }`;
  }
  return JSON.stringify(entry, null, 2).split('\n').join('\n' + indent);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ──────────────────────────────────────────────────────────── the merge ── */

/**
 * What a NEW entry must carry, per array.
 *
 * `templates[]` asks only for the structural minimum. The discoverability
 * fields are NOT required here on purpose: this function is the backward
 * compatible half of the fix, and refusing an old caller's create would break
 * a path that works today. A new entry that arrives without them is reported
 * in `warnings` instead, and `dfl-mcp-studio:update_template` is where the
 * requirement is enforced — it is the layer that knows it is authoring one.
 *
 * `themes[]` is stricter, and the asymmetry is deliberate. A template with no
 * `when_to_use` is DEGRADED: it still lists, still renders, and ranks badly. A
 * theme entry with no `name`/`mode` is MALFORMED against the shape
 * `themes_doc` declares, and `list_themes` serves that array as the source of
 * truth. The only alternatives to refusing are to guess a company's display
 * name and to guess light vs dark — a wrong guess becomes the truth, and no
 * later call can tell it was a guess.
 */
const REQUIRED_ON_CREATE = {
  templates: ['id', 'version', 'category'],
  themes: ['id', 'name', 'file', 'mode'],
};

/** Fields `rank.ts` scores on. Their absence in a NEW template is a warning. */
const DISCOVERABILITY_FIELDS = ['name', 'when_to_use', 'media_profile', 'tags'];

/**
 * Which array a publish writes into, and the entry it writes.
 *
 * A THEME always registers itself, whether or not the caller sent a
 * `registryEntry`. `update_theme` used to write `themes/<id>.css` and nothing
 * else, so a theme published over MCP never entered `registry.json` — whose
 * own `themes_doc` calls that array the source of truth, and which
 * `list_themes` reads. A theme that renders correctly and is invisible to the
 * catalogue is the same defect class as Gap 4, on the theme side.
 *
 * `file` is DERIVED from the id, never taken from the caller, so it cannot
 * disagree with the CSS path the same request writes.
 *
 * A TEMPLATE registers only when the caller sends an entry: a pure HTML/CSS
 * edit with no registry field to change must leave `registry.json` alone.
 *
 * @param {'template'|'theme'} type
 * @param {string} id
 * @param {Record<string, unknown>|undefined} registryEntry
 * @returns {{ arrayKey: 'templates'|'themes', patch: Record<string, unknown> }|null}
 */
export function registryPatchFor(type, id, registryEntry) {
  if (type === 'theme') {
    return {
      arrayKey: 'themes',
      patch: { ...(registryEntry ?? {}), id, file: `themes/${id}.css` },
    };
  }
  if (!registryEntry) return null;
  return { arrayKey: 'templates', patch: { ...registryEntry, id } };
}

/**
 * Merge one entry into a top-level array of `registry.json`, as TEXT.
 *
 * @param {string} registryText the current file contents
 * @param {'templates'|'themes'} arrayKey which array the entry belongs to
 * @param {Record<string, unknown>} patch the entry, as an RFC 7396 merge patch
 * @returns {{ text: string, action: 'unchanged'|'updated'|'created', warnings: string[] }}
 */
export function applyRegistryEntry(registryText, arrayKey, patch) {
  if (typeof registryText !== 'string' || registryText.length === 0) {
    throw new RegistryMergeError('registry.json content is empty');
  }
  if (!REQUIRED_ON_CREATE[arrayKey]) {
    throw new RegistryMergeError(`unknown registry array '${arrayKey}'`);
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new RegistryMergeError('the registry entry must be a JSON object');
  }
  if (typeof patch.id !== 'string' || patch.id.length === 0) {
    throw new RegistryMergeError('the registry entry must carry a non-empty string id');
  }

  const arr = findMemberValue(registryText, arrayKey);
  if (!arr) {
    // Fail closed. Creating the array would guess at where it belongs in a
    // document this function is not allowed to reformat.
    throw new RegistryMergeError(
      `registry.json has no top-level "${arrayKey}" array, so the entry has nowhere to go`,
    );
  }

  const elements = arrayElements(registryText, arr.start, arr.end);
  const parsed = elements.map((e) => {
    try {
      return JSON.parse(registryText.slice(e.start, e.end));
    } catch {
      throw new RegistryMergeError(`registry.json["${arrayKey}"] holds an unparseable entry`);
    }
  });

  const matches = parsed
    .map((p, i) => (p && typeof p === 'object' && p.id === patch.id ? i : -1))
    .filter((i) => i >= 0);
  if (matches.length > 1) {
    // Ambiguous target. Writing one of them would silently leave the other.
    throw new RegistryMergeError(
      `registry.json["${arrayKey}"] carries the id '${patch.id}' ${matches.length} times, so the entry to merge into is ambiguous`,
    );
  }
  const idx = matches.length === 1 ? matches[0] : -1;
  const warnings = [];

  if (idx >= 0) {
    const merged = mergePatch(parsed[idx], patch);
    if (deepEqual(merged, parsed[idx])) {
      // Nothing to say. Returning the input unchanged keeps a no-op publish
      // out of the diff entirely.
      return { text: registryText, action: 'unchanged', warnings };
    }
    const span = elements[idx];
    const indent = indentAt(registryText, span.start) ?? '';
    const singleLine = !registryText.slice(span.start, span.end).includes('\n');
    const rendered = serializeEntry(merged, indent, singleLine);
    return {
      text: registryText.slice(0, span.start) + rendered + registryText.slice(span.end),
      action: 'updated',
      warnings,
    };
  }

  /* ── create ─────────────────────────────────────────────────────────── */

  const missing = REQUIRED_ON_CREATE[arrayKey].filter(
    (k) => patch[k] === undefined || patch[k] === null || patch[k] === '',
  );
  if (missing.length) {
    throw new RegistryMergeError(
      `a new "${arrayKey}" entry for '${patch.id}' is missing the required field(s) ${missing.join(', ')}. ` +
        `registry.json is the source of truth these are read from, so they are not guessed.`,
    );
  }
  if (arrayKey === 'templates') {
    const thin = DISCOVERABILITY_FIELDS.filter(
      (k) => patch[k] === undefined || patch[k] === null || patch[k] === '' ||
        (Array.isArray(patch[k]) && patch[k].length === 0),
    );
    if (thin.length) {
      warnings.push(
        `the new template '${patch.id}' carries no ${thin.join(', ')}, so search_templates cannot rank it. ` +
          `Send the full registry v2 shape from update_template.`,
      );
    }
  }

  const last = elements[elements.length - 1];
  if (!last) {
    // Empty array: `[]` or `[\n  ]`. Open it with the document's own step.
    const openIndent = lineIndentAt(registryText, arr.start);
    const indent = openIndent + '  ';
    const rendered = serializeEntry(patch, indent, false);
    const text =
      registryText.slice(0, arr.start + 1) +
      `\n${indent}${rendered}\n${openIndent}` +
      registryText.slice(arr.end - 1);
    return { text, action: 'created', warnings };
  }

  const ownLineIndent = indentAt(registryText, last.start);
  const singleLine = !registryText.slice(last.start, last.end).includes('\n');
  const rendered = serializeEntry(patch, ownLineIndent ?? '', singleLine);
  // An array whose elements each open their own line gets one more line. An
  // array written inline stays inline — either way only the appended text is
  // in the diff.
  const separator = ownLineIndent === null ? ', ' : `,\n${ownLineIndent}`;
  return {
    text: registryText.slice(0, last.end) + separator + rendered + registryText.slice(last.end),
    action: 'created',
    warnings,
  };
}

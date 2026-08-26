/**
 * CSS scoping linter.
 *
 * Rules enforced:
 *  1. No @layer rules.
 *  2. No :host pseudo-class.
 *  3. Every rule-set selector must be scoped under .tpl-root (i.e. every
 *     top-level selector must start with or include `.tpl-root`).
 *  4. The .tpl-root box must declare the canonical design canvas for the
 *     canvas its file is named after — 1280x720 landscape, 720x1280 portrait,
 *     1080x1350 social-portrait. See CANVAS_NOTE below.
 *  5. No hardcoded colour or font-family. Every colour and every type family
 *     must come from a theme token — `var(--token, <fallback>)`. See THEME_NOTE.
 *  6. Every `--s-*` / `--p-*` token a template reads must actually exist in
 *     at least one theme file. Catches typo'd token names that silently fall back.
 *  7. THEME COMPLETENESS — every one of those tokens must be defined by EVERY
 *     theme in registry.json, every theme must style the three shared .dfl-*
 *     chassis classes, and registry.json and theme.config.json must name the
 *     same themes. See lintThemes() for why a partial theme fails silently.
 *
 * Plus two rules that run once and are about the DECLARATION rather than any
 * single file:
 *
 *  0. canvas.config.json must be internally coherent — every declared canvas
 *     has a positive integer width and height, the landscape/portrait PAIR is
 *     still a transpose, and the cross-repo counterparts are still named. See
 *     lintCanvasConfig() for why that half lives here and the comparison does
 *     not.
 *  8. Every template's `canvases:` list in config.yaml must name only declared
 *     canvases, and must have exactly the HTML+CSS files it names — no more,
 *     no fewer. See lintTemplateCanvases().
 *
 * Usage: node scripts/lint-css.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative, basename, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const CANVAS = JSON.parse(
  readFileSync(join(__dirname, "canvas.config.json"), "utf8")
);
const FLUID = new Set(CANVAS.fluidTemplates);

/**
 * The declared canvas ids, in order. This list — not a hardcoded pair — is what
 * every guard iterates. `defaultCanvases` is what a template is taken to
 * declare when its config.yaml omits `canvases:`, which is how all 46
 * pre-existing templates stayed valid when the third canvas landed.
 */
const CANVAS_IDS = Array.isArray(CANVAS.canvases) ? CANVAS.canvases : [];
const DEFAULT_CANVAS_IDS = Array.isArray(CANVAS.defaultCanvases)
  ? CANVAS.defaultCanvases
  : [];
const CANVAS_ID_SET = new Set(CANVAS_IDS);

/**
 * Rule 0 — the canvas config must be internally coherent before any template
 * is judged against it.
 *
 * Until 2026-08-26 this rule asserted ONE thing: that portrait is landscape
 * transposed. That was correct while there were exactly two canvases, and it
 * was load-bearing — nothing else stopped someone editing `portrait` to
 * 720x1440, after which every guard in this repo would keep passing while
 * validating 46 templates against a shape the app never renders.
 *
 * It was also, by construction, a rule that could not admit a third canvas.
 * `social-portrait` is 1080x1350 (4:5) and transposes nothing, so "portrait ==
 * transpose(landscape)" REJECTED it as malformed. The rule is therefore split
 * into the two claims it was conflating:
 *
 *   · a claim about EVERY canvas — it is declared, and its width and height are
 *     positive integers. This is what a third canvas has to satisfy.
 *   · a claim about ONE PAIR — landscape and portrait stay a transpose, because
 *     dfl-lesson-studio derives portrait that way (`getDesignDimensions`) and
 *     the cross-repo contract check over there compares field-by-field on that
 *     assumption. The pair is data (`pairIsTransposed`), not an `if`.
 *
 * Weakening the pair check was NOT an option: it is the half that catches the
 * 720x1440 edit. Generalising means adding a per-canvas claim beside it, not
 * replacing it.
 *
 * The cross-repo half of the contract cannot run here: this repo is public and
 * dfl-lesson-studio is private, so reading it would need a token a public
 * workflow must not hold. This is the half that needs no credential.
 */
function lintCanvasConfig() {
  const errors = [];
  const { counterparts } = CANVAS;

  // --- the canvas LIST itself ---------------------------------------------
  if (CANVAS_IDS.length === 0) {
    errors.push(
      `scripts/canvas.config.json: "canvases" is missing or empty. It is the ` +
        `declared list of design canvases and every guard iterates it; with no ` +
        `list there is nothing to validate a template against.`
    );
    return errors;
  }

  // --- every declared canvas must be well-formed ---------------------------
  for (const id of CANVAS_IDS) {
    if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) {
      errors.push(
        `scripts/canvas.config.json: canvas id ${JSON.stringify(id)} is not a ` +
          `lowercase-kebab string. The id is used as a FILENAME ` +
          `(templates/<tpl>/<id>.css), so it must be path-safe.`
      );
      continue;
    }
    const box = CANVAS[id];
    if (!box || typeof box !== "object") {
      errors.push(
        `scripts/canvas.config.json: "canvases" declares "${id}", but there is ` +
          `no "${id}" block giving its width and height.`
      );
      continue;
    }
    for (const prop of ["width", "height"]) {
      const v = box[prop];
      if (!Number.isInteger(v) || v <= 0) {
        errors.push(
          `scripts/canvas.config.json: canvas "${id}" has ${prop}: ` +
            `${JSON.stringify(v)} — it must be a positive integer. A canvas is ` +
            `a viewport size in CSS pixels; a fraction or a zero renders a ` +
            `template into a box no screenshot can match.`
        );
      }
    }
  }

  // --- defaultCanvases must be a subset of the declared list ---------------
  if (DEFAULT_CANVAS_IDS.length === 0) {
    errors.push(
      `scripts/canvas.config.json: "defaultCanvases" is missing or empty. It ` +
        `is what a template is taken to declare when its config.yaml omits ` +
        `\`canvases:\`; without it every pre-existing template declares nothing ` +
        `and renders no preview at all.`
    );
  }
  for (const id of DEFAULT_CANVAS_IDS) {
    if (!CANVAS_ID_SET.has(id))
      errors.push(
        `scripts/canvas.config.json: "defaultCanvases" names "${id}", which is ` +
          `not in "canvases". The default must be a subset of what exists.`
      );
  }

  // --- the ONE pair that must stay a transpose -----------------------------
  // Held as data so a future pair costs a line here, not a patch below.
  const pairs = Object.entries(CANVAS.pairIsTransposed ?? {});
  if (pairs.length === 0) {
    errors.push(
      `scripts/canvas.config.json: "pairIsTransposed" is missing. It names the ` +
        `canvas pairs that must stay transposes of each other — today ` +
        `landscape/portrait, because dfl-lesson-studio DERIVES portrait from ` +
        `LANDSCAPE_WIDTH/HEIGHT instead of storing it. Deleting the block does ` +
        `not relax the rule, it removes the only check that the two repos ` +
        `still mean the same portrait.`
    );
  }
  for (const [aId, bId] of pairs) {
    const a = CANVAS[aId];
    const b = CANVAS[bId];
    if (!a || !b) {
      errors.push(
        `scripts/canvas.config.json: "pairIsTransposed" names ${aId}/${bId}, ` +
          `but one of them has no canvas block.`
      );
      continue;
    }
    if (b.width !== a.height || b.height !== a.width) {
      errors.push(
        `scripts/canvas.config.json: ${bId} is ${b.width}x${b.height}, but ` +
          `${aId} ${a.width}x${a.height} transposed is ${a.height}x${a.width}. ` +
          `${bId} must be ${aId} transposed — dfl-lesson-studio derives it ` +
          `that way (getDesignDimensions), and the cross-repo contract check ` +
          `there compares on that assumption.`
      );
    }
  }

  // --- the cross-repo counterparts must still be named ---------------------
  if (!Array.isArray(counterparts) || counterparts.length === 0) {
    errors.push(
      `scripts/canvas.config.json: the "counterparts" block is missing or ` +
        `empty. It names the other halves of the canvas contract (repo, file, ` +
        `symbols) and is what the check in dfl-lesson-studio is written ` +
        `against — losing it turns an enforced contract back into a comment.`
    );
  } else {
    for (const [n, cp] of counterparts.entries()) {
      if (!cp?.repo || !cp?.path || !cp?.symbols?.length || !cp?.enforcedBy)
        errors.push(
          `scripts/canvas.config.json: counterparts[${n}] is incomplete — it ` +
            `needs repo, path, symbols and enforcedBy. A counterpart with no ` +
            `named enforcer is a copy of these numbers that nothing scans, ` +
            `which is exactly the state dfl-render was in until 2026-08-26.`
        );
    }
  }

  return errors;
}

/**
 * Rule 8 — a template's declared canvases must be real, and must match the
 * files on disk exactly.
 *
 * `config.yaml` may carry `canvases: [landscape, portrait, social-portrait]`.
 * When the key is ABSENT the template declares `defaultCanvases`, which is why
 * all 46 templates that pre-date the third canvas needed no edit.
 *
 * Both directions are errors, and for different reasons:
 *   · declared but no file  → every guard would crash, or (worse) skip it;
 *   · a file but not declared → the renderer would refuse that canvas at
 *     runtime while the repo appears to support it, so the CSS is unlinted
 *     dead weight that looks live.
 */
function declaredCanvasesOf(templateId) {
  const configPath = join(REPO_ROOT, "templates", templateId, "config.yaml");
  if (!existsSync(configPath)) return { list: DEFAULT_CANVAS_IDS, explicit: false };
  const config = parseYaml(readFileSync(configPath, "utf8")) ?? {};
  if (config.canvases === undefined)
    return { list: DEFAULT_CANVAS_IDS, explicit: false };
  return { list: config.canvases, explicit: true };
}

function lintTemplateCanvases() {
  const errors = [];
  const templatesDir = join(REPO_ROOT, "templates");

  for (const templateId of readdirSync(templatesDir)) {
    const dir = join(templatesDir, templateId);
    if (!statSync(dir).isDirectory()) continue;

    const rel = `templates/${templateId}/config.yaml`;
    const { list, explicit } = declaredCanvasesOf(templateId);

    if (!Array.isArray(list) || list.length === 0) {
      errors.push(
        `${rel}: \`canvases:\` must be a non-empty list of canvas ids. Omit ` +
          `the key entirely to accept the default (${DEFAULT_CANVAS_IDS.join(", ")}); ` +
          `an empty list declares a template that can never be rendered.`
      );
      continue;
    }

    const declared = new Set();
    for (const id of list) {
      if (!CANVAS_ID_SET.has(id)) {
        errors.push(
          `${rel}: declares canvas "${id}", which scripts/canvas.config.json ` +
            `does not list. Declared canvases are ${CANVAS_IDS.join(", ")}. A ` +
            `canvas is added to the config FIRST — it is a cross-repo contract.`
        );
        continue;
      }
      if (declared.has(id))
        errors.push(`${rel}: declares canvas "${id}" twice.`);
      declared.add(id);
    }

    for (const id of declared) {
      for (const ext of ["html", "css"]) {
        if (!existsSync(join(dir, `${id}.${ext}`)))
          errors.push(
            `templates/${templateId}/${id}.${ext} is missing, but ` +
              `${explicit ? `${rel} declares` : `the default canvas list includes`} ` +
              `the "${id}" canvas. A declared canvas with no file renders nothing.`
          );
      }
    }

    // The other direction: a canvas-named file that nothing declares.
    for (const entry of readdirSync(dir)) {
      const m = entry.match(/^([a-z0-9-]+)\.(html|css)$/);
      if (!m || !CANVAS_ID_SET.has(m[1]) || declared.has(m[1])) continue;
      errors.push(
        `templates/${templateId}/${entry} exists, but ` +
          `${explicit ? rel : `templates/${templateId}/config.yaml`} does not ` +
          `declare the "${m[1]}" canvas. Add it to \`canvases:\` or delete the ` +
          `file — an undeclared canvas is REFUSED at render time (ADR-8: never ` +
          `fall back to the nearest canvas), so this CSS looks live and is not.`
      );
    }
  }

  return errors;
}

const THEME = JSON.parse(
  readFileSync(join(__dirname, "theme.config.json"), "utf8")
);

const REGISTRY = JSON.parse(readFileSync(join(REPO_ROOT, "registry.json"), "utf8"));

/**
 * Every theme, from `registry.json` — the source of truth for which themes
 * exist. Rule 6 is checked against ALL of them, because a token defined by one
 * theme and missing from another is invisible: the template falls back to its
 * var() literal, which is always the DevFellowship value, so the render looks
 * fine on DFL and wears DFL's colours on every other brand.
 */
const THEMES = REGISTRY.themes;

/** Token names a given theme file defines, e.g. "--s-surface-page". */
function tokensOf(themeFile) {
  return new Set(
    [...readFileSync(join(REPO_ROOT, themeFile), "utf8").matchAll(
      /(--[a-z0-9-]+)\s*:/gi
    )].map((m) => m[1])
  );
}

/**
 * The union of what every theme defines. Rule 6 uses this to answer "is this
 * token a typo?", and lintThemes() separately answers "does EVERY theme define
 * it?" — two different questions with two different error messages.
 */
const ANY_THEME_TOKENS = new Set(
  THEMES.flatMap((t) => [...tokensOf(t.file)])
);

const HOUSE_THEME_FILE =
  THEMES.find((t) => t.id === "devfellowship")?.file ?? THEMES[0].file;

const THEME_NOTE = `
  Colours and type families are owned by the theme (${HOUSE_THEME_FILE}), which is
  the CSS implementation of https://brand.devfellowship.com. A template that
  restates a value instead of reading the token stops following the brand the
  moment the brand moves — and, worse, a template that declares no colour at
  all (background: transparent) leaks whatever the host deck is painted with.
  That is exactly how the "table" slide ended up navy blue inside an otherwise
  near-black deck.

  Fix: use the token, keep the literal only as the var() fallback.
      background: var(--s-surface-page, #0a0908);
      color:      var(--s-ink-secondary, #c9c0b4);
      font-family: var(--s-font-display, 'Barlow Condensed', sans-serif);

  Translucent rgba()/hsla() (alpha < 1) is allowed without a token: it is a
  compositing value (scrim, hairline, dotted texture), not a palette entry.

  If a raw value is genuinely required, add it to "literalExceptions" in
  scripts/theme.config.json with a written rationale.`;

/**
 * Human-readable canvas list for the error notes.
 *
 * Defensive on purpose: this const is evaluated at module load, BEFORE rule 0
 * has had a chance to report that a declared canvas has no block. Reading
 * `CANVAS[id].width` blind would throw a TypeError there and replace a precise
 * lint error with a stack trace — the diagnosis lost to the crash that was
 * meant to describe it.
 */
function describeCanvases() {
  return CANVAS_IDS.map((id) => {
    const box = CANVAS[id];
    return box ? `${box.width}x${box.height} (${id})` : `(${id}: NOT DECLARED)`;
  }).join(", ");
}

const CANVAS_NOTE = `
  The design canvases are ${describeCanvases()}.
  A template that declares anything smaller renders into the top-left corner of
  the slide and leaves a dead band of page background down the right edge and
  along the bottom. 33 of 46 templates shipped at 960x540 (75% linear, ~56% of
  the area) and it went unnoticed for months — hence this rule.

  Fix: scale the template up to the canonical canvas. 960x540 -> 1280x720 is
  exactly 4/3, so multiplying every raw px value by 4/3 reproduces the design
  pixel-for-pixel at 133% with no layout change.

  If a template genuinely must size to its container, add it to
  "fluidTemplates" in scripts/canvas.config.json with a written rationale.`;

function findCssFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findCssFiles(full));
    } else if (entry.endsWith(".css")) {
      results.push(full);
    }
  }
  return results;
}

/**
 * A ".tpl-root box" selector: only chained classes on .tpl-root, no descendant,
 * child, pseudo-class or pseudo-element part. `.tpl-root.tpl-kpi` counts;
 * `.tpl-root.tpl-kpi .card`, `.tpl-root.tpl-kpi::before` and
 * `.tpl-root.tpl-kpi > *` do not.
 */
const ROOT_BOX_SELECTOR = /^\.tpl-root(?:\.[A-Za-z0-9_-]+)*$/;

/**
 * Rule 4 — the .tpl-root box must be exactly the canonical canvas.
 *
 * The canvas is chosen by the FILENAME: `social-portrait.css` is judged against
 * the `social-portrait` block, not against a hardcoded pair. A file named after
 * no declared canvas is skipped here and caught by rule 8 instead, which can
 * say the useful thing (it is undeclared) rather than the confusing one (it
 * does not fill a canvas nobody asked for).
 */
function lintCanvas(filePath, strippedSrc, rel, errors) {
  const canvasId = basename(filePath, ".css");
  if (!CANVAS_ID_SET.has(canvasId)) return;

  const templateId = basename(dirname(filePath));
  if (FLUID.has(templateId)) return;

  const expected = CANVAS[canvasId];

  // Walk every rule block; the cascade means a later declaration wins.
  // This is a flat parse — it assumes no nested at-rule blocks (@media etc.),
  // which the templates currently have none of. If that ever changes, the
  // runtime guard in check-canvas.ts is the backstop: it measures the real
  // laid-out box rather than trusting this parse.
  let declaredWidth = null;
  let declaredHeight = null;
  let sawRootBox = false;

  for (const m of strippedSrc.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (!selectors.some((s) => ROOT_BOX_SELECTOR.test(s))) continue;
    sawRootBox = true;
    const body = m[2];
    const w = body.match(/(?:^|;)\s*width:\s*([^;]+)/);
    const h = body.match(/(?:^|;)\s*height:\s*([^;]+)/);
    if (w) declaredWidth = w[1].trim();
    if (h) declaredHeight = h[1].trim();
  }

  if (!sawRootBox) {
    errors.push(`${rel}: no .tpl-root box rule found (expected a rule like ".tpl-root.tpl-${templateId}")`);
    return;
  }

  const want = { width: `${expected.width}px`, height: `${expected.height}px` };
  for (const [prop, actual] of [
    ["width", declaredWidth],
    ["height", declaredHeight],
  ]) {
    if (actual === null) {
      errors.push(
        `${rel}: .tpl-root box does not declare a ${prop} — it must be ${want[prop]} to fill the ${canvasId} canvas.${CANVAS_NOTE}`
      );
    } else if (actual !== want[prop]) {
      errors.push(
        `${rel}: .tpl-root box declares ${prop}: ${actual} — expected ${want[prop]} for the ${canvasId} canvas.${CANVAS_NOTE}`
      );
    }
  }
}

/**
 * Replace every `var(...)` expression with a placeholder, so what is left is
 * only the values a template states in its own right. Token names and their
 * documented fallbacks both live inside the var() and are therefore fine.
 */
function stripVarExpressions(src) {
  let out = "";
  for (let i = 0; i < src.length; ) {
    if (src.startsWith("var(", i)) {
      let depth = 0;
      let j = i + 3;
      for (; j < src.length; j++) {
        if (src[j] === "(") depth++;
        else if (src[j] === ")" && --depth === 0) break;
      }
      out += "VAR";
      i = j + 1;
    } else {
      out += src[i++];
    }
  }
  return out;
}

/** Named CSS colours that show up in hand-written slide CSS. */
const NAMED_COLORS =
  /(?<![\w-])(white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|navy|teal|olive|maroon|lime|aqua|fuchsia|beige|ivory|gold|crimson)(?![\w-])/gi;

/** `rgb()/rgba()/hsl()/hsla()` that is fully opaque — i.e. a palette entry. */
function opaqueColorFunctions(body) {
  const hits = [];
  for (const m of body.matchAll(/\b(rgba?|hsla?)\(([^()]*)\)/gi)) {
    const parts = m[2].split(/[,/]/).map((p) => p.trim());
    const alpha = parts.length >= 4 ? parseFloat(parts[3]) : 1;
    if (!(alpha < 1)) hits.push(m[0]);
  }
  return hits;
}

/** Rule 5 — no hardcoded colour / font-family outside a var() fallback. */
function lintThemeTokens(filePath, strippedSrc, rel, errors) {
  const templateId = basename(dirname(filePath));
  const allowed = new Set(
    (THEME.literalExceptions[templateId]?.values ?? []).map((v) =>
      v.toLowerCase()
    )
  );
  const seen = new Set();

  // Only look inside declaration blocks — selectors may legitimately contain
  // `#` (id selectors) and colour-ish words.
  for (const m of strippedSrc.matchAll(/\{([^{}]*)\}/g)) {
    const body = stripVarExpressions(m[1]);

    for (const hit of body.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
      if (allowed.has(hit.toLowerCase())) continue;
      if (seen.has(hit)) continue;
      seen.add(hit);
      errors.push(
        `${rel}: hardcoded colour "${hit}" outside a var() fallback.${THEME_NOTE}`
      );
    }

    for (const hit of opaqueColorFunctions(body)) {
      if (allowed.has(hit.toLowerCase().replace(/\s+/g, ""))) continue;
      if (seen.has(hit)) continue;
      seen.add(hit);
      errors.push(
        `${rel}: hardcoded opaque colour "${hit}" outside a var() fallback.${THEME_NOTE}`
      );
    }

    for (const m2 of body.matchAll(NAMED_COLORS)) {
      // `border: 1px solid white` — but not `white-space`, guarded by \b above.
      if (seen.has(m2[0])) continue;
      seen.add(m2[0]);
      errors.push(
        `${rel}: hardcoded named colour "${m2[0]}" outside a var() fallback.${THEME_NOTE}`
      );
    }

    for (const decl of m[1].matchAll(/(?:^|;)\s*font-family\s*:\s*([^;]+)/g)) {
      const value = decl[1].trim();
      if (value.startsWith("var(")) continue;
      if (seen.has(value)) continue;
      seen.add(value);
      errors.push(
        `${rel}: font-family "${value.slice(0, 60)}" is not a theme token — ` +
          `use var(--s-font-display|body|mono|editorial, …).${THEME_NOTE}`
      );
    }
  }
}

/** Rule 6 — every token read must exist in at least one theme (typo check). */
function lintTokenExistence(strippedSrc, rel, errors) {
  const seen = new Set();
  for (const m of strippedSrc.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    const token = m[1];
    if (ANY_THEME_TOKENS.has(token) || seen.has(token)) continue;
    seen.add(token);
    errors.push(
      `${rel}: reads token "${token}", which NO theme defines — it will ` +
        `silently fall back to its literal and drift from the brand. Fix the ` +
        `name, or add the token to every theme in themes/.`
    );
  }
}

/**
 * Rule 7 — THEME COMPLETENESS. Every token any template reads must be defined
 * by EVERY theme, and every theme must carry the shared slide chassis.
 *
 * This is the static half of the invariant whose runtime half is
 * `check-theme.ts`. It is the rule that would have caught the 2026-08-12 bug
 * without a browser: themes/default.css defined seven --slide-* aliases and
 * none of the 34 semantic tokens templates read, so a deck on the "default"
 * theme fell back to the DevFellowship literal on every single element and
 * rendered dark. Nothing failed. The theme picker looked inert.
 *
 * It also checks the two things a theme can lose by being written from scratch:
 *   · the three .dfl-* chassis classes, which templates emit in their MARKUP
 *     (kpi, steps, image-row) and which are styled ONLY by the theme — a theme
 *     without them silently drops a slide's eyebrow, title and hairline;
 *   · the `flex-shrink: 0` + `min-height` floor on .dfl-section-rule, without
 *     which that hairline can land on a sub-pixel height and abort the whole
 *     PDF export (html2canvas createPattern on a 0-width canvas, 2026-08-04).
 *
 * What this rule CANNOT see: a theme file a browser refuses to parse. An
 * asterisk-slash inside a CSS comment closes it early, error-recovery swallows
 * the following rule whole, and this textual scan still finds every token in
 * the file. Only check-theme.ts, which asks a real browser to resolve them,
 * catches that. Hence both halves.
 */
function lintThemes() {
  const errors = [];

  // The contract: the union of every --s-* / --p-* token the templates read.
  const contract = new Set();
  for (const file of findCssFiles(join(REPO_ROOT, "templates"))) {
    const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of src.matchAll(/var\(\s*(--[sp]-[a-z0-9-]+)/gi)) contract.add(m[1]);
  }

  const CHASSIS = [".dfl-eyebrow", ".dfl-section-title", ".dfl-section-rule"];

  // registry.json and theme.config.json must name the same themes.
  const configured = Object.keys(THEME.themes ?? {});
  for (const t of THEMES) {
    if (!configured.includes(t.id))
      errors.push(
        `scripts/theme.config.json has no "themes.${t.id}" contract, but ` +
          `registry.json declares that theme. Add its forbidden colours (the ` +
          `other brands' accents, per their brand guides) so check-theme.ts can ` +
          `assert against it.`
      );
  }
  for (const id of configured) {
    if (!THEMES.some((t) => t.id === id))
      errors.push(
        `scripts/theme.config.json configures theme "${id}", which registry.json ` +
          `does not declare. registry.json is the source of truth — either add ` +
          `it there (plus themes/${id}.css) or drop the contract.`
      );
  }

  for (const theme of THEMES) {
    const rel = theme.file;
    let src;
    try {
      src = readFileSync(join(REPO_ROOT, rel), "utf8");
    } catch {
      errors.push(
        `registry.json declares theme "${theme.id}" with file ${rel}, which does ` +
          `not exist. A declared theme with no stylesheet leaves every token ` +
          `unresolved, i.e. every slide rendered in DevFellowship colours.`
      );
      continue;
    }
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "");

    // The token block must be a rule whose selector is EXACTLY `.tpl-root`.
    // Requiring the exact selector is what makes a prematurely-closed comment
    // detectable here: the stray comment text ends up glued onto the front of
    // the selector, so it stops being exactly `.tpl-root`.
    const selectors = [];
    for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g))
      selectors.push(m[1].trim().replace(/\s+/g, " "));
    if (!selectors.includes(".tpl-root"))
      errors.push(
        `${rel}: no rule with the exact selector ".tpl-root" — the token block ` +
          `must be one. Found: ${selectors.slice(0, 4).join(" | ")}. If the ` +
          `selector looks like prose glued to ".tpl-root", a CSS comment above ` +
          `it was closed early by an asterisk-slash in its text.`
      );

    const defined = tokensOf(rel);
    const missing = [...contract].filter((t) => !defined.has(t)).sort();
    if (missing.length)
      errors.push(
        `${rel}: theme "${theme.id}" does not define ${missing.length} of ` +
          `${contract.size} tokens that templates read — ${missing.join(", ")}.\n` +
          `      Templates read every token as var(--token, <DevFellowship ` +
          `literal>). An undefined token therefore does NOT fail: it paints the ` +
          `DevFellowship colour under your theme. Define every token, or the ` +
          `theme is a partial repaint of DFL.`
      );

    for (const cls of CHASSIS)
      if (!stripped.includes(cls))
        errors.push(
          `${rel}: theme "${theme.id}" does not style "${cls}". Templates emit ` +
            `that class in their markup (kpi, steps, image-row) and only the ` +
            `theme styles it, so switching to this theme would drop it from the ` +
            `slide with no error anywhere.`
        );

    const ruleBlock = stripped.match(
      /\.tpl-root\s+\.dfl-section-rule\s*\{([^}]*)\}/
    );
    if (ruleBlock) {
      const body = ruleBlock[1];
      if (!/flex-shrink:\s*0/.test(body) || !/min-height:\s*1px/.test(body))
        errors.push(
          `${rel}: .dfl-section-rule must keep BOTH "flex-shrink: 0" and ` +
            `"min-height: 1px". It is a 1px flex item inside fixed-height ` +
            `column layouts (steps, image-row); without the floor an overflowing ` +
            `slide shrinks it into (0, 1)px, and html2canvas then calls ` +
            `createPattern on a 0-width canvas and aborts the ENTIRE PDF export ` +
            `(2026-08-04, deck "Itera — Trinidad and Tobago").`
        );
    }
  }

  return errors;
}

function lintFile(filePath) {
  const src = readFileSync(filePath, "utf8");
  const errors = [];
  const rel = relative(REPO_ROOT, filePath);

  // 1. Disallow @layer
  const layerMatches = [...src.matchAll(/@layer\b/g)];
  for (const m of layerMatches) {
    errors.push(`${rel}: @layer is not allowed (found at index ${m.index})`);
  }

  // 2. Disallow :host
  const hostMatches = [...src.matchAll(/:host\b/g)];
  for (const m of hostMatches) {
    errors.push(`${rel}: :host is not allowed (found at index ${m.index})`);
  }

  // 3. Check that every rule-set selector is scoped under .tpl-root.
  //    We do a simplified parse: strip comments, then find selector blocks.
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "");

  // Split by { and extract selector candidates
  const ruleChunks = stripped.split("{");
  // The last chunk is trailing content after the final }, not a selector
  ruleChunks.pop();

  for (let i = 0; i < ruleChunks.length; i++) {
    const chunk = ruleChunks[i];
    // The selector is the part after the last } (end of a previous rule block)
    const lastClose = chunk.lastIndexOf("}");
    const selectorCandidate =
      lastClose === -1 ? chunk : chunk.slice(lastClose + 1);

    const trimmed = selectorCandidate.trim();
    if (!trimmed) continue;

    // Skip @-rules (at-rules like @media, @keyframes, etc.)
    if (trimmed.startsWith("@")) continue;

    // Each comma-separated selector in the list must contain .tpl-root
    const selectors = trimmed.split(",").map((s) => s.trim());
    for (const sel of selectors) {
      if (!sel) continue;
      if (!sel.includes(".tpl-root")) {
        errors.push(
          `${rel}: selector not scoped under .tpl-root — "${sel.slice(0, 80)}"`
        );
      }
    }
  }

  // 4. The .tpl-root box must fill the canonical design canvas.
  lintCanvas(filePath, stripped, rel, errors);

  // 5. No hardcoded colour / font-family.
  lintThemeTokens(filePath, stripped, rel, errors);

  // 6. Every token read must exist in the theme.
  lintTokenExistence(stripped, rel, errors);

  return errors;
}

const cssFiles = findCssFiles(join(REPO_ROOT, "templates"));

if (cssFiles.length === 0) {
  console.log("No CSS files found under templates/. Nothing to lint.");
  process.exit(0);
}

let allErrors = lintCanvasConfig()
  .concat(lintTemplateCanvases())
  .concat(lintThemes());
for (const f of cssFiles) {
  allErrors = allErrors.concat(lintFile(f));
}

if (allErrors.length > 0) {
  console.error(`CSS lint failed with ${allErrors.length} error(s):\n`);
  for (const e of allErrors) {
    console.error(`  ✗  ${e}`);
  }
  process.exit(1);
} else {
  console.log(`CSS lint passed — ${cssFiles.length} file(s) checked.`);
  process.exit(0);
}

/**
 * CSS scoping linter.
 *
 * Rules enforced:
 *  1. No @layer rules.
 *  2. No :host pseudo-class.
 *  3. Every rule-set selector must be scoped under .tpl-root (i.e. every
 *     top-level selector must start with or include `.tpl-root`).
 *  4. The .tpl-root box must declare the canonical design canvas — 1280x720
 *     landscape / 720x1280 portrait. See CANVAS_NOTE below.
 *  5. No hardcoded colour or font-family. Every colour and every type family
 *     must come from a theme token — `var(--token, <fallback>)`. See THEME_NOTE.
 *  6. Every `--s-*` / `--p-*` token a template reads must actually exist in
 *     the theme file. Catches typo'd token names that silently fall back.
 *
 * Plus rule 0, which runs once and is about the config rather than any single
 * file: canvas.config.json must be internally coherent (portrait == landscape
 * transposed) and must still name its cross-repo counterpart. See
 * lintCanvasConfig() for why that half lives here and the comparison does not.
 *
 * Usage: node scripts/lint-css.mjs
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, basename, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const CANVAS = JSON.parse(
  readFileSync(join(__dirname, "canvas.config.json"), "utf8")
);
const FLUID = new Set(CANVAS.fluidTemplates);

/**
 * Rule 0 — the canvas config must be internally coherent before any template
 * is judged against it.
 *
 * Portrait is landscape transposed. Both this repo and dfl-lesson-studio
 * (`getDesignDimensions`) rely on that, and the cross-repo contract check over
 * there compares field-by-field on that assumption — but here it was only ever
 * stated in prose. Nothing stopped someone editing `portrait` to 720x1440,
 * after which every guard in this repo would keep passing while validating 46
 * templates against a shape the app never renders.
 *
 * The cross-repo half of the contract cannot run here: this repo is public and
 * dfl-lesson-studio is private, so reading it would need a token a public
 * workflow must not hold. This is the half that needs no credential.
 */
function lintCanvasConfig() {
  const errors = [];
  const { landscape: l, portrait: p, counterpart } = CANVAS;

  if (p.width !== l.height || p.height !== l.width) {
    errors.push(
      `scripts/canvas.config.json: portrait is ${p.width}x${p.height}, but ` +
        `landscape ${l.width}x${l.height} transposed is ${l.height}x${l.width}. ` +
        `Portrait must be landscape transposed — dfl-lesson-studio derives it ` +
        `that way (getDesignDimensions), and the cross-repo contract check ` +
        `there compares on that assumption.`
    );
  }

  if (!counterpart?.repo || !counterpart?.path || !counterpart?.symbols?.length) {
    errors.push(
      `scripts/canvas.config.json: the "counterpart" block is missing or ` +
        `incomplete. It names the other half of the canvas contract (repo, ` +
        `file, symbols) and is what the check in dfl-lesson-studio is written ` +
        `against — losing it turns an enforced contract back into a comment.`
    );
  }

  return errors;
}

const THEME = JSON.parse(
  readFileSync(join(__dirname, "theme.config.json"), "utf8")
);

/** Token names the theme actually defines, e.g. "--s-surface-page". */
const THEME_TOKENS = new Set(
  [...readFileSync(join(REPO_ROOT, THEME.themeFile), "utf8").matchAll(
    /(--[a-z0-9-]+)\s*:/gi
  )].map((m) => m[1])
);

const THEME_NOTE = `
  Colours and type families are owned by the theme (${THEME.themeFile}), which is
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

const CANVAS_NOTE = `
  The design canvas is ${CANVAS.landscape.width}x${CANVAS.landscape.height} (landscape) and ${CANVAS.portrait.width}x${CANVAS.portrait.height} (portrait).
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

/** Rule 4 — the .tpl-root box must be exactly the canonical canvas. */
function lintCanvas(filePath, strippedSrc, rel, errors) {
  const orientation = basename(filePath, ".css");
  if (orientation !== "landscape" && orientation !== "portrait") return;

  const templateId = basename(dirname(filePath));
  if (FLUID.has(templateId)) return;

  const expected = CANVAS[orientation];

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
        `${rel}: .tpl-root box does not declare a ${prop} — it must be ${want[prop]} to fill the ${orientation} canvas.${CANVAS_NOTE}`
      );
    } else if (actual !== want[prop]) {
      errors.push(
        `${rel}: .tpl-root box declares ${prop}: ${actual} — expected ${want[prop]} for the ${orientation} canvas.${CANVAS_NOTE}`
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

/** Rule 6 — every token read must exist in the theme. */
function lintTokenExistence(strippedSrc, rel, errors) {
  const seen = new Set();
  for (const m of strippedSrc.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    const token = m[1];
    if (THEME_TOKENS.has(token) || seen.has(token)) continue;
    seen.add(token);
    errors.push(
      `${rel}: reads token "${token}", which ${THEME.themeFile} does not define — ` +
        `it will silently fall back and drift from the brand. Fix the name or ` +
        `add the token to the theme.`
    );
  }
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

let allErrors = lintCanvasConfig();
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

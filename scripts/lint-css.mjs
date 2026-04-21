/**
 * CSS scoping linter.
 *
 * Rules enforced:
 *  1. No @layer rules.
 *  2. No :host pseudo-class.
 *  3. Every rule-set selector must be scoped under .tpl-root (i.e. every
 *     top-level selector must start with or include `.tpl-root`).
 *
 * Usage: node scripts/lint-css.mjs
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..");

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

  return errors;
}

const cssFiles = findCssFiles(join(REPO_ROOT, "templates"));

if (cssFiles.length === 0) {
  console.log("No CSS files found under templates/. Nothing to lint.");
  process.exit(0);
}

let allErrors = [];
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

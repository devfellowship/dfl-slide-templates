/**
 * Shared slide-render helpers.
 *
 * Single source of truth for (a) the canonical design canvas, (b) which
 * templates render dark / under the DFL Design System, and (c) how a template
 * is assembled into a standalone HTML page.
 *
 * Consumed by `preview-gen.ts` (screenshots) and `check-canvas.ts` (geometry
 * guard) so the guard measures exactly what the preview renders.
 */

import * as fs from "fs";
import * as path from "path";
import Mustache from "mustache";
import { SAMPLE_DATA } from "./sample-data";
import CANVAS_CONFIG from "./canvas.config.json";

export const REPO_ROOT = path.resolve(__dirname, "..");
export const REGISTRY_PATH = path.join(REPO_ROOT, "registry.json");

export type Orientation = "landscape" | "portrait";

/**
 * Canonical design canvas. Defined once in `scripts/canvas.config.json` and
 * shared with the static guard in `lint-css.mjs`, so the two guards can never
 * disagree about what "filling the canvas" means.
 */
export const CANVAS: Record<Orientation, { width: number; height: number }> = {
  landscape: CANVAS_CONFIG.landscape,
  portrait: CANVAS_CONFIG.portrait,
};

export const LANDSCAPE_WIDTH = CANVAS.landscape.width;
export const LANDSCAPE_HEIGHT = CANVAS.landscape.height;

export const ORIENTATIONS: Orientation[] = ["landscape", "portrait"];

/**
 * Templates that intentionally size themselves to their container instead of
 * the fixed design canvas — the only exceptions to the "fill the canvas"
 * invariant. Rationale for each lives alongside the list in
 * `scripts/canvas.config.json`.
 */
export const FLUID_TEMPLATES = new Set<string>(CANVAS_CONFIG.fluidTemplates);

export interface RegistryEntry {
  id: string;
  version: string;
  category: string;
}

export interface Registry {
  templates: RegistryEntry[];
}

export function readRegistry(): Registry {
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
}

export const DARK_TEMPLATES = new Set([
  "title",
  "image",
  "table",
  "kpi",
  "section-header",
  "steps",
  "callout",
  "image-row",
  "screenshot-frame",
  "annotated-image",
  "image-caption-grid",
  "before-after-image",
  "polaroid-stack",
  "logo-wall",
  "video",
  "split-media",
  "code-output",
  "definition",
  "matrix-2x2",
  "timeline",
  "process-flow",
  "hierarchy-tree",
  "agenda",
  "checklist",
  "pros-cons",
  "roadmap",
  "cycle",
  "chapter-image",
  "stat-grid",
]);

// Templates that render under the DFL Design System (DS Redesign v0).
// These get the devfellowship theme CSS (tokens + shared chassis utilities)
// injected before the template's own CSS so that --s-*/--p-* tokens resolve
// and shared classes (.dfl-eyebrow, .dfl-section-title, .dfl-section-rule)
// render correctly. Older templates keep their plain hard-coded fallbacks.
export const DS_REDESIGN_TEMPLATES = new Set([
  "kpi",
  "section-header",
  "steps",
  "callout",
  "image-row",
  "screenshot-frame",
  "annotated-image",
  "image-caption-grid",
  "before-after-image",
  "polaroid-stack",
  "logo-wall",
  "video",
  "split-media",
  "code-output",
  "definition",
  "matrix-2x2",
  "timeline",
  "process-flow",
  "hierarchy-tree",
  "agenda",
  "checklist",
  "pros-cons",
  "roadmap",
  "cycle",
  "chapter-image",
  "stat-grid",
]);

export function buildHtmlPage(
  templateId: string,
  orientation: Orientation
): string {
  const dir = path.join(REPO_ROOT, "templates", templateId);
  const htmlTemplate = fs.readFileSync(
    path.join(dir, `${orientation}.html`),
    "utf8"
  );
  const css = fs.readFileSync(path.join(dir, `${orientation}.css`), "utf8");
  const data = SAMPLE_DATA[templateId] ?? {};
  const renderedHtml = Mustache.render(htmlTemplate, data);
  const bgColor = DARK_TEMPLATES.has(templateId) ? "#0a0908" : "#ffffff";

  const themeCss = DS_REDESIGN_TEMPLATES.has(templateId)
    ? fs.readFileSync(
        path.join(REPO_ROOT, "themes", "devfellowship.css"),
        "utf8"
      )
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${templateId} – ${orientation}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; background: ${bgColor}; }
    ${themeCss}
    ${css}
  </style>
</head>
<body>
${renderedHtml}
</body>
</html>`;
}

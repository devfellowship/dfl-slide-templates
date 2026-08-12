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

/**
 * A theme, as declared by `registry.json`. Consumers (dfl-lesson-studio's
 * theme picker, this repo's guards) read the list from there instead of
 * hardcoding theme ids — adding a theme is one entry plus one CSS file.
 */
export interface RegistryTheme {
  id: string;
  name: string;
  file: string;
  mode: "light" | "dark";
}

export interface Registry {
  templates: RegistryEntry[];
  themes: RegistryTheme[];
}

export function readRegistry(): Registry {
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
}

/**
 * The declared themes, from `registry.json`.
 *
 * This is the ONLY list. `scripts/theme.config.json` carries the per-theme
 * contract (forbidden colours, exceptions) and is checked against this list,
 * so a theme cannot be added to one and forgotten in the other.
 */
export function readThemes(): RegistryTheme[] {
  const themes = readRegistry().themes;
  if (!Array.isArray(themes) || themes.length === 0) {
    throw new Error(
      "registry.json has no non-empty `themes` array. It is the source of " +
        "truth for which themes exist; the guards and dfl-lesson-studio's " +
        "theme picker both read it."
    );
  }
  return themes;
}

/**
 * Themes live in `themes/<id>.css` and are what makes a template look like a
 * DFL slide. They are pure token definitions plus three shared chassis classes
 * (.dfl-eyebrow / .dfl-section-title / .dfl-section-rule), all scoped under
 * `.tpl-root`, so injecting one is always safe and never styles anything on
 * its own.
 *
 * The preview/guard pipeline therefore injects the theme for EVERY template,
 * exactly like the deck runtime does (dfl-lesson-studio fetches
 * `themes/<themeId>.css` and prepends it — see `fetchTemplateAssets.ts`).
 *
 * THEME_ID is the theme the PREVIEWS and the showcase render in — the DFL
 * house theme. It is not "the" theme: `buildHtmlPage` takes a themeId, and
 * `check-theme.ts` sweeps every theme declared in `registry.json` so that a
 * template is proven to adapt to all of them, not just this one.
 *
 * History: this used to be gated by two hand-maintained allowlists
 * (DARK_TEMPLATES / DS_REDESIGN_TEMPLATES). They went stale — nine templates
 * added in the 2026-06-24 batch consumed `--s-*` tokens but were never added
 * to DS_REDESIGN_TEMPLATES, so previews rendered them on their inline
 * fallbacks instead of the theme. The allowlists are gone: there is nothing
 * left to forget to update.
 */
export const THEME_ID = "devfellowship";

export function buildHtmlPage(
  templateId: string,
  orientation: Orientation,
  themeId: string = THEME_ID
): string {
  const dir = path.join(REPO_ROOT, "templates", templateId);
  const htmlTemplate = fs.readFileSync(
    path.join(dir, `${orientation}.html`),
    "utf8"
  );
  const css = fs.readFileSync(path.join(dir, `${orientation}.css`), "utf8");
  const data = SAMPLE_DATA[templateId] ?? {};
  const renderedHtml = Mustache.render(htmlTemplate, data);
  const themeCss = fs.readFileSync(
    path.join(REPO_ROOT, "themes", `${themeId}.css`),
    "utf8"
  );

  // The page behind the slide. Templates must paint their own opaque themed
  // surface, so this only ever shows through a bug — which is precisely what
  // `check-theme.ts` asserts against, using a deliberately hostile colour.
  const bgColor = "#0a0908";

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

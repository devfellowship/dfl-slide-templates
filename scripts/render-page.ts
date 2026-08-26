/**
 * Shared slide-render helpers.
 *
 * Single source of truth for (a) the canonical design canvas, (b) which
 * templates render dark / under the DFL Design System, (c) where a template's
 * sample data comes from, and (d) how a template is assembled into a
 * standalone HTML page.
 *
 * Consumed by `preview-gen.ts` (screenshots), `check-canvas.ts` (geometry
 * guard), `check-theme.ts` (theme guard) and `showcase-gen.ts`, so all four
 * fill a template with exactly the same data the preview renders.
 */

import * as fs from "fs";
import * as path from "path";
import Mustache from "mustache";
import { parse as parseYaml } from "yaml";
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

/**
 * Where a template's sample data comes from, and why it is not in `scripts/`.
 *
 * Sample data used to live in `scripts/sample-data.ts`, keyed by template id.
 * That put it under the human merge gate that (correctly) protects
 * `scripts/**` — the determinism machinery. A template that auto-merged
 * therefore arrived with NO sample data: Mustache filled every slot with the
 * empty string, its committed preview was blank, and `check:canvas` /
 * `check:theme` passed against an empty layout. A blank template merging
 * green is worse than one that is blocked.
 *
 * So the sample data now lives WITH the template, at
 * `templates/<id>/sample.json` — the same auto-mergeable directory as its
 * HTML and CSS. A new template ships its own sample data, and no PR has to
 * reach into `scripts/` to make a populated render possible.
 */
export type SampleData = Record<string, unknown>;

export type SampleSource = "sample.json" | "config.yaml" | "none";

export interface ResolvedSample {
  data: SampleData;
  source: SampleSource;
}

interface ConfigSlot {
  name?: string;
  sample?: unknown;
}

/**
 * Read the per-slot `sample:` values out of `templates/<id>/config.yaml`.
 *
 * Every template's config already declares a `sample:` for each slot — it is
 * the contract an authoring LLM reads. Nothing rendered it until now.
 *
 * Returns `undefined` when there is no config file at all, so the caller can
 * tell "no such source" apart from "a source that declares no slots" (which
 * is a legitimate, complete answer for `blank`).
 */
function readConfigSample(dir: string): SampleData | undefined {
  const configPath = path.join(dir, "config.yaml");
  if (!fs.existsSync(configPath)) return undefined;
  const config = parseYaml(fs.readFileSync(configPath, "utf8")) as
    | { slots?: ConfigSlot[] }
    | null
    | undefined;
  const slots = config?.slots;
  if (!Array.isArray(slots)) return undefined;
  const data: SampleData = {};
  for (const slot of slots) {
    if (!slot || typeof slot.name !== "string") continue;
    if (slot.sample === undefined) continue;
    data[slot.name] = slot.sample;
  }
  return data;
}

/**
 * Resolve a template's sample data.
 *
 * Order: `templates/<id>/sample.json` → the per-slot `sample:` values in that
 * template's `config.yaml` → `{}`.
 *
 * Each step is a fallback for a MISSING source, never a merge of two partial
 * ones. If `sample.json` exists it is the whole answer, even if it omits a
 * slot — otherwise a half-populated render would look authored, and the
 * template author would have no way to render a slot deliberately empty.
 */
export function resolveSampleData(templateId: string): ResolvedSample {
  const dir = path.join(REPO_ROOT, "templates", templateId);

  const samplePath = path.join(dir, "sample.json");
  if (fs.existsSync(samplePath)) {
    const raw = fs.readFileSync(samplePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `templates/${templateId}/sample.json is not valid JSON: ` +
          `${(err as Error).message}`
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        `templates/${templateId}/sample.json must contain a JSON object ` +
          `keyed by slot name.`
      );
    }
    return { data: parsed as SampleData, source: "sample.json" };
  }

  // Log AT the fallback, not after it. A template with a thin sample source
  // renders quietly blank, so the only way that is ever noticed is if the
  // resolver says so while it happens.
  const fromConfig = readConfigSample(dir);
  if (fromConfig) {
    const slotCount = Object.keys(fromConfig).length;
    console.warn(
      slotCount > 0
        ? `[sample] ${templateId}: no sample.json — falling back to the ` +
            `per-slot \`sample:\` values in config.yaml (${slotCount} slot(s)).`
        : `[sample] ${templateId}: no sample.json, and config.yaml declares ` +
            `no fillable slot. Rendering with no data — expected only for a ` +
            `deliberately empty template.`
    );
    return { data: fromConfig, source: "config.yaml" };
  }

  console.warn(
    `[sample] ${templateId}: NO sample source (no sample.json, and ` +
      `config.yaml is missing or declares no slots). Every slot will render ` +
      `empty and the preview will be blank.`
  );
  return { data: {}, source: "none" };
}

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
  const { data } = resolveSampleData(templateId);
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

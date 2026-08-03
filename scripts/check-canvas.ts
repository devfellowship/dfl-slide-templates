/**
 * Canvas-fill guard (runtime / DOM geometry).
 *
 * Renders every registered template at the canonical design canvas and
 * measures the ACTUAL laid-out box of `.tpl-root`. Fails if a template does
 * not fill the canvas.
 *
 * Why this exists: 33 of 46 templates shipped declaring `960x540` (landscape)
 * or `540x960` (portrait) — exactly 75% linear, ~56% of the area — so slide
 * content sat in the top-left quadrant with a dead band of page background
 * down the right edge and along the bottom. A static CSS grep can be fooled
 * (a later rule overriding `width`, a transform, a stray margin), so this
 * guard measures the rendered result instead of trusting the source.
 *
 * Pairs with rule 4 in `scripts/lint-css.mjs`, which catches the same class of
 * bug statically and without a browser.
 *
 * Usage:
 *   npm run check:canvas               # assert, exit non-zero on violation
 *   npm run check:canvas -- --json out.json   # also write a measurement report
 */

import { chromium } from "playwright";
import * as fs from "fs";
import {
  CANVAS,
  FLUID_TEMPLATES,
  ORIENTATIONS,
  Orientation,
  buildHtmlPage,
  readRegistry,
} from "./render-page";

/** Sub-pixel slack: layout rounding, not a design defect. */
const TOLERANCE_PX = 1;

interface Measurement {
  id: string;
  orientation: Orientation;
  expected: { width: number; height: number };
  actual: { width: number; height: number };
  fillRatio: number;
  ok: boolean;
  reason?: string;
}

async function main(): Promise<void> {
  const jsonFlagIdx = process.argv.indexOf("--json");
  const jsonPath = jsonFlagIdx !== -1 ? process.argv[jsonFlagIdx + 1] : null;

  const registry = readRegistry();
  const browser = await chromium.launch();
  const results: Measurement[] = [];

  for (const { id } of registry.templates) {
    for (const orientation of ORIENTATIONS) {
      const expected = CANVAS[orientation];
      const page = await browser.newPage();
      await page.setViewportSize(expected);
      await page.setContent(buildHtmlPage(id, orientation), {
        waitUntil: "networkidle",
      });

      const actual = await page.evaluate(() => {
        const el = document.querySelector(".tpl-root");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height };
      });
      await page.close();

      if (!actual) {
        results.push({
          id,
          orientation,
          expected,
          actual: { width: 0, height: 0 },
          fillRatio: 0,
          ok: false,
          reason: "no .tpl-root element found",
        });
        continue;
      }

      const dw = Math.abs(actual.width - expected.width);
      const dh = Math.abs(actual.height - expected.height);
      const fillRatio =
        (actual.width * actual.height) / (expected.width * expected.height);
      const ok = dw <= TOLERANCE_PX && dh <= TOLERANCE_PX;

      results.push({
        id,
        orientation,
        expected,
        actual,
        fillRatio,
        ok,
        reason: ok
          ? undefined
          : `.tpl-root is ${actual.width}x${actual.height}, expected ` +
            `${expected.width}x${expected.height} ` +
            `(fills ${(fillRatio * 100).toFixed(1)}% of the canvas area)`,
      });
    }
  }

  await browser.close();

  if (jsonPath) {
    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
    console.log(`Wrote measurement report to ${jsonPath}`);
  }

  const violations = results.filter(
    (r) => !r.ok && !FLUID_TEMPLATES.has(r.id)
  );

  for (const r of results) {
    if (FLUID_TEMPLATES.has(r.id)) {
      console.log(
        `  ~  ${r.id} (${r.orientation}) — fluid by design, skipped ` +
          `(${r.actual.width}x${r.actual.height})`
      );
    } else if (r.ok) {
      console.log(`  ✓  ${r.id} (${r.orientation}) — ${r.actual.width}x${r.actual.height}`);
    } else {
      console.error(`  ✗  ${r.id} (${r.orientation}) — ${r.reason}`);
    }
  }

  if (violations.length > 0) {
    console.error(
      `\nCanvas-fill check FAILED — ${violations.length} of ${results.length} ` +
        `renders do not fill the design canvas.\n\n` +
        `Every template's .tpl-root must lay out at exactly ` +
        `${CANVAS.landscape.width}x${CANVAS.landscape.height} (landscape) / ` +
        `${CANVAS.portrait.width}x${CANVAS.portrait.height} (portrait).\n` +
        `If a template is genuinely meant to size to its container, add it to ` +
        `FLUID_TEMPLATES in scripts/render-page.ts with a written rationale.`
    );
    process.exit(1);
  }

  console.log(
    `\nCanvas-fill check passed — ${results.length} renders, all filling the canvas.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

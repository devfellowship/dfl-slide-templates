/**
 * Theme-conformance guard (runtime / computed styles).
 *
 * Renders every registered template with the devfellowship theme injected —
 * exactly as the deck runtime does — but paints the page behind the slide a
 * deliberately hostile magenta. Then it reads back computed styles and asserts:
 *
 *   A. `.tpl-root` paints an OPAQUE background, and that background is the
 *      theme's page surface. A template with `background: transparent` passes
 *      every static check and still ships broken, because the host deck's own
 *      per-slide colour shows through. That is literally what happened: the
 *      `table` template declared `background: transparent`, dfl-lesson-studio
 *      gives each slide a random background from `generateRandomBackgroundColor`
 *      (`#1a1a2e` navy among them), and the table slide came out navy inside an
 *      otherwise near-black deck.
 *
 *   B. Every element that renders text resolves to one of the four brand type
 *      families (brand guide ch. 06). A template that hardcodes `Segoe UI` or
 *      inherits the browser default reads as a different product.
 *
 * Pairs with rules 5 and 6 in `scripts/lint-css.mjs`, which catch the same
 * class of bug statically and without a browser. Same two-guard shape as the
 * canvas invariant (`lint-css.mjs` rule 4 + `check-canvas.ts`).
 *
 * Usage:
 *   npm run check:theme                     # assert, exit non-zero on violation
 *   npm run check:theme -- --json out.json  # also write a measurement report
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import {
  CANVAS,
  ORIENTATIONS,
  Orientation,
  REPO_ROOT,
  buildHtmlPage,
  readRegistry,
} from "./render-page";
import THEME_CONFIG from "./theme.config.json";

/**
 * The page colour behind the slide during the check. Nothing in the library is
 * allowed to let this through — if it shows up in a screenshot, a template is
 * not painting its own surface.
 */
const HOSTILE_PAGE_BG = "#ff00ff";

const ALLOWED_FONTS = new Set<string>(THEME_CONFIG.allowedFontFamilies);
const SURFACE_EXCEPTIONS: Record<string, { value: string; rationale: string }> =
  THEME_CONFIG.surfaceExceptions;

interface Finding {
  id: string;
  orientation: Orientation;
  rootBackground: string;
  fonts: string[];
  violations: string[];
}

/** Swap the preview page background for the hostile one. */
function hostilePage(id: string, orientation: Orientation): string {
  return buildHtmlPage(id, orientation).replace(
    /background: #0a0908;/,
    `background: ${HOSTILE_PAGE_BG};`
  );
}

async function main(): Promise<void> {
  const jsonFlagIdx = process.argv.indexOf("--json");
  const jsonPath = jsonFlagIdx !== -1 ? process.argv[jsonFlagIdx + 1] : null;

  const registry = readRegistry();
  const browser = await chromium.launch();
  const findings: Finding[] = [];

  for (const { id } of registry.templates) {
    for (const orientation of ORIENTATIONS) {
      const page = await browser.newPage();
      await page.setViewportSize(CANVAS[orientation]);
      await page.setContent(hostilePage(id, orientation), {
        waitUntil: "networkidle",
      });

      const measured = await page.evaluate(() => {
        const root = document.querySelector(".tpl-root") as HTMLElement | null;
        if (!root) return null;
        const families = new Set<string>();
        for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
          // Only elements that actually render text of their own.
          const ownText = Array.from(el.childNodes).some(
            (n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0
          );
          if (!ownText) continue;
          families.add(
            getComputedStyle(el)
              .fontFamily.split(",")[0]
              .replace(/["']/g, "")
              .trim()
          );
        }
        return {
          background: getComputedStyle(root).backgroundColor,
          families: Array.from(families),
        };
      });
      await page.close();

      if (!measured) {
        findings.push({
          id,
          orientation,
          rootBackground: "",
          fonts: [],
          violations: ["no .tpl-root element found"],
        });
        continue;
      }

      const violations: string[] = [];
      const expectedSurface =
        SURFACE_EXCEPTIONS[id]?.value ?? THEME_CONFIG.surfaceValue;

      // `rgb(r, g, b)` is opaque; only the 4-component `rgba(r, g, b, a)` form
      // carries an alpha. (Reading the 3rd component of `rgb()` as alpha is an
      // easy off-by-one that reports every pure black as transparent.)
      const rgbaParts = measured.background
        .replace(/^rgba?\(|\)$/g, "")
        .split(",")
        .map((p) => p.trim());
      const alpha = rgbaParts.length >= 4 ? parseFloat(rgbaParts[3]) : 1;

      if (alpha < 1) {
        violations.push(
          `.tpl-root background is ${measured.background} (not opaque) — the ` +
            `host deck's own slide colour shows through. Paint the themed ` +
            `surface: background: var(${THEME_CONFIG.surfaceToken}, #0a0908);`
        );
      } else if (measured.background !== expectedSurface) {
        violations.push(
          `.tpl-root background is ${measured.background}, expected ` +
            `${expectedSurface} (${THEME_CONFIG.surfaceToken}). Add an entry to ` +
            `"surfaceExceptions" in scripts/theme.config.json if this is deliberate.`
        );
      }

      for (const family of measured.families) {
        if (!ALLOWED_FONTS.has(family)) {
          violations.push(
            `text renders in "${family}", which is not one of the brand type ` +
              `families (${[...ALLOWED_FONTS].join(", ")}). Use ` +
              `var(--s-font-display|body|mono|editorial, …).`
          );
        }
      }

      findings.push({
        id,
        orientation,
        rootBackground: measured.background,
        fonts: measured.families,
        violations,
      });
    }
  }

  await browser.close();

  if (jsonPath) {
    fs.writeFileSync(path.resolve(jsonPath), JSON.stringify(findings, null, 2));
    console.log(`Wrote theme measurement report to ${jsonPath}`);
  }

  for (const f of findings) {
    if (f.violations.length === 0) {
      console.log(
        `  ✓  ${f.id} (${f.orientation}) — ${f.rootBackground}` +
          (f.fonts.length ? ` · ${f.fonts.join(" · ")}` : "")
      );
    } else {
      for (const v of f.violations) {
        console.error(`  ✗  ${f.id} (${f.orientation}) — ${v}`);
      }
    }
  }

  const failed = findings.filter((f) => f.violations.length > 0);
  if (failed.length > 0) {
    console.error(
      `\nTheme-conformance check FAILED — ${failed.length} of ` +
        `${findings.length} renders do not follow the ${THEME_CONFIG.themeId} ` +
        `theme.\n\nThe theme (${THEME_CONFIG.themeFile}) is the CSS ` +
        `implementation of https://brand.devfellowship.com. Templates read its ` +
        `tokens; they never restate its values.`
    );
    process.exit(1);
  }

  console.log(
    `\nTheme-conformance check passed — ${findings.length} renders, all on theme.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

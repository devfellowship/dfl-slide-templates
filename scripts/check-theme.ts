/**
 * Theme-conformance guard (runtime / computed styles).
 *
 * Renders EVERY registered template in EVERY registered theme, in both
 * orientations — exactly as the deck runtime does — but paints the page behind
 * the slide a deliberately hostile magenta. Then it reads back computed styles
 * and asserts six things per render, plus a seventh about the deck chrome —
 * the classes the render-view injects, which no template emits and which
 * therefore no per-render assertion can see.
 *
 * WHY EVERY THEME, NOT JUST ONE. Until 2026-08-12 this guard rendered one
 * theme (`devfellowship`) and asserted against one hardcoded surface colour.
 * It therefore could not see the bug it was built to prevent: templates read
 * their tokens as `var(--s-token, <literal>)` where the literal is the DFL
 * value, themes/default.css defined NONE of those tokens, so a deck on the
 * "Default" theme fell back to the DFL literal on every element and rendered
 * DevFellowship dark. Every static check passed. Every runtime check passed.
 * The theme picker looked like it did nothing. One theme under test proves one
 * theme; the fallback makes the untested themes look fine.
 *
 * The assertions, per (template × orientation × theme):
 *
 *   1. SURFACE — `.tpl-root` paints an OPAQUE background, and that background
 *      is THIS theme's `--s-surface-page`, read back from the injected CSS
 *      rather than hardcoded here. A template with `background: transparent`
 *      passes every static check and still ships broken, because the host
 *      deck's own per-slide colour shows through. That is literally what
 *      happened: the `table` template declared `background: transparent`,
 *      dfl-lesson-studio gives each slide a random background from
 *      `generateRandomBackgroundColor` (`#1a1a2e` navy among them), and the
 *      table slide came out navy inside an otherwise near-black deck.
 *
 *   2. INK — every element that renders text resolves its colour to a value
 *      THIS theme defines. The theme's palette is collected by resolving every
 *      one of its own custom properties in the browser, so "the theme's ink"
 *      needs no duplicated table of hex codes. An ink from another theme, or a
 *      hand-rolled colour no theme owns, fails.
 *
 *   3. ACCENT — a template whose CSS reads a `--s-brand-*` token must actually
 *      paint one of THIS theme's accent values. So an Itera render shows
 *      evergreen and a Revera render shows trust-blue. A template that stopped
 *      resolving the accent (and fell back) fails here even if the fallback
 *      colour happens to be allowed elsewhere.
 *
 *   4. NO CROSS-BRAND LEAK — no rendered colour is in this theme's forbidden
 *      set (scripts/theme.config.json). This is the assertion that catches the
 *      reported bug: on unmodified origin/main, `default` renders the DFL dark
 *      surface on 45 of 46 templates and this fails.
 *
 *   5. FONTS — every element that renders text resolves to one of the four
 *      brand type families (brand guide ch. 06), in every theme. Type is not
 *      themed; a sub-brand changes colour only.
 *
 *   6. COMPLETENESS — every token any template reads resolves to a non-empty
 *      value under this theme. A missing token is what makes 1–4 possible, and
 *      this catches it directly. It also catches a theme file that a browser
 *      DROPS. An asterisk followed by a slash, written inside a CSS comment,
 *      ends that comment early; CSS error-recovery then swallows the whole
 *      `.tpl-root` block, and a purely textual token scan still finds all 42
 *      definitions in the file. Asking the browser is the only faithful check.
 *      (Burned exactly this way while writing the light theme, 2026-08-12: the
 *      phrase "--s-* / --p-* tokens" in the header comment cost the file its
 *      entire token block, and the theme rendered as if it defined nothing.)
 *
 *   7. DECK CHROME — the kicker bar, the brand lockup, the social handle and
 *      the derived slide index (`01/09`) are chassis, not slots: ADR-7 of the
 *      plan makes the render-view inject them and derive the index from
 *      `order_index` and the sibling count. So NO TEMPLATE EMITS THEM, which
 *      makes them invisible to assertions 1 to 6 — all four theme files could
 *      drop the block and 368 renders would still pass. This one renders the
 *      documented markup itself and asserts (a) statically, that no template
 *      emits a deck-chrome class, (b) that every theme styles every class in
 *      its own tokens and its own accent, and (c) that the GEOMETRY is
 *      identical across themes, which is Verification criterion 4 of the plan
 *      ("a theme swap changes colour and type, never geometry") as an
 *      assertion rather than a hope.
 *
 * Pairs with rules 5, 6 and 7 in `scripts/lint-css.mjs`, which catch the same
 * classes of bug statically and without a browser. Same two-guard shape as the
 * canvas invariant (`lint-css.mjs` rule 4 + `check-canvas.ts`).
 *
 * Usage:
 *   npm run check:theme                     # assert, exit non-zero on violation
 *   npm run check:theme -- --json out.json  # also write a measurement report
 *   npm run check:theme -- --theme itera    # one theme, for a fast local loop
 */

import { chromium, Browser } from "playwright";
import * as fs from "fs";
import * as path from "path";
import {
  CANVAS,
  ORIENTATIONS,
  Orientation,
  REPO_ROOT,
  RegistryTheme,
  buildHtmlPage,
  readRegistry,
  readThemes,
} from "./render-page";
import THEME_CONFIG from "./theme.config.json";

/**
 * The page colour behind the slide during the check. Nothing in the library is
 * allowed to let this through — if it shows up in a screenshot, a template is
 * not painting its own surface.
 */
const HOSTILE_PAGE_BG = "#ff00ff";

const ALLOWED_FONTS = new Set<string>(THEME_CONFIG.allowedFontFamilies);

type SurfaceException = { value: string | Record<string, string>; rationale: string };
const SURFACE_EXCEPTIONS: Record<string, SurfaceException> =
  THEME_CONFIG.surfaceExceptions as Record<string, SurfaceException>;

type ForbiddenSpec = {
  forbidden: { accents: Record<string, string>; surfaces: Record<string, string> };
};
const THEME_CONTRACT = THEME_CONFIG.themes as Record<string, ForbiddenSpec>;

interface Finding {
  id: string;
  orientation: Orientation;
  themeId: string;
  rootBackground: string;
  fonts: string[];
  violations: string[];
}

/** `#0a0908` / `rgb(10, 9, 8)` / `rgba(10, 9, 8, .5)` -> `10,9,8`, else null. */
function rgbTriple(value: string): string | null {
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(",");
  }
  const fn = value.trim().match(/^rgba?\(([^)]*)\)$/i);
  if (fn) {
    const parts = fn[1].split(/[,/]/).map((p) => p.trim());
    if (parts.length >= 3) return parts.slice(0, 3).map((p) => Math.round(parseFloat(p))).join(",");
  }
  return null;
}

/** Alpha of a computed colour; 1 when the value carries none. */
function alphaOf(value: string): number {
  const fn = value.trim().match(/^rgba?\(([^)]*)\)$/i);
  if (!fn) return 1;
  const parts = fn[1].split(/[,/]/).map((p) => p.trim());
  return parts.length >= 4 ? parseFloat(parts[3]) : 1;
}

/**
 * Every `--s-*` / `--p-*` token any template reads. This is the CONTRACT: a
 * theme is complete when it defines all of them. Derived from the templates
 * themselves so it can never fall behind them — the same reason the DARK /
 * DS_REDESIGN allowlists in render-page.ts were deleted.
 */
function contractTokens(): string[] {
  const tokens = new Set<string>();
  const dir = path.join(REPO_ROOT, "templates");
  for (const id of fs.readdirSync(dir)) {
    for (const orientation of ORIENTATIONS) {
      const file = path.join(dir, id, `${orientation}.css`);
      if (!fs.existsSync(file)) continue;
      for (const m of fs
        .readFileSync(file, "utf8")
        .matchAll(/var\(\s*(--[sp]-[a-z0-9-]+)/gi))
        tokens.add(m[1]);
    }
  }
  return [...tokens].sort();
}

/**
 * DECK CHROME — the classes the render-view injects around a slide, which no
 * template may emit (ADR-7 of the plan; see the block at the foot of every
 * theme file for the full rationale).
 *
 * WHY THEY NEED THEIR OWN ASSERTION. Assertions 1 to 6 all measure a RENDERED
 * TEMPLATE, and no template emits these classes — by design, because
 * `preview-gen.ts` renders a template standalone with no composition and an
 * index inside a template would bake a wrong "01/01" into every golden PNG.
 * So the deck chrome is invisible to every other guard in this file: all four
 * theme files could lose the block, or one of them could keep it while the
 * other three dropped it, and 368 renders would still pass. This assertion
 * renders the documented markup itself.
 *
 * This constant MUST mirror the markup contract written in the theme files.
 */
const DECK_CHROME_MARKUP = [
  '<div class="dfl-deck-kicker">',
  '  <span class="dfl-deck-lockup">ITERA<span class="dfl-deck-lockup-mark">/</span></span>',
  '  <span class="dfl-deck-handle">@devfellowship</span>',
  '  <span class="dfl-deck-index">',
  '    <span class="dfl-deck-index-current">01</span>',
  '    <span class="dfl-deck-index-sep">/</span>',
  '    <span class="dfl-deck-index-total">09</span>',
  "  </span>",
  "</div>",
].join("\n");

/** Every deck-chrome class, and the one thing each is REQUIRED to establish. */
const DECK_CHROME_CLASSES = [
  "dfl-deck-kicker",
  "dfl-deck-lockup",
  "dfl-deck-lockup-mark",
  "dfl-deck-handle",
  "dfl-deck-index",
  "dfl-deck-index-current",
  "dfl-deck-index-sep",
  "dfl-deck-index-total",
] as const;

/**
 * The properties that make the chrome's GEOMETRY. Read for every class in
 * every theme and required to match exactly across themes: Verification
 * criterion 4 of the plan is "a theme swap changes colour and type, never
 * geometry", and this is that sentence as an assertion. Colour and
 * font-family are deliberately absent — those are the two things a theme IS
 * allowed to change.
 */
const DECK_CHROME_GEOMETRY = [
  "display",
  "alignItems",
  "justifyContent",
  "gap",
  "flexShrink",
  "minHeight",
  "paddingBottom",
  "marginLeft",
  "marginRight",
  "borderBottomWidth",
  "borderBottomStyle",
  "fontSize",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "textTransform",
  "whiteSpace",
  "fontVariantNumeric",
] as const;

/**
 * The hard half of ADR-7, checked statically: no template may emit a
 * deck-chrome class. A template that did would render a blank or a wrong
 * index into its own committed golden PNG, because a preview has no
 * composition around it to derive the index from.
 */
function templatesEmittingDeckChrome(): string[] {
  const offenders: string[] = [];
  const dir = path.join(REPO_ROOT, "templates");
  for (const id of fs.readdirSync(dir)) {
    for (const orientation of ORIENTATIONS) {
      for (const ext of ["html", "css"]) {
        const file = path.join(dir, id, `${orientation}.${ext}`);
        if (!fs.existsSync(file)) continue;
        const src = fs.readFileSync(file, "utf8");
        for (const cls of DECK_CHROME_CLASSES)
          if (src.includes(cls)) offenders.push(`${id}/${orientation}.${ext} (${cls})`);
      }
    }
  }
  return offenders;
}

/**
 * Render the deck-chrome markup under one theme and read back what it
 * actually computes to. Returns the geometry map (compared across themes) and
 * the colour / type facts each class is required to establish.
 */
async function measureDeckChrome(
  browser: Browser,
  theme: RegistryTheme
): Promise<{
  geometry: Record<string, Record<string, string>>;
  colors: Record<string, string>;
  borderColors: Record<string, string>;
  fonts: Record<string, string>;
  brandSolid: string;
}> {
  const page = await browser.newPage();
  await page.setViewportSize(CANVAS.landscape);
  await page.setContent(buildHtmlPage("blank", "landscape", theme.id), {
    waitUntil: "domcontentloaded",
  });
  const out = await page.evaluate(
    ({ markup, classes, props }) => {
      const root = document.querySelector(".tpl-root") as HTMLElement;
      root.insertAdjacentHTML("afterbegin", markup);
      const geometry: Record<string, Record<string, string>> = {};
      const colors: Record<string, string> = {};
      const borderColors: Record<string, string> = {};
      const fonts: Record<string, string> = {};
      for (const cls of classes) {
        const el = root.querySelector(`.${cls}`) as HTMLElement | null;
        if (!el) continue;
        const cs = getComputedStyle(el);
        geometry[cls] = {};
        for (const p of props) geometry[cls][p] = (cs as any)[p] as string;
        // Both are read for every class. Shadowing one with the other would
        // silently stop checking it — the kicker's border colour and its
        // inherited ink are two different ways for the chrome to go off-brand.
        colors[cls] = cs.color;
        if (parseFloat(cs.borderBottomWidth) > 0)
          borderColors[cls] = cs.borderBottomColor;
        fonts[cls] = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
      }
      return {
        geometry,
        colors,
        borderColors,
        fonts,
        brandSolid: getComputedStyle(root).getPropertyValue("--s-brand-solid").trim(),
      };
    },
    {
      markup: DECK_CHROME_MARKUP,
      classes: DECK_CHROME_CLASSES as unknown as string[],
      props: DECK_CHROME_GEOMETRY as unknown as string[],
    }
  );
  await page.close();
  return out;
}

/** Templates whose CSS reads at least one `--s-brand-*` token. */
function templatesReadingAccent(): Set<string> {
  const ids = new Set<string>();
  const dir = path.join(REPO_ROOT, "templates");
  for (const id of fs.readdirSync(dir)) {
    for (const orientation of ORIENTATIONS) {
      const file = path.join(dir, id, `${orientation}.css`);
      if (!fs.existsSync(file)) continue;
      if (/var\(\s*--s-brand-/.test(fs.readFileSync(file, "utf8"))) ids.add(id);
    }
  }
  return ids;
}

/** Swap the preview page background for the hostile one. */
function hostilePage(id: string, orientation: Orientation, themeId: string): string {
  return buildHtmlPage(id, orientation, themeId).replace(
    /background: #0a0908;/,
    `background: ${HOSTILE_PAGE_BG};`
  );
}

/**
 * Resolve, in a real browser, every custom property the theme defines plus
 * every contract token. Returns the theme's own palette (what it is allowed to
 * paint with) and the resolved value of each contract token (to prove none is
 * missing).
 */
async function resolveTheme(
  browser: Browser,
  theme: RegistryTheme,
  tokens: string[]
): Promise<{ palette: Set<string>; resolved: Record<string, string> }> {
  const page = await browser.newPage();
  await page.setViewportSize(CANVAS.landscape);
  // `blank` is the smallest template; any template works, the tokens come from
  // the theme block on .tpl-root.
  await page.setContent(buildHtmlPage("blank", "landscape", theme.id), {
    waitUntil: "domcontentloaded",
  });
  const out = await page.evaluate(
    ({ tokens, themeFile }) => {
      const root = document.querySelector(".tpl-root") as HTMLElement;
      const cs = getComputedStyle(root);
      const resolved: Record<string, string> = {};
      for (const t of tokens) resolved[t] = cs.getPropertyValue(t).trim();
      // Every custom property the THEME declares, read from its own stylesheet
      // text, then resolved. This is the theme's palette.
      const declared = new Set<string>();
      for (const m of themeFile.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
      const palette: string[] = [];
      for (const name of declared) {
        const v = cs.getPropertyValue(name).trim();
        if (v) palette.push(v);
      }
      return { resolved, palette };
    },
    {
      tokens,
      themeFile: fs.readFileSync(path.join(REPO_ROOT, theme.file), "utf8"),
    }
  );
  await page.close();
  return { palette: new Set(out.palette), resolved: out.resolved };
}

async function main(): Promise<void> {
  const jsonFlagIdx = process.argv.indexOf("--json");
  const jsonPath = jsonFlagIdx !== -1 ? process.argv[jsonFlagIdx + 1] : null;
  const themeFlagIdx = process.argv.indexOf("--theme");
  const onlyTheme = themeFlagIdx !== -1 ? process.argv[themeFlagIdx + 1] : null;

  const registry = readRegistry();
  const allThemes = readThemes();
  const themes = onlyTheme ? allThemes.filter((t) => t.id === onlyTheme) : allThemes;
  if (themes.length === 0) {
    console.error(
      `--theme ${onlyTheme} matches no theme in registry.json (have: ` +
        `${allThemes.map((t) => t.id).join(", ")}).`
    );
    process.exit(1);
  }

  const tokens = contractTokens();
  const accentReaders = templatesReadingAccent();

  // The directory and the registry must agree about which templates exist.
  // Asserted rather than counted, so neither list can quietly drift and so
  // this file never carries a hardcoded template count.
  const onDisk = fs
    .readdirSync(path.join(REPO_ROOT, "templates"))
    .filter((d) => fs.existsSync(path.join(REPO_ROOT, "templates", d, "config.yaml")))
    .sort();
  const inRegistry = registry.templates.map((t) => t.id).sort();
  const missingFromRegistry = onDisk.filter((id) => !inRegistry.includes(id));
  const missingFromDisk = inRegistry.filter((id) => !onDisk.includes(id));
  if (missingFromRegistry.length || missingFromDisk.length) {
    console.error(
      `templates/ and registry.json disagree.\n` +
        (missingFromRegistry.length
          ? `  on disk, not registered: ${missingFromRegistry.join(", ")}\n`
          : "") +
        (missingFromDisk.length
          ? `  registered, not on disk: ${missingFromDisk.join(", ")}\n`
          : "") +
        `Every guard here iterates the registry, so an unregistered template ` +
        `is an UNCHECKED template.`
    );
    process.exit(1);
  }

  const browser = await chromium.launch();
  const findings: Finding[] = [];
  const themeErrors: string[] = [];

  // 7a. DECK CHROME — the hard half of ADR-7, and it is static.
  const chromeOffenders = templatesEmittingDeckChrome();
  if (chromeOffenders.length) {
    themeErrors.push(
      `${chromeOffenders.length} template file(s) emit a deck-chrome class, ` +
        `which ADR-7 forbids: ${chromeOffenders.join(", ")}.\n` +
        `      The render-view injects the kicker, the lockup, the handle and ` +
        `the index; it derives "01/09" from order_index and the sibling count. ` +
        `A preview renders a template STANDALONE, with no composition, so an ` +
        `index inside a template bakes a blank or a wrong "01/01" into the ` +
        `committed golden PNG.`
    );
  }
  /** Per-theme geometry of the deck chrome, compared after the loop. */
  const chromeGeometry: Record<string, Record<string, Record<string, string>>> = {};

  for (const theme of themes) {
    if (!THEME_CONTRACT[theme.id]) {
      themeErrors.push(
        `registry.json declares theme "${theme.id}" but scripts/theme.config.json ` +
          `has no contract for it. Add a "themes.${theme.id}" entry with its ` +
          `forbidden colours (the other brands' accents, per their guides).`
      );
      continue;
    }
    if (!fs.existsSync(path.join(REPO_ROOT, theme.file))) {
      themeErrors.push(`theme "${theme.id}" declares file ${theme.file}, which does not exist.`);
      continue;
    }

    const { palette, resolved } = await resolveTheme(browser, theme, tokens);

    // 6. COMPLETENESS — before rendering anything, every contract token must
    //    resolve. An unresolved token means every template that reads it
    //    silently paints the DevFellowship fallback literal.
    const unresolved = tokens.filter((t) => !resolved[t]);
    if (unresolved.length) {
      themeErrors.push(
        `theme "${theme.id}" (${theme.file}) does not define ${unresolved.length} of ` +
          `${tokens.length} tokens that templates read: ${unresolved.join(", ")}.\n` +
          `      Every template reads these as var(--token, <DFL literal>), so an ` +
          `undefined token does not fail — it renders the DevFellowship colour ` +
          `under your theme. That is the 2026-08-12 "Default deck renders dark" bug.\n` +
          `      (If the tokens ARE in the file, a browser is dropping the rule. ` +
          `Check for a "*" followed by "/" inside a CSS comment: it closes the ` +
          `comment early and error-recovery swallows the whole .tpl-root block.)`
      );
      // Deliberately NOT `continue`. An incomplete theme is exactly the state
      // that produces the cross-brand leak, so the renders below are the
      // evidence for WHERE it leaks — 45 of 46 slides painting DFL sand-950 on
      // a light deck says more than one line about 42 missing tokens.
    }

    const surfaceValue = resolved[THEME_CONFIG.surfaceToken];
    const accentValues = new Set(
      THEME_CONFIG.accentTokens.map((t) => rgbTriple(resolved[t])).filter(Boolean) as string[]
    );
    const paletteTriples = new Set(
      [...palette].map((v) => `${rgbTriple(v)}@${alphaOf(v)}`)
    );
    const forbidden = THEME_CONTRACT[theme.id].forbidden;
    const forbiddenAccents = new Map(
      Object.entries(forbidden.accents).map(([hex, why]) => [rgbTriple(hex)!, { hex, why }])
    );
    const forbiddenSurfaces = new Map(
      Object.entries(forbidden.surfaces).map(([hex, why]) => [rgbTriple(hex)!, { hex, why }])
    );

    // 7b. DECK CHROME — every class the render-view injects must be styled by
    //     THIS theme. No template emits them, so nothing else here can see
    //     them: a theme that lost the block would pass all 368 renders.
    const chrome = await measureDeckChrome(browser, theme);
    chromeGeometry[theme.id] = chrome.geometry;
    for (const cls of DECK_CHROME_CLASSES) {
      if (!chrome.geometry[cls]) {
        themeErrors.push(
          `theme "${theme.id}" (${theme.file}) does not style .${cls}. The ` +
            `render-view injects it around every slide, so an unstyled class ` +
            `renders as unthemed inline text on this brand only.`
        );
        continue;
      }
      const font = chrome.fonts[cls];
      if (font && !ALLOWED_FONTS.has(font)) {
        themeErrors.push(
          `theme "${theme.id}": .${cls} renders in "${font}", which is not one ` +
            `of the brand type families (${[...ALLOWED_FONTS].join(", ")}).`
        );
      }
      for (const [role, color] of [
        ["ink", chrome.colors[cls]],
        ["border", chrome.borderColors[cls]],
      ] as const) {
        if (!color) continue;
        if (paletteTriples.has(`${rgbTriple(color)}@${alphaOf(color)}`)) continue;
        themeErrors.push(
          `theme "${theme.id}": .${cls} paints ${color} (${role}), which theme ` +
            `"${theme.id}" does not define. Read one of its tokens.`
        );
      }
    }
    // The lockup's accent glyph is a BRAND RULE, not a style preference: Itera
    // guide 6.1 — "Não troque a cor do slash. Slash Itera = evergreen #3fd17f.
    // Sempre." Expressed generically, the mark is this theme's accent.
    const markColor = chrome.colors["dfl-deck-lockup-mark"];
    if (markColor && rgbTriple(markColor) !== rgbTriple(chrome.brandSolid)) {
      themeErrors.push(
        `theme "${theme.id}": .dfl-deck-lockup-mark paints ${markColor}, not ` +
          `this theme's --s-brand-solid (${chrome.brandSolid}). The lockup mark ` +
          `carries the accent — on Itera the slash is evergreen "sempre" ` +
          `(guide 6.1), and every brand's mark follows the same rule.`
      );
    }

    for (const { id } of registry.templates) {
      for (const orientation of ORIENTATIONS) {
        const page = await browser.newPage();
        await page.setViewportSize(CANVAS[orientation]);
        await page.setContent(hostilePage(id, orientation, theme.id), {
          waitUntil: "networkidle",
        });

        const measured = await page.evaluate(() => {
          const root = document.querySelector(".tpl-root") as HTMLElement | null;
          if (!root) return null;
          const families = new Set<string>();
          const textColors = new Set<string>();
          /** Every colour the render actually paints, with where it came from. */
          const painted: { value: string; where: string }[] = [];
          const note = (value: string, where: string) => {
            if (!value || value === "rgba(0, 0, 0, 0)" || value === "transparent") return;
            painted.push({ value, where });
          };
          const label = (el: Element, suffix = "") =>
            `${el.className || el.tagName}${suffix}`;

          for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
            const cs = getComputedStyle(el);
            const ownText = Array.from(el.childNodes).some(
              (n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0
            );
            if (ownText) {
              families.add(cs.fontFamily.split(",")[0].replace(/["']/g, "").trim());
              textColors.add(cs.color);
              note(cs.color, `${label(el)} (text)`);
            }
            note(cs.backgroundColor, `${label(el)} (background)`);
            for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
              if (parseFloat((cs as any)[`border${side}Width`]) > 0)
                note((cs as any)[`border${side}Color`], `${label(el)} (border)`);
            }
            for (const [prop, kind] of [
              ["backgroundImage", "gradient"],
              ["boxShadow", "shadow"],
            ] as const) {
              const v = (cs as any)[prop] as string;
              if (v && v !== "none")
                for (const m of v.matchAll(/rgba?\([^)]*\)/g))
                  note(m[0], `${label(el)} (${kind})`);
            }
            for (const pseudo of ["::before", "::after"]) {
              const p = getComputedStyle(el, pseudo);
              if (!p.content || p.content === "none") continue;
              note(p.backgroundColor, label(el, `${pseudo} background`));
              note(p.color, label(el, `${pseudo} color`));
              for (const [prop, kind] of [
                ["backgroundImage", "gradient"],
                ["boxShadow", "shadow"],
              ] as const) {
                const v = (p as any)[prop] as string;
                if (v && v !== "none")
                  for (const m of v.matchAll(/rgba?\([^)]*\)/g))
                    note(m[0], label(el, `${pseudo} ${kind}`));
              }
            }
          }
          return {
            background: getComputedStyle(root).backgroundColor,
            families: Array.from(families),
            textColors: Array.from(textColors),
            painted,
          };
        });
        await page.close();

        if (!measured) {
          findings.push({
            id,
            orientation,
            themeId: theme.id,
            rootBackground: "",
            fonts: [],
            violations: ["no .tpl-root element found"],
          });
          continue;
        }

        const violations: string[] = [];

        // 1. SURFACE.
        const exception = SURFACE_EXCEPTIONS[id];
        const expectedSurface = exception
          ? typeof exception.value === "string"
            ? exception.value
            : exception.value[theme.id]
          : surfaceValue;

        const alpha = alphaOf(measured.background);
        if (alpha < 1) {
          violations.push(
            `.tpl-root background is ${measured.background} (not opaque) — the ` +
              `host deck's own slide colour shows through. Paint the themed ` +
              `surface: background: var(${THEME_CONFIG.surfaceToken}, #0a0908);`
          );
        } else if (rgbTriple(measured.background) !== rgbTriple(expectedSurface ?? "")) {
          violations.push(
            `.tpl-root background is ${measured.background}, expected ` +
              `${expectedSurface} — this theme's ${THEME_CONFIG.surfaceToken}. ` +
              `Add an entry to "surfaceExceptions" in scripts/theme.config.json ` +
              `if this is deliberate.`
          );
        }

        // 2. INK — every text colour must be a value this theme defines.
        for (const color of measured.textColors) {
          const key = `${rgbTriple(color)}@${alphaOf(color)}`;
          if (paletteTriples.has(key)) continue;
          violations.push(
            `text renders in ${color}, which theme "${theme.id}" does not define. ` +
              `Either the token did not resolve (and the DevFellowship fallback ` +
              `literal is showing) or the template hand-rolled a colour. Read a ` +
              `token: color: var(--s-ink-primary, …).`
          );
        }

        // 3. ACCENT — a template that reads --s-brand-* must paint this
        //    theme's accent.
        if (accentReaders.has(id)) {
          const paintedTriples = new Set(
            measured.painted.map((p) => rgbTriple(p.value)).filter(Boolean) as string[]
          );
          if (![...accentValues].some((a) => paintedTriples.has(a))) {
            violations.push(
              `reads a --s-brand-* token but paints none of theme "${theme.id}"'s ` +
                `accent values (${THEME_CONFIG.accentTokens.map((t) => `${t}=${resolved[t]}`).join(", ")}). ` +
                `The accent is not reaching the page.`
            );
          }
        }

        // 4. NO CROSS-BRAND LEAK.
        for (const { value, where } of measured.painted) {
          const triple = rgbTriple(value);
          if (!triple) continue;
          const accentHit = forbiddenAccents.get(triple);
          if (accentHit) {
            violations.push(
              `paints ${value} on ${where} — ${accentHit.hex} is forbidden on ` +
                `theme "${theme.id}": ${accentHit.why}`
            );
            continue;
          }
          if (alphaOf(value) < 1) continue; // compositing value, not a palette entry
          const surfaceHit = forbiddenSurfaces.get(triple);
          if (surfaceHit) {
            violations.push(
              `paints opaque ${value} on ${where} — ${surfaceHit.hex} is ` +
                `forbidden on theme "${theme.id}": ${surfaceHit.why}`
            );
          }
        }

        // 5. FONTS.
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
          themeId: theme.id,
          rootBackground: measured.background,
          fonts: measured.families,
          // De-duplicate: one broken token can produce the same message on
          // twenty elements, and twenty copies help nobody.
          violations: [...new Set(violations)],
        });
      }
    }
  }

  await browser.close();

  // 7c. DECK CHROME — geometry parity. Verification criterion 4 of the plan:
  //     "a theme swap changes colour and type, NEVER geometry". The deck-chrome
  //     block is byte-identical in every theme file on purpose, and this is the
  //     assertion that keeps it that way even if someone edits one copy.
  //     Skipped under --theme, which measures one theme and so has no pair.
  const chromeThemeIds = Object.keys(chromeGeometry);
  if (chromeThemeIds.length > 1) {
    const [ref, ...rest] = chromeThemeIds;
    for (const other of rest) {
      for (const cls of DECK_CHROME_CLASSES) {
        const a = chromeGeometry[ref][cls];
        const b = chromeGeometry[other][cls];
        if (!a || !b) continue;
        for (const prop of DECK_CHROME_GEOMETRY) {
          if (a[prop] === b[prop]) continue;
          themeErrors.push(
            `deck chrome geometry differs between themes "${ref}" and ` +
              `"${other}": .${cls} { ${prop} } is ${a[prop]} vs ${b[prop]}. A ` +
              `theme changes colour and type, never geometry — so the ` +
              `deck-chrome block must stay byte-identical in every theme file.`
          );
        }
      }
    }
  }

  if (jsonPath) {
    fs.writeFileSync(path.resolve(jsonPath), JSON.stringify(findings, null, 2));
    console.log(`Wrote theme measurement report to ${jsonPath}`);
  }

  for (const e of themeErrors) console.error(`  ✗  ${e}`);

  let lastTheme = "";
  for (const f of findings) {
    if (f.themeId !== lastTheme) {
      lastTheme = f.themeId;
      console.log(`\n── theme: ${f.themeId} ──`);
    }
    if (f.violations.length === 0) {
      console.log(
        `  ✓  ${f.id} (${f.orientation}) — ${f.rootBackground}` +
          (f.fonts.length ? ` · ${f.fonts.join(" · ")}` : "")
      );
    } else {
      for (const v of f.violations) {
        console.error(`  ✗  ${f.id} (${f.orientation}) [${f.themeId}] — ${v}`);
      }
    }
  }

  const failed = findings.filter((f) => f.violations.length > 0);
  const summary =
    `${findings.length} renders — ${registry.templates.length} templates × ` +
    `${themes.length} theme(s) × ${ORIENTATIONS.length} orientations`;

  if (failed.length > 0 || themeErrors.length > 0) {
    console.error(
      `\nTheme-conformance check FAILED — ${failed.length} of ${summary} do not ` +
        `follow the theme they were rendered in` +
        (themeErrors.length ? `, and ${themeErrors.length} theme(s) are incomplete` : "") +
        `.\n\nA theme is the CSS implementation of a brand guide ` +
        `(https://brand.devfellowship.com and its /itera and /revera ` +
        `sub-brands). Templates read its tokens; they never restate its values. ` +
        `A token a theme does not define does not fail loudly — it renders the ` +
        `DevFellowship fallback literal instead.`
    );
    process.exit(1);
  }

  console.log(
    `\nTheme-conformance check passed — ${summary}, all on theme.\n` +
      `Themes: ${themes.map((t) => `${t.id} (${t.mode})`).join(", ")}\n` +
      `Contract: ${tokens.length} tokens, every one defined by every theme.\n` +
      `Deck chrome: ${DECK_CHROME_CLASSES.length} classes, styled by every ` +
      `theme, identical geometry, emitted by no template.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

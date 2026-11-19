/**
 * check-component-render.mjs — render every overlay component in every theme
 * and read the result back from a real browser.
 *
 * WHY THIS FILE EXISTS
 *   `check-theme.ts` sweeps the slide templates. A component is not a slide: it
 *   is a box on a TRANSPARENT page, smaller than the canvas, and it renders slot
 *   values that agents write. So it gets its own sweep, with the same idea
 *   (every component x every theme in registry.json) and these assertions:
 *
 *     1. MOUNT     — exactly one non-empty .tpl-root, and no `pageerror`.
 *     2. BOX       — the laid-out .tpl-root fits the declared `box` and is not 0x0.
 *     3. TOKENS    — every var(--s-*) the component CSS reads is defined by the theme
 *                    (a missing token silently falls back to the DFL literal, which
 *                    renders the wrong brand — the 2026-08-12 failure).
 *     4. FONTS     — every text element computes to a brand family.
 *     5. ESCAPING  — with `<img src=x onerror=alert(1)>` in every text slot, the
 *                    value shows as text, the DOM has zero <script>, zero on*
 *                    attributes, and no dialog opens (plan Verification row 2c,
 *                    template side).
 *     6. OPTIONS   — every option of every select slot renders without an error.
 *
 *   Plan 20261119-lesson-studio-overlay-components, T1 ("check-theme for
 *   components") and ADR-2.
 *
 * Run:  npm run check:component-render
 * Exit: 0 = every component holds in every theme. 1 = a finding, or nothing to render.
 */

import { readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import Mustache from 'mustache';
import { chromium } from 'playwright';
import { REPO_ROOT, listComponentDirs } from './check-component-safety.mjs';
import { componentView, readConfig } from './component-format.mjs';

const REGISTRY = JSON.parse(readFileSync(join(REPO_ROOT, 'registry.json'), 'utf8'));
const THEME_CONFIG = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts', 'theme.config.json'), 'utf8'));
const ALLOWED_FONTS = new Set(THEME_CONFIG.allowedFontFamilies);
const HOSTILE_TEXT = '<img src=x onerror=alert(1)>';

function page(themeCss, css, html) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<style>
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: transparent; }
${themeCss}
${css}
</style></head>
<body>${html}</body></html>`;
}

function sampleOf(dir, config) {
  try {
    return JSON.parse(readFileSync(join(dir, 'sample.json'), 'utf8'));
  } catch {
    const s = {};
    for (const slot of config.slots) if (slot.sample !== undefined) s[slot.name] = slot.sample;
    return s;
  }
}

async function renderOnce(browser, { themeCss, css, template, view }) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const pg = await ctx.newPage();
  const errors = [];
  let dialog = false;
  // Armed BEFORE the content loads.
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('dialog', async (d) => { dialog = true; await d.dismiss().catch(() => {}); });
  await pg.route('**/*', (route) => route.abort()); // no network: a component loads nothing at render time in this check
  await pg.setContent(page(themeCss, css, Mustache.render(template, view)), { waitUntil: 'load' });
  await pg.evaluate(() => document.fonts.ready);
  const facts = await pg.evaluate(() => {
    const roots = document.querySelectorAll('.tpl-root');
    const root = roots[0];
    const rect = root ? root.getBoundingClientRect() : null;
    const handlers = [...document.querySelectorAll('*')].flatMap((el) => [...el.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${el.tagName.toLowerCase()}[${a.name}]`));
    const fonts = [];
    if (root) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own) continue;
        const fam = getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
        fonts.push({ tag: el.tagName.toLowerCase(), cls: el.className && el.className.baseVal === undefined ? el.className : '', fam });
      }
    }
    return {
      rootCount: roots.length,
      rootEmpty: root ? root.children.length === 0 && !root.textContent.trim() : true,
      rect: rect ? { w: rect.width, h: rect.height } : null,
      text: root ? root.textContent : '',
      scripts: document.querySelectorAll('script').length,
      handlers,
      fonts,
    };
  });
  const tokens = async (names) =>
    pg.evaluate((ns) => {
      const root = document.querySelector('.tpl-root');
      if (!root) return ns.map((n) => [n, '']);
      const cs = getComputedStyle(root);
      return ns.map((n) => [n, cs.getPropertyValue(n).trim()]);
    }, names);
  return { errors, dialog, facts, tokens, close: () => ctx.close() };
}

async function main() {
  const dirs = listComponentDirs();
  if (dirs.length === 0) {
    console.error('check:component-render: no component directory found. Refusing a vacuous pass.');
    return 1;
  }
  const themes = REGISTRY.themes;
  if (!Array.isArray(themes) || themes.length === 0) {
    console.error('registry.json has no themes.');
    return 1;
  }
  const browser = await chromium.launch();
  const findings = [];
  let renders = 0;
  try {
    for (const dir of dirs) {
      const rel = relative(REPO_ROOT, dir);
      const id = basename(dir);
      const config = readConfig(dir);
      const template = readFileSync(join(dir, 'component.html'), 'utf8');
      const css = readFileSync(join(dir, 'component.css'), 'utf8');
      const usedTokens = [...new Set([...css.matchAll(/var\(\s*(--s-[a-z0-9-]+)/g)].map((m) => m[1]))];
      const sample = sampleOf(dir, config);
      const textSlots = config.slots.filter((s) => s.type === 'text');
      const selectSlots = config.slots.filter((s) => s.type === 'select');
      const before = findings.length;

      for (const theme of themes) {
        const themeCss = readFileSync(join(REPO_ROOT, theme.file), 'utf8');
        const where = `${rel} x ${theme.id}`;
        const fail = (what) => findings.push(`${where}: ${what}`);

        // 1-4: the sample render.
        const r = await renderOnce(browser, { themeCss, css, template, view: componentView(config, sample) });
        renders++;
        const f = r.facts;
        if (r.errors.length) fail(`pageerror: ${r.errors.join(' | ')}`);
        if (f.rootCount !== 1) fail(`expected exactly one .tpl-root, found ${f.rootCount}.`);
        if (f.rootEmpty) fail('.tpl-root is empty (MOUNT).');
        if (!f.rect || f.rect.w < 1 || f.rect.h < 1) fail(`.tpl-root has no size (${JSON.stringify(f.rect)}).`);
        else if (f.rect.w > config.box.width + 1 || f.rect.h > config.box.height + 1) {
          fail(`.tpl-root is ${Math.round(f.rect.w)}x${Math.round(f.rect.h)}, larger than the declared box ${config.box.width}x${config.box.height}.`);
        }
        for (const [name, value] of await r.tokens(usedTokens)) {
          if (!value) fail(`the theme does not define ${name}, so the component falls back to its literal (wrong brand).`);
        }
        for (const t of f.fonts) {
          if (!ALLOWED_FONTS.has(t.fam)) fail(`<${t.tag} class="${t.cls}"> computes to font "${t.fam}", not a brand family (${[...ALLOWED_FONTS].join(', ')}).`);
        }
        await r.close();

        // 5: hostile text in every text slot.
        if (textSlots.length) {
          const hostile = { ...sample };
          for (const s of textSlots) hostile[s.name] = HOSTILE_TEXT.slice(0, s.max_length);
          const h = await renderOnce(browser, { themeCss, css, template, view: componentView(config, hostile) });
          renders++;
          if (h.errors.length) fail(`hostile render: pageerror ${h.errors.join(' | ')}`);
          if (h.dialog) fail('hostile render: a dialog opened — a slot value ran script.');
          if (h.facts.scripts) fail(`hostile render: ${h.facts.scripts} <script> element(s) in the DOM.`);
          if (h.facts.handlers.length) fail(`hostile render: event handler attributes in the DOM: ${h.facts.handlers.join(', ')}.`);
          const shown = textSlots.some((s) => h.facts.text.includes(HOSTILE_TEXT.slice(0, s.max_length)));
          if (!shown) fail('hostile render: the slot value does not show as visible text (it was dropped or parsed as markup).');
          await h.close();
        }

        // 6: every select option, in the default theme only (the option swaps markup, not tokens).
        if (theme.id === themes[0].id) {
          for (const s of selectSlots) {
            for (const opt of s.options) {
              const o = await renderOnce(browser, { themeCss, css, template, view: componentView(config, { ...sample, [s.name]: opt }) });
              renders++;
              if (o.errors.length) fail(`${s.name}=${opt}: pageerror ${o.errors.join(' | ')}`);
              if (o.facts.rootEmpty) fail(`${s.name}=${opt}: .tpl-root is empty.`);
              await o.close();
            }
          }
        }
      }
      const mine = findings.length - before;
      console.log(`${mine ? 'FAIL' : 'ok  '}  ${rel} (${id}): ${themes.length} theme(s)${mine ? `, ${mine} finding(s)` : ''}`);
    }
  } finally {
    await browser.close();
  }
  if (findings.length) {
    console.error(`\ncomponent render: ${findings.length} finding(s)`);
    for (const f of findings) console.error(`  x ${f}`);
    return 1;
  }
  console.log(`\ncomponent render OK: ${dirs.length} component(s) x ${themes.length} theme(s), ${renders} render(s).`);
  return 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });

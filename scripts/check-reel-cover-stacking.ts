/**
 * Reel-cover stacking-order guard.
 *
 * `reel-cover`'s presenter photo sits inside `.tpl-reel-cover__figure`, which
 * paints a `.tpl-reel-cover__pool` shadow BEHIND the cut-out (a large radial
 * gradient) plus a `.tpl-reel-cover__floor` shadow under it. Both are
 * `position: relative|absolute` with `z-index: auto`, and the copy block
 * (`.tpl-reel-cover__copy`, holding the headline/kicker/handle) used to have
 * no `position` at all.
 *
 * Per the CSS2.1 painting order, a positioned descendant with `z-index: auto`
 * paints AFTER a sibling's plain non-positioned in-flow content, regardless of
 * DOM order. Because the pool's 440px circle bleeds well past the figure's own
 * box (it is centred 44% down a 294px-tall figure with a 220px radius), it
 * painted on top of the bottom of the headline whenever the two boxes
 * overlapped — darkening the middle of a published cover's orange headline.
 * Fixed 2026-09-18 by giving `.tpl-reel-cover__copy` its own stacking context
 * (`position: relative; z-index: 1`) above the figure's.
 *
 * This guard renders the template with its own sample data (which reliably
 * overlaps the two boxes — see the sample headline, two lines at 96px) and
 * hit-tests the geometric centre of that overlap with `elementsFromPoint`,
 * which returns elements in actual PAINT order (topmost first). It fails
 * whenever the shadow pool is hit before the headline — i.e. whenever the
 * shadow would visually paint over the text — regardless of whether a future
 * regression reintroduces the bug via a dropped `position`, a lower
 * `z-index`, a reordered DOM, or something else that changes paint order.
 *
 * Usage: npm run check:reel-cover-stacking
 */

import { chromium } from "playwright";
import { buildHtmlPage } from "./render-page";

interface OverlapResult {
  ok: boolean;
  reason?: string;
  headlineIdx?: number;
  poolIdx?: number;
  x?: number;
  y?: number;
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
    await page.setContent(buildHtmlPage("reel-cover", "portrait"), {
      waitUntil: "networkidle",
    });
    await page.evaluate(() => (document as any).fonts.ready);

    const result: OverlapResult = await page.evaluate(() => {
      const headline = document.querySelector(".tpl-reel-cover__headline");
      const pool = document.querySelector(".tpl-reel-cover__pool");
      if (!headline || !pool) {
        return { ok: false, reason: "headline or pool element not found in the rendered DOM" };
      }

      const hr = headline.getBoundingClientRect();
      const pr = pool.getBoundingClientRect();

      const ix0 = Math.max(hr.left, pr.left);
      const ix1 = Math.min(hr.right, pr.right);
      const iy0 = Math.max(hr.top, pr.top);
      const iy1 = Math.min(hr.bottom, pr.bottom);

      if (ix1 <= ix0 || iy1 <= iy0) {
        return {
          ok: false,
          reason:
            "headline and pool bounding boxes do not overlap on this render — " +
            "the sample data (or the layout) changed enough that this guard's " +
            "premise no longer holds. Update the sample data or the guard.",
        };
      }

      const x = (ix0 + ix1) / 2;
      const y = (iy0 + iy1) / 2;
      const stack = document.elementsFromPoint(x, y);

      let headlineIdx = -1;
      let poolIdx = -1;
      stack.forEach((el, i) => {
        if (headlineIdx === -1 && el.classList.contains("tpl-reel-cover__headline")) {
          headlineIdx = i;
        }
        if (poolIdx === -1 && el.classList.contains("tpl-reel-cover__pool")) {
          poolIdx = i;
        }
      });

      if (headlineIdx === -1 || poolIdx === -1) {
        return {
          ok: false,
          reason: `headline or pool not present in elementsFromPoint(${x}, ${y})`,
        };
      }

      return { ok: true, headlineIdx, poolIdx, x, y };
    });

    if (!result.ok) {
      console.error(`check:reel-cover-stacking: FAIL — ${result.reason}`);
      process.exitCode = 1;
      return;
    }

    const { headlineIdx, poolIdx, x, y } = result;
    // elementsFromPoint is ordered topmost-first, so a LOWER index paints on
    // top. The shadow must never win: poolIdx must be greater (further back)
    // than headlineIdx.
    if (poolIdx! < headlineIdx!) {
      console.error(
        `check:reel-cover-stacking: FAIL — .tpl-reel-cover__pool paints above ` +
          `.tpl-reel-cover__headline at their overlap point (${x}, ${y}) ` +
          `(pool elementsFromPoint index ${poolIdx}, headline index ${headlineIdx}; ` +
          `a lower index paints on top). This is the shadow-over-text ` +
          `regression: give .tpl-reel-cover__copy a stacking context ` +
          `(position + z-index) above .tpl-reel-cover__figure's.`
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      `check:reel-cover-stacking: OK — headline (index ${headlineIdx}) paints above ` +
        `the shadow pool (index ${poolIdx}) at their overlap point (${x}, ${y}).`
    );
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

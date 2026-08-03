import { chromium } from "playwright";
import * as path from "path";
import {
  CANVAS,
  ORIENTATIONS,
  REPO_ROOT,
  buildHtmlPage,
  readRegistry,
} from "./render-page";

async function main(): Promise<void> {
  const registry = readRegistry();
  const browser = await chromium.launch();

  for (const entry of registry.templates) {
    const { id } = entry;
    console.log(`Generating previews for: ${id}`);

    for (const name of ORIENTATIONS) {
      const { width, height } = CANVAS[name];
      const html = buildHtmlPage(id, name);
      const page = await browser.newPage();
      await page.setViewportSize({ width, height });
      await page.setContent(html, { waitUntil: "networkidle" });

      const outputPath = path.join(
        REPO_ROOT,
        "templates",
        id,
        `preview-${name}.png`
      );
      await page.screenshot({ path: outputPath, fullPage: false });
      await page.close();
      console.log(`  Saved ${outputPath}`);
    }
  }

  await browser.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import Mustache from "mustache";
import { SAMPLE_DATA } from "./sample-data";

const REPO_ROOT = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(REPO_ROOT, "registry.json");

interface RegistryEntry {
  id: string;
  version: string;
  category: string;
}

interface Registry {
  templates: RegistryEntry[];
}

const DARK_TEMPLATES = new Set([
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
const DS_REDESIGN_TEMPLATES = new Set([
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

async function buildHtmlPage(
  templateId: string,
  orientation: "landscape" | "portrait"
): Promise<string> {
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
    html, body { margin: 0; padding: 0; background: ${bgColor}; }
    ${themeCss}
    ${css}
  </style>
</head>
<body>
${renderedHtml}
</body>
</html>`;
}

async function main(): Promise<void> {
  const registry: Registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  const browser = await chromium.launch();

  for (const entry of registry.templates) {
    const { id } = entry;
    console.log(`Generating previews for: ${id}`);

    const orientations: Array<{
      name: "landscape" | "portrait";
      width: number;
      height: number;
    }> = [
      { name: "landscape", width: 1280, height: 720 },
      { name: "portrait", width: 720, height: 1280 },
    ];

    for (const { name, width, height } of orientations) {
      const html = await buildHtmlPage(id, name);
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

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import Mustache from "mustache";

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

// Sample data used to fill each template's Mustache tokens for preview rendering.
const SAMPLE_DATA: Record<string, Record<string, unknown>> = {
  title: {
    title: "Welcome to the Platform",
    subtitle: "A modern foundation for your presentations",
  },
  "bullet-list": {
    title: "Key Highlights",
    items: [
      { text: "Fully customisable slide templates" },
      { text: "Mustache-powered token substitution" },
      { text: "Landscape and portrait orientations" },
      { text: "Automated preview generation" },
    ],
  },
  "two-column": {
    title: "Side by Side Comparison",
    leftContent:
      "<h3>Approach A</h3><p>Simple, battle-tested methodology that scales well for small teams and iterative projects.</p><ul><li>Low overhead</li><li>Fast iteration</li></ul>",
    rightContent:
      "<h3>Approach B</h3><p>Structured framework designed for large organisations with complex delivery pipelines.</p><ul><li>Strong governance</li><li>Audit trail</li></ul>",
  },
  "img-text": {
    imageUrl:
      "https://images.unsplash.com/photo-1551650975-87deedd944c3?w=800&auto=format&fit=crop",
    imageAlt: "Developer working on a laptop",
    title: "Built for developers",
    body: "<p>Our template engine integrates seamlessly with your existing workflow. Write HTML once, render everywhere.</p><ul><li>Mustache tokens</li><li>Scoped CSS</li><li>Playwright previews</li></ul>",
  },
  quote: {
    quote:
      "Any sufficiently advanced technology is indistinguishable from magic.",
    author: "Arthur C. Clarke",
    source: "Profiles of the Future, 1962",
  },
  "code-block": {
    title: "Rendering a Template",
    language: "typescript",
    code: `import Mustache from 'mustache';\nimport * as fs from 'fs';\n\nconst template = fs.readFileSync('landscape.html', 'utf8');\nconst output = Mustache.render(template, {\n  title: 'Hello, World!',\n  subtitle: 'My first slide',\n});\n\nconsole.log(output);`,
  },
  image: {
    imageUrl:
      "https://images.unsplash.com/photo-1551650975-87deedd944c3?w=800&auto=format&fit=crop",
    description: "A developer working on the next generation of slide templates",
  },
  table: {
    title: "Q1 Performance",
    headers: [
      { label: "Metric" },
      { label: "Target" },
      { label: "Actual" },
      { label: "Status" },
    ],
    rows: [
      { cells: [{ value: "Revenue" }, { value: "$1.2M" }, { value: "$1.35M" }, { value: "On track" }] },
      { cells: [{ value: "Users" }, { value: "5,000" }, { value: "4,820" }, { value: "Near target" }] },
      { cells: [{ value: "NPS" }, { value: "42" }, { value: "47" }, { value: "Exceeded" }] },
      { cells: [{ value: "Uptime" }, { value: "99.9%" }, { value: "99.97%" }, { value: "Exceeded" }] },
    ],
  },
  chart: {
    title: "Monthly Active Users",
    chartType: "bar",
    data: JSON.stringify({
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
      datasets: [{ label: "MAU", data: [1200, 1900, 2400, 2200, 2800, 3100] }],
    }),
  },
};

const DARK_TEMPLATES = new Set(["title", "image", "table"]);

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
  const bgColor = DARK_TEMPLATES.has(templateId) ? "#1a1a2e" : "#ffffff";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${templateId} – ${orientation}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: ${bgColor}; }
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
      { name: "landscape", width: 960, height: 540 },
      { name: "portrait", width: 540, height: 960 },
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

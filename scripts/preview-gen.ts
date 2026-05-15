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
  kpi: {
    eyebrow: "Snapshot",
    title: "Cohort 23 · By the numbers",
    items: [
      { label: "Fellows", value: "248", delta: "▲ 32 vs 22", brand: true },
      { label: "Companies", value: "17", delta: "▲ 5 new" },
      { label: "Lessons", value: "94" },
      { label: "Avg NPS", value: "9.2", delta: "▲ +0.4" },
      { label: "Completion", value: "87%", delta: "▲ +6 pp" },
      { label: "Repos shipped", value: "1.4k" },
    ],
  },
  "section-header": {
    chapterNo: "03",
    eyebrow: "Module · Backend foundations",
    title: "Designing for failure",
    description:
      "Distributed systems fail. This chapter walks through the patterns we use at scale — circuit breakers, retries, idempotency keys.",
  },
  steps: {
    eyebrow: "Process",
    title: "Record & publish flow",
    items: [
      { num: "01", title: "Plan", body: "Outline the lesson in our editor with AI assistance.", state: "done" },
      { num: "02", title: "Record", body: "Screen + webcam capture, multi-take support.", state: "active" },
      { num: "03", title: "Edit", body: "Auto-cut silences, generate captions, B-roll." },
      { num: "04", title: "Publish", body: "Ship to fellows + companies with one click." },
    ],
  },
  callout: {
    icon: "!",
    eyebrow: "Key takeaway",
    title: "Templates are CSS, not magic.",
    body: "Every Lesson Studio template ships as a single HTML/CSS file with a documented data contract. Swap themes by swapping one stylesheet.",
  },
};

const DARK_TEMPLATES = new Set([
  "title",
  "image",
  "table",
  "kpi",
  "section-header",
  "steps",
  "callout",
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

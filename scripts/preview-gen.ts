import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import Mustache from "mustache";

const REPO_ROOT = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(REPO_ROOT, "registry.json");

/**
 * Minimal JS/TS highlighter for preview rendering only.
 * Emits HTML with token classes (tok-kw, tok-str, tok-num, tok-com, tok-fn, tok-pun)
 * that the code-block template's CSS knows how to color.
 *
 * NOT a substitute for a real highlighter at runtime — host apps should plug in
 * prism / shiki / highlight.js and pass the result via the `codeHtml` slot.
 */
function highlightJsTs(src: string): string {
  const KEYWORDS = new Set([
    "const", "let", "var", "function", "return", "if", "else", "for", "while",
    "do", "switch", "case", "break", "continue", "new", "class", "extends",
    "import", "from", "export", "default", "async", "await", "try", "catch",
    "finally", "throw", "typeof", "instanceof", "in", "of", "this", "super",
    "true", "false", "null", "undefined", "void", "yield", "static", "get", "set",
    "interface", "type", "enum", "implements", "public", "private", "protected",
    "readonly", "as", "is", "namespace", "declare", "module",
  ]);
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Tokenize via a single combined regex: comments, strings, numbers, identifiers, punctuation, whitespace
  const re =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)|([{}()\[\];,.:=+\-*/<>!?&|^~%]+)|(\s+)/g;

  let out = "";
  let m: RegExpExecArray | null;
  let lastIndex = 0;
  while ((m = re.exec(src)) !== null) {
    if (m.index > lastIndex) {
      out += escapeHtml(src.slice(lastIndex, m.index));
    }
    const [full, com, str, num, ident, pun, ws] = m;
    if (com) out += `<span class="tok-com">${escapeHtml(com)}</span>`;
    else if (str) out += `<span class="tok-str">${escapeHtml(str)}</span>`;
    else if (num) out += `<span class="tok-num">${escapeHtml(num)}</span>`;
    else if (ident) {
      if (KEYWORDS.has(ident)) {
        out += `<span class="tok-kw">${ident}</span>`;
      } else if (src[re.lastIndex] === "(") {
        out += `<span class="tok-fn">${ident}</span>`;
      } else {
        out += escapeHtml(ident);
      }
    } else if (pun) out += `<span class="tok-pun">${escapeHtml(pun)}</span>`;
    else if (ws) out += ws;
    else out += escapeHtml(full);
    lastIndex = re.lastIndex;
  }
  if (lastIndex < src.length) out += escapeHtml(src.slice(lastIndex));
  return out;
}

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
    eyebrow: "NÍVEL · 04",
    title: "Princípios de design",
    number: "04",
    items: [
      { text: "Fundação visual coerente em toda a marca" },
      { text: "Tipografia condensada para títulos com peso" },
      { text: "Acentos vermelhos usados com parcimônia", highlighted: true },
      { text: "Hierarquia clara entre eyebrow, título e corpo" },
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
  "code-block": (() => {
    const code = `// levels.js — escolhendo a forma certa\nconst levels = ['Explorer', 'Builder', 'Architect'];\n\nfunction promote(person, evidence) {\n  if (!evidence.solid) return null;\n  const idx = levels.indexOf(person.level);\n  return levels[idx + 1] ?? person.level;\n}\n\nexport { promote, levels };`;
    return {
      title: "Builder — o salto técnico",
      pageNumber: "05",
      filename: "levels.js",
      language: "javascript",
      code,
      codeHtml: highlightJsTs(code),
      caption:
        "Para o Builder, 'qual é a forma certa' substitui 'como faço'.",
    };
  })(),
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

const DARK_TEMPLATES = new Set(["title", "image", "table", "bullet-list"]);

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

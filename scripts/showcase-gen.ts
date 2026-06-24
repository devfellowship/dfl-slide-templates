/**
 * Showcase generator.
 *
 * Renders EVERY template in the DevFellowship theme into a single
 * self-contained HTML page (one card per template, landscape preview),
 * pulling the same SAMPLE_DATA + per-template CSS the preview generator uses.
 *
 * Output: showcase.html at the repo root (gitignored-friendly; we commit it
 * so GitHub serves it and the plan can link the uploaded copy).
 *
 * Usage: npx ts-node scripts/showcase-gen.ts
 */
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
  name?: string;
  when_to_use?: string;
  media_profile?: string;
  text_density?: string;
  layout?: string;
  tags?: string[];
}
interface Registry {
  templates: RegistryEntry[];
}

function renderOne(id: string): string {
  const dir = path.join(REPO_ROOT, "templates", id);
  const html = fs.readFileSync(path.join(dir, "landscape.html"), "utf8");
  const css = fs.readFileSync(path.join(dir, "landscape.css"), "utf8");
  const data = SAMPLE_DATA[id] ?? {};
  return `<style>${css}</style>${Mustache.render(html, data)}`;
}

function main(): void {
  const registry: Registry = JSON.parse(
    fs.readFileSync(REGISTRY_PATH, "utf8")
  );
  const themeCss = fs.readFileSync(
    path.join(REPO_ROOT, "themes", "devfellowship.css"),
    "utf8"
  );

  const cards = registry.templates
    .map((t) => {
      let body: string;
      try {
        body = renderOne(t.id);
      } catch (e) {
        body = `<div style="padding:40px;color:#e07a7a">missing: ${t.id}</div>`;
      }
      const tags = (t.tags ?? []).map((x) => `<span class="tag">${x}</span>`).join("");
      return `
      <section class="card">
        <header class="card__head">
          <div class="card__id">${t.name ?? t.id} <code>${t.id}</code></div>
          <div class="card__meta">
            <span class="pill pill--cat">${t.category}</span>
            <span class="pill">${t.media_profile ?? ""}</span>
            <span class="pill">density: ${t.text_density ?? ""}</span>
          </div>
        </header>
        <div class="card__stage"><div class="card__scale">${body}</div></div>
        <footer class="card__foot">
          <p class="card__use"><b>When:</b> ${t.when_to_use ?? "—"}</p>
          <div class="tags">${tags}</div>
        </footer>
      </section>`;
    })
    .join("\n");

  const page = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>dfl-slide-templates — showcase (DevFellowship theme)</title>
<style>${themeCss}</style>
<style>
  :root { --bg:#0a0908; --panel:#141210; --ink:#f6f1e7; --muted:#7d7568; --line:#2a2622; --amber:#E07A4A; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font-family:'Inter',system-ui,sans-serif; }
  .page-head { padding:56px 48px 24px; max-width:1400px; margin:0 auto; }
  .page-head h1 { font-family:'Barlow Condensed',sans-serif; font-size:48px;
    margin:0 0 8px; letter-spacing:-0.5px; }
  .page-head p { color:var(--muted); margin:0; font-size:16px; max-width:720px; }
  .page-head .count { color:var(--amber); font-weight:600; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(440px,1fr));
    gap:28px; padding:24px 48px 80px; max-width:1400px; margin:0 auto; }
  .card { background:var(--panel); border:1px solid var(--line);
    border-radius:14px; overflow:hidden; display:flex; flex-direction:column; }
  .card__head { padding:16px 18px; border-bottom:1px solid var(--line);
    display:flex; flex-direction:column; gap:8px; }
  .card__id { font-family:'Barlow Condensed',sans-serif; font-size:22px; }
  .card__id code { font-family:'JetBrains Mono',monospace; font-size:12px;
    color:var(--muted); background:#0a0908; padding:2px 7px; border-radius:6px;
    margin-left:6px; }
  .card__meta { display:flex; gap:6px; flex-wrap:wrap; }
  .pill { font-family:'JetBrains Mono',monospace; font-size:10px;
    text-transform:uppercase; letter-spacing:0.6px; color:var(--muted);
    border:1px solid var(--line); padding:2px 8px; border-radius:999px; }
  .pill--cat { color:var(--amber); border-color:var(--amber); }
  .card__stage { background:#0a0908; display:flex; align-items:center;
    justify-content:center; height:270px; overflow:hidden; }
  .card__scale { transform:scale(0.5); transform-origin:center; }
  .card__foot { padding:14px 18px; border-top:1px solid var(--line); }
  .card__use { margin:0 0 10px; font-size:13px; line-height:1.5; color:#c9c0b4; }
  .card__use b { color:var(--ink); }
  .tags { display:flex; gap:6px; flex-wrap:wrap; }
  .tag { font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--muted);
    background:#0a0908; padding:2px 7px; border-radius:6px; }
</style></head>
<body>
  <div class="page-head">
    <h1>dfl-slide-templates</h1>
    <p><span class="count">${registry.templates.length} templates</span> · DevFellowship theme · minimalist + image-forward. Each card shows the landscape render plus the discoverability metadata an authoring LLM uses to pick it.</p>
  </div>
  <div class="grid">
${cards}
  </div>
</body></html>`;

  const out = path.join(REPO_ROOT, "showcase.html");
  fs.writeFileSync(out, page, "utf8");
  console.log(`Wrote ${out} (${registry.templates.length} templates).`);
}

main();

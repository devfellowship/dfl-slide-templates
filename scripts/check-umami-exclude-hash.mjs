// Fails when an Umami script tag in the studio build does not drop the URL hash.
// Why: the studio sign-in (GitHub OAuth, supabase-js implicit flow) returns the
// session in the URL hash (#access_token=...). Umami records location.hash by
// default, so a token can land in analytics. Plan 20261028-campaigns-paginas-seo, G7.
// Dependency-free on purpose.
import { readFileSync } from 'node:fs';

const FILES = ['studio/vite.config.ts', 'studio/index.html'];
let tags = 0;
const bad = [];
for (const f of FILES) {
  const src = readFileSync(f, 'utf8');
  if (!/data-website-id/.test(src)) continue;
  tags += 1;
  if (!/data-exclude-hash/.test(src)) bad.push(f);
}
if (tags === 0) {
  console.error('check-umami-exclude-hash: no Umami tag found in', FILES.join(', '), '(update this check if the tag moved)');
  process.exit(1);
}
if (bad.length) {
  console.error('check-umami-exclude-hash: Umami tag without data-exclude-hash in', bad.join(', '));
  process.exit(1);
}
console.log(`check-umami-exclude-hash: ok (${tags} file(s))`);

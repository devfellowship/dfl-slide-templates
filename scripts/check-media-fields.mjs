/**
 * check-media-fields.mjs: every field that holds an image or a video URL must
 * say so in `config.yaml`, so the editor can give it the Camera / Photo library
 * picker. A new layout cannot miss the picker: this check fails first.
 *
 *   items slot whose sample entries carry a url/src/image/video field
 *     -> `mediaField: <that field>`
 *   text slot named like a url/src (videoUrl, posterSrc ...)
 *     -> `media: image | video`
 *   `image` slots are media by type and need no flag.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const MEDIA_FIELD = /(^|[a-z])(url|src)$|image|video|photo|logo|poster/i;
const NOT_MEDIA = /alt$|^urlbar$/i;
const TEXT_MEDIA = /(url|src)$/i;

const root = 'templates';
const errors = [];
for (const dir of readdirSync(root)) {
  const file = join(root, dir, 'config.yaml');
  if (!existsSync(file)) continue;
  const config = yaml.load(readFileSync(file, 'utf8'));
  for (const slot of config.slots ?? []) {
    if (slot.type === 'items') {
      const keys = new Set();
      for (const entry of Array.isArray(slot.sample) ? slot.sample : []) {
        if (entry && typeof entry === 'object') Object.keys(entry).forEach((k) => keys.add(k));
      }
      const media = [...keys].filter((k) => MEDIA_FIELD.test(k) && !NOT_MEDIA.test(k));
      if (media.length > 0 && !slot.mediaField) {
        errors.push(`${dir}: items slot "${slot.name}" has media field(s) ${media.join(', ')} and no \`mediaField\``);
      } else if (slot.mediaField && !keys.has(slot.mediaField)) {
        errors.push(`${dir}: items slot "${slot.name}" names mediaField "${slot.mediaField}" that its sample does not declare`);
      }
    } else if (slot.type === 'text' && TEXT_MEDIA.test(slot.name) && !NOT_MEDIA.test(slot.name)) {
      if (slot.media !== 'image' && slot.media !== 'video') {
        errors.push(`${dir}: text slot "${slot.name}" looks like a media url and has no \`media: image|video\``);
      }
    }
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('media fields OK');

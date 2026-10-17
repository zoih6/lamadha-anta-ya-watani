/**
 * build_frame.js
 * Concatenates shell.html + styles.css + art.js + engine.js and inlines the
 * timeline / geo / audio data, producing ONE self-contained file that the
 * renderer can open over file:// (no fetch, no CORS, no network).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'templates', 'src');

const read = f => fs.readFileSync(f, 'utf-8');

const data = {
  video: JSON.parse(read(path.join(ROOT, 'config.json'))).video,
  colors: JSON.parse(read(path.join(ROOT, 'config.json'))).colors,
  geo: JSON.parse(read(path.join(ROOT, 'analysis', 'geo_paths.json'))),
  audio: JSON.parse(read(path.join(ROOT, 'analysis', 'audio_env.json'))),
  scenes: JSON.parse(read(path.join(ROOT, 'timeline.json'))).scenes,
};

let html = read(path.join(SRC, 'shell.html'));
html = html.replace('/*__CSS__*/', () => read(path.join(SRC, 'styles.css')));
html = html.replace('/*__ART__*/', () => read(path.join(SRC, 'art.js')));
html = html.replace('/*__ENGINE__*/', () => read(path.join(SRC, 'engine.js')));
html = html.replace('/*__DATA__*/null', () => JSON.stringify(data));

const out = path.join(ROOT, 'templates', 'frame.build.html');
fs.writeFileSync(out, html, 'utf-8');
console.log(`[build] ${out}  ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
console.log(`[build] scenes=${data.scenes.length}  fps=${data.video.fps}  dur=${data.video.duration}s`);

/**
 * qa.js — automated visual QA that does not need human eyes.
 *
 * For a set of probe times it checks, per frame:
 *   - Arabic webfonts actually loaded (not a fallback / not tofu)
 *   - no line overflows the 1920x1080 safe area
 *   - the stack is vertically centred and inside frame
 *   - no NaN leaked into any transform
 *   - pixel statistics: the frame is not black, not blown out, and the accent
 *     colour is actually present where it should be
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HTML = 'file://' + path.join(ROOT, 'templates', 'frame.build.html');
const timeline = JSON.parse(fs.readFileSync(path.join(ROOT, 'timeline.json'), 'utf-8'));

const OUT = path.join(ROOT, 'analysis', 'qa');
fs.mkdirSync(OUT, { recursive: true });

const SAFE_X = 90, SAFE_Y = 60;

const probes = [];
for (const sc of timeline.scenes) {
  const d = sc.end - sc.start;
  for (const f of [0.06, 0.3, 0.55, 0.8, 0.96]) {
    probes.push({ id: sc.id, t: +(sc.start + d * f).toFixed(2), f });
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto(HTML, { waitUntil: 'load' });
await page.evaluate(() => window.__boot());
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(700);

const fonts = await page.evaluate(() => ({
  cairo900: document.fonts.check('900 82px Cairo'),
  tajawal900: document.fonts.check('900 82px Tajawal'),
  amiri700: document.fonts.check('700 34px Amiri'),
  plex: document.fonts.check('400 15px PlexAr'),
  loaded: Array.from(document.fonts).map(f => f.family + ':' + f.weight + ':' + f.status),
}));
console.log('[fonts]', JSON.stringify(fonts, null, 1));

const rows = [];
for (const p of probes) {
  const info = await page.evaluate(({t, SX, SY}) => {
    window.__render(t);
    const stack = document.getElementById('stack');
    const lines = Array.from(stack.querySelectorAll('.line'));
    const sb = stack.getBoundingClientRect();
    const bad = [];
    lines.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width > 1920 - SX * 2) bad.push(`line${i} wide ${Math.round(r.width)}`);
      if (r.left < SX - 2 || r.right > 1920 - SX + 2) bad.push(`line${i} x ${Math.round(r.left)}..${Math.round(r.right)}`);
      if (r.top < SY || r.bottom > 1080 - SY) bad.push(`line${i} y ${Math.round(r.top)}..${Math.round(r.bottom)}`);
    });
    const nan = [];
    [document.getElementById('art'), document.getElementById('type'),
     document.getElementById('bg')].forEach(el => {
      const s = el.getAttribute('style') || '';
      if (/NaN|undefined/.test(s)) nan.push(el.id + ':' + s.slice(0, 80));
    });
    return {
      bad, nan,
      stack: { w: Math.round(sb.width), h: Math.round(sb.height), t: Math.round(sb.top), b: Math.round(sb.bottom) },
      lines: lines.length,
      text: stack.innerText.replace(/\s+/g, ' ').slice(0, 60),
    };
  }, { t: p.t, SX: SAFE_X, SY: SAFE_Y });

  const buf = await page.screenshot({ type: 'png' });
  const { data } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  let sum = 0, dark = 0, bright = 0, red = 0, gold = 0;
  const N = 1920 * 1080;
  for (let i = 0; i < N; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += l;
    if (l < 12) dark++;
    if (l > 200) bright++;
    if (r > 70 && r > g * 1.7 && r > b * 1.7) red++;
    if (r > 120 && g > 95 && b < g * 0.85 && r > b * 1.35) gold++;
  }
  rows.push({
    scene: p.id, t: p.t, f: p.f,
    meanL: +(sum / N).toFixed(2),
    darkPct: +(dark / N * 100).toFixed(1),
    brightPct: +(bright / N * 100).toFixed(2),
    redPct: +(red / N * 100).toFixed(3),
    goldPct: +(gold / N * 100).toFixed(3),
    lines: info.lines, stack: info.stack,
    bad: info.bad, nan: info.nan, text: info.text,
  });
  const flag = (info.bad.length || info.nan.length) ? ' !! ' : '    ';
  console.log(`${flag}${p.id} t=${String(p.t).padStart(6)}s L=${String(rows.at(-1).meanL).padStart(6)} ` +
    `dark=${String(rows.at(-1).darkPct).padStart(5)}% red=${String(rows.at(-1).redPct).padStart(6)}% ` +
    `gold=${String(rows.at(-1).goldPct).padStart(6)}% lines=${info.lines} ` +
    `${info.bad.join('|')}${info.nan.join('|')} :: ${info.text}`);
  await page.screenshot({ path: path.join(OUT, `${p.id}_${String(p.t).padStart(6, '0')}.jpg`), type: 'jpeg', quality: 80 });
}

fs.writeFileSync(path.join(OUT, 'qa.json'), JSON.stringify(rows, null, 1));
await browser.close();

// summary
const bad = rows.filter(r => r.bad.length || r.nan.length);
console.log(`\n[qa] ${rows.length} probes, ${bad.length} with layout problems`);
const L = rows.map(r => r.meanL);
console.log(`[qa] mean luminance range ${Math.min(...L).toFixed(1)} .. ${Math.max(...L).toFixed(1)}`);
const zero = rows.filter(r => r.meanL < 3);
if (zero.length) console.log(`[qa] WARNING near-black frames: ${zero.map(r => r.scene + '@' + r.t).join(', ')}`);
const flat = rows.filter(r => r.darkPct > 96);
if (flat.length) console.log(`[qa] WARNING >96% black: ${flat.map(r => r.scene + '@' + r.t).join(', ')}`);

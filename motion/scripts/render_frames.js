/**
 * render_frames.js — frame-by-frame render through headless Chromium.
 *
 * Every frame is `window.__render(t)` + a screenshot. Because the renderer is a
 * pure function of absolute time, frames can be rendered in any order, in
 * parallel across pages, or re-rendered on their own — which is what keeps a
 * 2900-frame job on 2 CPU cores survivable.
 *
 * Frames are written outside the workspace (/var/tmp) so they never count
 * against the 128 MB workspace budget.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const arg = (k, d) => {
  const a = process.argv.find(x => x.startsWith(`--${k}=`));
  return a ? a.split('=')[1] : d;
};
const flag = k => process.argv.includes(`--${k}`);

const FPS = 25;
const OUTDIR = arg('out', '/var/tmp/voxframes');
const ONLY = arg('scene', null);
const SHOTS = arg('shots', null);          // "12.0,18.5,44" -> single frames
const WORKERS = parseInt(arg('workers', '2'), 10);
const QUALITY = parseInt(arg('q', '92'), 10);

const timeline = JSON.parse(fs.readFileSync(path.join(ROOT, 'timeline.json'), 'utf-8'));
const HTML = 'file://' + path.join(ROOT, 'templates', 'frame.build.html');
// Length comes from the timeline, not from the audio: the end card runs past
// the last bar of the song, so hardcoding the audio duration would truncate it.
const DUR = Math.max(...timeline.scenes.map(s => s.end));

function buildJob() {
  if (SHOTS) {
    return SHOTS.split(',').map(s => ({ t: parseFloat(s), i: -1 }));
  }
  const jobs = [];
  const total = Math.round(DUR * FPS);
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    const sc = timeline.scenes.find(s => t >= s.start && t < s.end);
    if (ONLY && sc && sc.id !== ONLY) continue;
    if (ONLY === 'none') continue;
    jobs.push({ t, i });
  }
  return jobs;
}

async function makePage(browser) {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  });
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  await page.goto(HTML, { waitUntil: 'load' });
  await page.evaluate(() => window.__boot());
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  return page;
}

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const jobs = buildJob();
  console.log(`[render] ${jobs.length} frames -> ${OUTDIR}  workers=${WORKERS}`);

  const browser = await chromium.launch({
    args: ['--force-color-profile=srgb', '--font-render-hinting=none',
           '--disable-lcd-text', '--hide-scrollbars'],
  });

  const pages = [];
  for (let w = 0; w < WORKERS; w++) pages.push(await makePage(browser));

  let done = 0;
  const t0 = Date.now();

  async function doJob(worker, job) {
    const idx = job.i >= 0 ? job.i : Math.round(job.t * FPS);
    const file = path.join(OUTDIR, `frame_${String(idx).padStart(5, '0')}.jpg`);
    await pages[worker].evaluate(t => window.__render(t), job.t);
    await pages[worker].screenshot({ path: file, type: 'jpeg', quality: QUALITY });
    done++;
    if (done % 50 === 0 || done === jobs.length) {
      const el = (Date.now() - t0) / 1000;
      const per = el / done;
      const eta = per * (jobs.length - done);
      console.log(`  ${done}/${jobs.length}  ${(done / jobs.length * 100).toFixed(1)}%  ` +
        `${per.toFixed(3)}s/frame  eta ${(eta / 60).toFixed(1)}min`);
    }
  }

  // round-robin across workers
  const queues = Array.from({ length: WORKERS }, () => []);
  jobs.forEach((j, i) => queues[i % WORKERS].push(j));
  await Promise.all(queues.map(async (q, w) => {
    for (const j of q) await doJob(w, j);
  }));

  await browser.close();
  const el = (Date.now() - t0) / 1000;
  console.log(`[render] done ${jobs.length} frames in ${(el / 60).toFixed(1)} min ` +
    `(${(el / jobs.length).toFixed(3)} s/frame)`);
}

main().catch(e => { console.error(e); process.exit(1); });

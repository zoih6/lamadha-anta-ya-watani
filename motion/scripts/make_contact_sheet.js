/**
 * make_contact_sheet.js
 * Builds a self-contained HTML storyboard from the rendered frames: every
 * image is embedded as a base64 data-URI so the page works offline inside a
 * sandboxed iframe (no external CSS, no external images).
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FRAMES = process.env.FRAMES || '/var/tmp/voxframes';
const FPS = 25;
const OUT = path.join(ROOT, 'storyboard.html');

const timeline = JSON.parse(fs.readFileSync(path.join(ROOT, 'timeline.json'), 'utf-8'));
const PER_SCENE = 3;

const tc = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function thumb(file, w = 420) {
  const buf = await sharp(path.join(FRAMES, file))
    .resize({ width: w }).jpeg({ quality: 74 }).toBuffer();
  return 'data:image/jpeg;base64,' + buf.toString('base64');
}

const cards = [];
for (const sc of timeline.scenes) {
  const picks = [0.12, 0.5, 0.88].slice(0, PER_SCENE);
  for (const f of picks) {
    const t = sc.start + (sc.end - sc.start) * f;
    const i = Math.min(Math.round(t * FPS), Math.round(116.208 * FPS) - 1);
    const file = `frame_${String(i).padStart(5, '0')}.jpg`;
    const p = path.join(FRAMES, file);
    if (!fs.existsSync(p)) continue;
    cards.push({ id: sc.id, t, art: sc.art, bg: sc.bg, uri: await thumb(file) });
  }
}

const scenes = timeline.scenes.map(sc => {
  const cs = cards.filter(c => c.id === sc.id);
  const lines = sc.lines.map(l => l.text).join(' · ');
  return `
  <section class="scene" id="${sc.id}">
    <header>
      <span class="num">${sc.id.toUpperCase()}</span>
      <h2>${sc.art}</h2>
      <span class="tc">${tc(sc.start)} → ${tc(sc.end)} &nbsp;(${sc.end - sc.start > 0 ? (sc.end - sc.start).toFixed(1) : 0}s)</span>
    </header>
    <div class="grid">
      ${cs.map(c => `
        <figure>
          <img src="${c.uri}" alt="${sc.id} ${c.t}">
          <figcaption>${tc(c.t)}</figcaption>
        </figure>`).join('')}
    </div>
    <p class="lyric">${lines || '<em>مقطع موسيقي — بلا كلام</em>'}</p>
  </section>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ستوري بورد — لِمَاذَا أَنْتَ..!!؟؟</title>
<style>
  :root{ --bg:#0B0B0D; --paper:#E8DDCB; --accent:#8B1A1A; --gold:#C9A86A; }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--paper);
       font-family:"Segoe UI",Tahoma,"Noto Naskh Arabic",serif;padding:48px 32px;line-height:1.8}
  .wrap{max-width:1240px;margin:0 auto}
  h1{font-size:44px;letter-spacing:1px;margin-bottom:6px}
  .sub{color:var(--gold);letter-spacing:5px;font-size:16px;margin-bottom:8px}
  .meta{opacity:.45;font-size:13px;letter-spacing:2px;margin-bottom:44px}
  .scene{border-top:1px solid rgba(232,221,203,.14);padding:34px 0 40px}
  .scene header{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;margin-bottom:18px}
  .num{font-family:monospace;border:1px solid rgba(232,221,203,.3);padding:3px 9px;
       font-size:12px;letter-spacing:2px;color:var(--gold)}
  .scene h2{font-size:22px;letter-spacing:1px}
  .tc{font-family:monospace;font-size:13px;opacity:.55;margin-inline-start:auto}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  figure{position:relative;background:#000;border:1px solid rgba(232,221,203,.13)}
  figure img{display:block;width:100%;height:auto}
  figcaption{position:absolute;bottom:0;right:0;background:rgba(11,11,13,.85);
    font-family:monospace;font-size:12px;padding:3px 9px;color:var(--gold)}
  .lyric{margin-top:16px;font-size:19px;opacity:.9;letter-spacing:.4px}
  .lyric em{opacity:.45;font-style:normal}
  footer{margin-top:56px;border-top:1px solid rgba(232,221,203,.14);padding-top:22px;
    font-size:13px;opacity:.5;letter-spacing:2px}
  @media(max-width:820px){.grid{grid-template-columns:1fr}}
</style></head>
<body><div class="wrap">
  <h1>لِمَاذَا أَنْتَ..!!؟؟</h1>
  <div class="sub">قصيدة: راجح المحمدي</div>
  <div class="meta">ستوري بورد مُصيَّر من الإطارات النهائية — ١٩٢٠×١٠٨٠ · ٢٥ إطار/ث · ١:٥٦ · ${cards.length} لقطة</div>
  ${scenes}
  <footer>محرّك VOX — كل إطار دالّة نقية للزمن · التوقيتات مقيسة من الملف الصوتي لا من المخطط</footer>
</div></body></html>`;

fs.writeFileSync(OUT, html, 'utf-8');
console.log(`[sheet] ${OUT}  ${(fs.statSync(OUT).size / 1048576).toFixed(2)} MB  ${cards.length} thumbnails`);

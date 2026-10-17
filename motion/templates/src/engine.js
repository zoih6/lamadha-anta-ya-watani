/* ===========================================================================
   engine.js — the frame clock.
   window.__render(t) draws the film at absolute time `t` (seconds).
   Pure function of t: identical input produces identical pixels, which is what
   makes frame-by-frame rendering safe.
   =========================================================================== */

const EL = {};
let sceneIdx = -1;
let wordEls = [];
let wordData = [];
let MAP = {};

/* ------------------------------------------------------------------ boot */
function boot() {
  EL.bgwrap = document.getElementById('bgwrap');
  EL.bg = document.getElementById('bg');
  EL.tint = document.getElementById('bgtint');
  EL.art = document.getElementById('art');
  EL.type = document.getElementById('type');
  EL.grain = document.getElementById('grain');
  EL.flash = document.getElementById('flash');
  EL.hdr = document.getElementById('hdr');
  EL.ftr = document.getElementById('ftr');
  EL.tc = document.getElementById('tc');
  EL.stack = document.getElementById('stack');
  EL.logolayer = document.getElementById('logolayer');
  EL.logo = document.getElementById('logoimg');
  if (DATA.logo) {
    const H = 400, Wd = H * DATA.logo.aspect;
    MAP.logoBox = { x: 960 - Wd / 2, y: 430 - H / 2, w: Wd, h: H };
    const B = MAP.logoBox;
    EL.logo.style.left = B.x + 'px'; EL.logo.style.top = B.y + 'px';
    EL.logo.style.width = B.w + 'px'; EL.logo.style.height = B.h + 'px';
  }

  /* Force every Arabic face to load NOW. font-display:block means Chromium
     will not fetch a face until something needs it — which would make the very
     first frame of each scene render in a fallback face. */
  const FONTS = ['900 82px Cairo', '700 82px Cairo', '400 30px Cairo',
                 '900 82px Tajawal', '700 34px Amiri', '400 15px PlexAr',
                 '600 15px PlexAr', '700 15px PlexAr'];
  for (const f of FONTS) { try { document.fonts.load(f); } catch (e) { } }

  EL.grain.style.backgroundImage = `url('../assets/tex/grain.png')`;
  document.getElementById('papertex').style.backgroundImage = `url('../assets/tex/paper.png')`;
  document.getElementById('fibres').style.backgroundImage = `url('../assets/tex/fibres.png')`;

  /* pre-sample the homeland outline once — never re-measure per frame */
  const g = DATA.geo;
  const bb = g.countries.yemen.bbox;
  const bw = bb[2] - bb[0], bh = bb[3] - bb[1];

  function fit(targetH, cyOff, cxOff) {
    const s = targetH / bh;
    return `translate(${960 + (cxOff || 0) - (bb[0] + bw / 2) * s},${540 + (cyOff || 0) - (bb[1] + bh / 2) * s}) scale(${s})`;
  }
  MAP.t1 = fit(560, 0, 0);
  MAP.t2 = fit(300, 0, 0);
  MAP.t3 = fit(420, 0, 0);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '10'); svg.setAttribute('height', '10');
  svg.style.position = 'absolute'; svg.style.opacity = '0';
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', g.countries.yemen.paths[0]);
  svg.appendChild(p); document.body.appendChild(svg);
  const L = p.getTotalLength();
  const N = 260;
  MAP.pts = [];
  const bb2 = bb;
  const sx = 560 / bh;
  const ox = 960 - (bb2[0] + bw / 2) * sx, oy = 540 - (bb2[1] + bh / 2) * sx;
  for (let i = 0; i < N; i++) {
    const pt = p.getPointAtLength((i / N) * L);
    MAP.pts.push({
      x: ox + pt.x * sx,
      y: oy + pt.y * sx,
      ny: (pt.y - bb2[1]) / bh,          // 0 = top of the homeland
    });
  }
  svg.remove();
}

/* -------------------------------------------------------------- typography */
function buildScene(scene) {
  sceneIdx = scene.__i;
  EL.bg.style.backgroundImage = scene.bg ? `url('../assets/${scene.bg}')` : 'none';
  EL.bg.style.filter = scene.bgFilter || 'contrast(1.06) saturate(.62)';
  EL.bg.style.opacity = scene.bgOpacity != null ? scene.bgOpacity : .42;

  wordEls = []; wordData = [];
  let html = '';
  scene.lines.forEach((ln, li) => {
    const cls = ['line', ln.style || ''].join(' ');
    html += `<div class="${cls}" data-li="${li}">`;
    ln.words.forEach((w, wi) => {
      const k = w.k ? ' kw' : '';
      html += `<span class="w${k}" data-w="${wordData.length}">${w.t}</span>`;
      if (wi < ln.words.length - 1) html += `<span class="w"> </span>`;
      wordData.push(Object.assign({}, w, { li }));
    });
    html += `</div>`;
  });
  if (scene.sub) html += `<div class="sub" id="sub">${scene.sub}</div>`;
  if (scene.meta) html += `<div class="meta" id="meta">${scene.meta}</div>`;
  EL.stack.innerHTML = html;

  EL.stack.style.gap = (scene.lineGap != null ? scene.lineGap : 6) + 'px';
  wordEls = Array.prototype.slice.call(EL.stack.querySelectorAll('.w[data-w]'));

  // base typographic scale per scene
  const L = EL.stack.querySelectorAll('.line');
  for (let i = 0; i < L.length; i++) {
    const ln = scene.lines[i];
    L[i].style.fontSize = (ln.size || scene.size || 82) + 'px';
    L[i].style.lineHeight = ln.lh || scene.lh || 1.42;
    if (ln.opacityBase != null) L[i].style.opacity = ln.opacityBase;
  }
  const sub = document.getElementById('sub');
  if (sub) sub.style.fontSize = (scene.subSize || 34) + 'px';
  const meta = document.getElementById('meta');
  if (meta) meta.style.fontSize = (scene.metaSize || 16) + 'px';
}

const IN = 0.20, OUT = 0.42;

function paintType(scene, t, p) {
  const stack = EL.stack;
  const tL = t - scene.start;          // scene-local clock, for untimed reveals
  // word-level kinetics
  for (let i = 0; i < wordData.length; i++) {
    const w = wordData[i], el = wordEls[i];
    if (!el) continue;
    let op, sc, ty, extra = '';
    if (w.s == null || w.s < 0) {
      /* untimed (instrumental) text: reveal on a fixed schedule */
      const k = scene.lines[w.li].words.filter(x => x.s == null || x.s < 0).indexOf(w);
      const base = scene.lines[w.li].revealAt || 0;
      const st = base + k * 0.22;
      const a = inv(st, st + IN, tL);
      op = a; sc = lerp(.90, 1, easeBack(a)); ty = lerp(26, 0, easeOut(a));
    } else {
      const a = inv(w.s, w.s + IN, t);
      const b = inv(w.e + .10, w.e + .10 + OUT, t);
      op = a * (1 - b * (w.k ? 0 : .55));
      const act = clamp(1 - Math.abs((t - (w.s + (w.e - w.s) * .5)) / ((w.e - w.s) * .5 + .22)), 0, 1);
      const breathe = w.k ? 1 + .045 * act + .02 * Math.sin(t * 3.1) : 1 + .022 * act;
      sc = lerp(.88, 1, easeBack(a)) * breathe;
      ty = lerp(24, 0, easeOut(a));
      if (w.k) extra = `text-shadow:0 0 ${(30 + 26 * act).toFixed(0)}px rgba(139,26,26,${(.35 + .45 * act).toFixed(2)}),0 6px 40px rgba(0,0,0,.9)`;
    }
    el.style.opacity = op.toFixed(3);
    el.style.transform = `translateY(${ty.toFixed(2)}px) scale(${sc.toFixed(4)})`;
    if (extra) el.style.textShadow = extra;
  }
  const sub = document.getElementById('sub');
  if (sub) {
    const a = inv(scene.subAt || .5, (scene.subAt || .5) + .5, p);
    sub.style.opacity = (a * .92).toFixed(3);
    sub.style.transform = `translateY(${lerp(14, 0, easeOut(a)).toFixed(1)}px)`;
  }
  const meta = document.getElementById('meta');
  if (meta) meta.style.opacity = (inv(scene.metaAt || .7, (scene.metaAt || .7) + .4, p) * .45).toFixed(3);
}

/* ------------------------------------------------------------------- camera */
function camera(scene, t, p, energy) {
  let tr = '', bgTr = '', artTr = '';
  const e = energy || 0;
  switch (scene.cam) {
    case 'zoomIn': {
      const s = 1 + p * .12;
      bgTr = `scale(${(1 + p * .16).toFixed(4)})`;
      artTr = `scale(${s.toFixed(4)})`;
      tr = `scale(${s.toFixed(4)})`;
      break;
    }
    case 'panRight': {
      const x = lerp(-52, 52, easeIO(p));
      bgTr = `translateX(${(x * 1.35).toFixed(2)}px) scale(1.06)`;
      artTr = `translateX(${(x * .5).toFixed(2)}px)`;
      tr = `translateX(${x.toFixed(2)}px)`;
      break;
    }
    case 'beat': {
      const bps = 72 / 60, ph = (t * bps) % 1;
      const env = Math.exp(-ph * 15) + .58 * Math.exp(-Math.max(0, ph - .21) * 13);
      const s = 1 + env * .030;
      bgTr = `scale(${(1 + env * .012).toFixed(4)}) translateY(${(-env * 3).toFixed(2)}px)`;
      artTr = `scale(${s.toFixed(4)})`;
      tr = `scale(${s.toFixed(4)})`;
      break;
    }
    case 'morph': {
      const s = 1 + easeIO(p) * .10;
      bgTr = `scale(${(1 + p * .13).toFixed(4)})`;
      artTr = `scale(${s.toFixed(4)}) rotate(${((1 - p) * 1.1).toFixed(3)}deg)`;
      tr = `scale(${s.toFixed(4)})`;
      break;
    }
    case 'shake': {
      const s = 1 + p * .10;
      const amp = 5.5 * (scene.shakeGain || 1);
      const x = Math.sin(t * 26.3) * amp * (.4 + .6 * e) + vnoise(t * 9, 3) * amp * .5;
      const y = Math.cos(t * 21.7) * amp * .8 * (.4 + .6 * e);
      bgTr = `scale(${(1 + p * .18).toFixed(4)}) translate(${x.toFixed(2)}px,${y.toFixed(2)}px)`;
      artTr = `scale(${s.toFixed(4)}) translate(${(x * .6).toFixed(2)}px,${(y * .6).toFixed(2)}px)`;
      tr = `scale(${s.toFixed(4)}) translate(${(x * .35).toFixed(2)}px,${(y * .35).toFixed(2)}px)`;
      break;
    }
    case 'split': {
      const s = 1 + p * .05;
      bgTr = `scale(${(1 + p * .09).toFixed(4)})`;
      artTr = `scale(${s.toFixed(4)})`;
      tr = `scale(${s.toFixed(4)})`;
      break;
    }
    case 'orbit': {
      const s = 1 + easeIO(p) * .16;
      const dx = Math.sin(p * Math.PI * 2) * 34;
      bgTr = `scale(${(1 + p * .14).toFixed(4)}) translateX(${(dx * .5).toFixed(2)}px)`;
      artTr = `scale(${s.toFixed(4)}) translateX(${dx.toFixed(2)}px)`;
      tr = `scale(${s.toFixed(4)}) translateX(${(dx * .3).toFixed(2)}px)`;
      break;
    }
    case 'drift': {
      const s = 1 + p * .05;
      bgTr = `scale(${(1 + p * .10).toFixed(4)}) translateY(${(p * -22).toFixed(2)}px)`;
      artTr = `scale(${s.toFixed(4)})`;
      tr = `scale(${s.toFixed(4)})`;
      break;
    }
    default: tr = artTr = 'none'; bgTr = 'scale(1.02)';
  }
  if (scene.typeShiftY) tr += ` translateY(${scene.typeShiftY}px)`;
  EL.bg.style.transform = bgTr;
  EL.art.style.transform = artTr;
  EL.type.style.transform = tr;
  if (EL.logolayer) EL.logolayer.style.transform = artTr;
}

/* ------------------------------------------------------------------ end card */
function paintLogo(scene, t, p) {
  if (!EL.logo) return;
  if (scene.art !== 'logo') { EL.logo.style.opacity = 0; return; }
  // the particles hand over to the real PNG as they land
  const op = inv(.26, .46, p);
  const s = lerp(1.05, 1, easeOut(inv(.26, .74, p))) * (1 + .008 * Math.sin(t * 1.5));
  EL.logo.style.opacity = op.toFixed(3);
  EL.logo.style.transform = `scale(${s.toFixed(4)})`;
}

/* ------------------------------------------------------------------ overlays */
function paintChrome(scene, t, p, energy) {
  // animated grain: pan a static tile (cheap) and jitter it
  const gx = (hsh(Math.floor(t * 12)) * 320) | 0;
  const gy = (hsh(Math.floor(t * 12) + 7) * 320) | 0;
  EL.grain.style.transform = `translate(${-gx}px,${-gy}px)`;
  EL.grain.style.opacity = (.55 + .35 * (energy || 0)).toFixed(3);

  // vignette tightens on the heavy scenes
  document.getElementById('vig').style.opacity =
    (scene.vig != null ? scene.vig : 1) * (1 + .12 * (energy || 0)) > 1 ? 1 : 1;

  // timecode + VOX header
  const mm = Math.floor(t / 60), ss = Math.floor(t % 60), ff = Math.floor((t % 1) * 25);
  EL.tc.textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;

  // bottom spectrum strip, driven by the real signal
  const N = 64, rms = DATA.audio.rms, hop = DATA.audio.hopSec;
  const idx = Math.floor(t / hop);
  let bars = '';
  for (let i = 0; i < N; i++) {
    const k = idx - (N - i) * 3;
    const v = (k >= 0 && k < rms.length) ? rms[k] : 0;
    bars += `<i style="height:${(3 + v * 22).toFixed(1)}px;opacity:${(.25 + v * .75).toFixed(2)}"></i>`;
  }
  EL.ftr.innerHTML = bars;

  // scene-to-scene cross fade (dip to charcoal, never a preset wipe)
  const edge = Math.min(inv(0, scene.__in, t - scene.start), inv(0, scene.__out, scene.end - t));
  EL.flash.style.opacity = (1 - edge).toFixed(3);
}

/* -------------------------------------------------------------------- main */
function findScene(t) {
  const S = DATA.scenes;
  for (let i = 0; i < S.length; i++) if (t >= S[i].start && t < S[i].end) return S[i];
  return S[S.length - 1];
}

window.__render = function (t) {
  const scene = findScene(t);
  if (scene.__i !== sceneIdx) buildScene(scene);
  const p = clamp((t - scene.start) / (scene.end - scene.start), 0, 1);

  // live audio energy, straight from the waveform
  const rms = DATA.audio.rms, hop = DATA.audio.hopSec;
  const k = clamp(Math.floor(t / hop), 0, rms.length - 1);
  const energy = rms[k] || 0;

  const S = {
    scene, t, p, abs: t,
    mapT: MAP.t1, mapT2: MAP.t2, mapT3: MAP.t3, mapPts: MAP.pts,
    logoBox: MAP.logoBox,
    energy,
  };

  camera(scene, t, p, energy);
  const fn = ART[scene.art] || ART.title;
  EL.art.innerHTML = fn(S);
  paintLogo(scene, t, p);
  paintType(scene, t, p);
  paintChrome(scene, t, p, energy);
};

window.__boot = function () { boot(); DATA.scenes.forEach((s, i) => { s.__i = i; }); };

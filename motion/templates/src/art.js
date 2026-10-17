/* ===========================================================================
   art.js — procedural vector art for every scene.
   Every function is a pure function of time (no Math.random at draw time) so
   that re-rendering frame N always produces exactly the same pixels.
   No SVG filters in the hot path: they force a full re-rasterisation per frame.
   =========================================================================== */

const TAU = Math.PI * 2;
const W = 1920, H = 1080;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const inv = (a, b, v) => clamp((v - a) / (b - a || 1e-6), 0, 1);
const easeIO = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t * t;
const easeBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const smooth = t => t * t * (3 - 2 * t);
const hsh = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const n2 = (a, b) => (a * 374761393 + b * 668265263) ^ 0;
const f1 = v => Math.round(v * 10) / 10;

/* deterministic 1-D value noise */
function vnoise(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const a = hsh(i + seed * 71.3), b = hsh(i + 1 + seed * 71.3);
  return lerp(a, b, smooth(f));
}

/* ------------------------------------------------------------ shared pieces */

const C = {
  bg: '#0B0B0D', paper: '#E8DDCB', accent: '#8B1A1A', gold: '#C9A86A',
};

function loneFigure(x, y, hgt, fill, op = 1, flip = 1) {
  /* a robed silhouette, feet at (x,y), `hgt` tall */
  const s = hgt / 120;
  return `<g transform="translate(${f1(x)},${f1(y)}) scale(${f1(flip * s)},${f1(s)})" fill="${fill}" opacity="${op}">
    <circle cx="0" cy="-107" r="10.5"/>
    <path d="M -10.5 0 L -8.2 -44 C -8.2 -64 -4.4 -73 0 -77.5 C 4.4 -73 8.2 -64 8.2 -44 L 10.5 0 Z"/>
    <path d="M -8.6 -46 L -15.5 -30 L -13 -27 L -7.6 -40 Z"/>
    <path d="M 8.6 -46 L 15.5 -30 L 13 -27 L 7.6 -40 Z"/>
  </g>`;
}

function dustField(t, n, opts = {}) {
  const {
    x0 = 0, x1 = W, y0 = 0, y1 = H, size = 2.2, color = C.paper,
    op = .30, drift = -18, rise = -26, seed = 1,
  } = opts;
  let o = '';
  for (let i = 0; i < n; i++) {
    const sx = lerp(x0, x1, hsh(i + seed * 13.1));
    const sy = lerp(y0, y1, hsh(i + seed * 29.7));
    const sp = .35 + hsh(i + seed * 5.3) * .9;
    const ph = hsh(i + seed * 91.1) * TAU;
    const px = sx + ((t * drift * sp) % (x1 - x0 + 200));
    const wrapx = px < x0 - 100 ? px + (x1 - x0 + 200) : px;
    const py = sy + Math.sin(t * .5 * sp + ph) * 9 + ((t * rise * sp) % (y1 - y0 + 200));
    const wrapy = py < y0 - 100 ? py + (y1 - y0 + 200) : py;
    const r = size * (.45 + hsh(i + seed * 3.7) * 1.15);
    const a = op * (.35 + hsh(i + seed * 7.7) * .65) * (.55 + .45 * Math.sin(t * 1.4 + ph));
    o += `<circle cx="${f1(wrapx)}" cy="${f1(wrapy)}" r="${f1(Math.max(.4, r))}" fill="${color}" opacity="${(a * 100 | 0) / 100}"/>`;
  }
  return o;
}

/* ============================================================== SCENE 1 =====
   Title: the homeland erodes into dust; only the question remains.
   ========================================================================== */
function artTitle(S) {
  const { t, p } = S;
  const g = DATA.geo;
  const yem = g.countries.yemen;
  const T = S.mapT;                       // precomputed transform
  const ctxPaths = g.context;

  // erosion: 0 -> 1 across the scene
  const ero = smooth(inv(.10, .92, p));

  let o = '';

  // faint graticule (VOX map language)
  o += `<g stroke="${C.paper}" stroke-width="1" opacity=".055">`;
  for (let i = 1; i < 9; i++) o += `<line x1="0" y1="${f1(i * H / 9)}" x2="${W}" y2="${f1(i * H / 9)}"/>`;
  for (let i = 1; i < 16; i++) o += `<line x1="${f1(i * W / 16)}" y1="0" x2="${f1(i * W / 16)}" y2="${H}"/>`;
  o += `</g>`;

  // neighbouring countries, very faint
  o += `<g transform="${T}" fill="none" stroke="${C.paper}" stroke-width="1.6" opacity=".085" stroke-linejoin="round">`;
  for (const d of ctxPaths) o += `<path d="${d}"/>`;
  o += `</g>`;

  // the homeland itself
  o += `<g transform="${T}" fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="${yem.paths[0]}" stroke="${C.paper}" stroke-width="3.4" opacity="${f1(.62 * (1 - .72 * ero))}"/>
    <path d="${yem.paths[0]}" stroke="${C.accent}" stroke-width="1.2" opacity="${f1(.30 * (1 - ero))}"
      transform="translate(6,7)"/>
    <path d="${yem.paths[0]}" stroke="${C.paper}" stroke-width="1" opacity="${f1(.16 * (1 - .5 * ero))}"
      transform="translate(-7,-9)"/>
  </g>`;

  // dust: every sampled outline point detaches at its own moment
  const pts = S.mapPts;
  const N = pts.length;
  o += `<g>`;
  for (let i = 0; i < N; i++) {
    const pt = pts[i];
    const dt = (.06 + .74 * (pt.ny) + hsh(i * 3.1) * .22);   // top erodes first
    const a = inv(dt, dt + .30, p);                           // 0 before, 1 after
    if (a <= 0) {
      o += `<circle cx="${f1(pt.x)}" cy="${f1(pt.y)}" r="1.5" fill="${C.paper}" opacity="${f1(.55 * (1 - ero * .4))}"/>`;
      continue;
    }
    const e = easeOut(a);
    const vx = (hsh(i * 8.3) - .34) * 210;
    const vy = -(52 + hsh(i * 4.9) * 190);
    const x = pt.x + vx * e + Math.sin(t * 1.1 + i) * 7 * e;
    const y = pt.y + vy * e - 26 * e * e;
    const r = 1.5 + hsh(i * 2.2) * 2.6 * (1 - e * .45);
    const op = (1 - e) * (.55 + hsh(i * 6.6) * .45);
    if (op > .012) o += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${C.paper}" opacity="${f1(op * .85)}"/>`;
  }
  o += `</g>`;

  o += dustField(t, 90, { op: .16, size: 1.8, seed: 3 });

  // a thin red horizon of loss
  const hz = inv(.55, 1, p);
  if (hz > 0) {
    o += `<line x1="${f1(W * .5 - 300 * hz)}" y1="540" x2="${f1(W * .5 + 300 * hz)}" y2="540"
      stroke="${C.accent}" stroke-width="1.2" opacity="${f1(.35 * hz)}"/>`;
  }
  return o;
}

/* ============================================================== SCENE 2 =====
   Verse 1 — a man in an empty desert, and even his shadow leaves him.
   ========================================================================== */
function artDesert(S) {
  const { t, p } = S;
  const gy = 712;
  const fx = 960, fh = 128;
  let o = '';

  // dunes (parallax layers)
  const layers = [
    { y: gy - 4, amp: 16, op: .055, k: .0 },
    { y: gy + 40, amp: 26, op: .075, k: .25 },
    { y: gy + 108, amp: 34, op: .10, k: .55 },
  ];
  layers.forEach((L, li) => {
    let d = `M -40 ${f1(L.y + 260)} L -40 ${f1(L.y)}`;
    for (let x = -40; x <= W + 40; x += 40) {
      const yy = L.y + Math.sin(x / 260 + li * 1.7) * L.amp + vnoise(x / 420 + li * 9, li) * L.amp * .8;
      d += ` L ${x} ${f1(yy)}`;
    }
    d += ` L ${W + 40} ${f1(L.y + 260)} Z`;
    o += `<path d="${d}" fill="${C.paper}" opacity="${L.op}"/>`;
  });

  // horizon
  o += `<line x1="-40" y1="${gy}" x2="${W + 40}" y2="${gy}" stroke="${C.paper}" stroke-width="1" opacity=".20"/>`;

  // his shadow — shrinks and vanishes (the Morph the board asks for)
  const sh = 1 - smooth(inv(.16, .74, p));
  if (sh > .004) {
    const len = 250 * sh;
    o += `<g opacity="${f1(.5 * sh)}">
      <path d="M ${fx} ${gy} L ${f1(fx + len * .72)} ${f1(gy + 5)} L ${f1(fx + len)} ${f1(gy + 16)} L ${f1(fx - 12)} ${f1(gy + 18)} Z"
        fill="rgba(11,11,13,.55)" stroke="${C.paper}" stroke-width="1.2"/>
    </g>`;
  }
  // a small "no shadow" marker where it used to be
  const nomark = inv(.70, .92, p);
  if (nomark > 0) {
    o += `<g opacity="${f1(.5 * nomark)}" stroke="${C.accent}" stroke-width="1.2" fill="none">
      <line x1="${fx - 26}" y1="${gy + 12}" x2="${fx + 26}" y2="${gy + 12}"/>
    </g>`;
  }

  // on a charcoal ground the figure has to be the light shape, not a hole
  o += loneFigure(fx, gy, fh, C.paper, .90);
  o += loneFigure(fx, gy, fh, 'none', 1);
  o += `<g transform="translate(${fx},${gy})" fill="none" stroke="${C.accent}" stroke-width="1.6" opacity=".38">
    <circle cx="0" cy="-99.9" r="13"/>
  </g>`;

  // wind-blown sand
  o += dustField(t, 120, { y0: gy - 220, y1: H, op: .22, size: 1.7, drift: -46, rise: 0, seed: 11 });
  o += dustField(t, 40, { y0: 120, y1: gy, op: .10, size: 1.2, drift: -22, rise: -8, seed: 17 });
  return o;
}

/* ============================================================== SCENE 3 =====
   Verse 2 — clinical infographic: the heart keeps time, the graph keeps rising,
   and every beat spells the same word.
   ========================================================================== */
function artHeart(S) {
  const { t, p } = S;
  const cx = 960, cy = 470;
  const R = 190;
  let o = '';

  // ECG grid
  o += `<g stroke="${C.paper}" stroke-width="1" opacity=".05">`;
  for (let x = cx - 520; x < cx + 520; x += 34) o += `<line x1="${x}" y1="${cy - 320}" x2="${x}" y2="${cy + 320}"/>`;
  for (let y = cy - 320; y < cy + 320; y += 34) o += `<line x1="${cx - 520}" y1="${y}" x2="${cx + 520}" y2="${y}"/>`;
  o += `</g>`;

  // heartbeat envelope: 72 bpm, "lub-dub"
  const bps = 72 / 60;
  const ph = (t * bps) % 1;
  const env = Math.exp(-ph * 15) + .58 * Math.exp(-Math.max(0, ph - .21) * 13);
  const beatN = Math.floor(t * bps);

  const sc = 1 + env * .085;
  const heartPath = `M 0 -46 C -34 -104 -124 -80 -124 -12 C -124 70 -34 112 0 158
                     C 34 112 124 70 124 -12 C 124 -80 34 -104 0 -46 Z`;

  // rising bar chart inside the heart (the graph of grief)
  const bars = 22;
  const grown = clamp(p * 1.35, 0, 1);
  let barsSvg = '';
  for (let i = 0; i < bars; i++) {
    const bx = -108 + i * 10.2;
    const vis = inv(i / bars, i / bars + .22, grown);
    if (vis <= 0) continue;
    const hgt = (12 + vnoise(i * .8, 3) * 74) * vis * (.55 + .45 * vnoise(i * 2.1, 7));
    barsSvg += `<rect x="${f1(bx)}" y="${f1(96 - hgt)}" width="6" height="${f1(hgt)}" fill="${C.accent}"
      opacity="${f1(.30 + .45 * (i / bars))}"/>`;
  }

  // jagged ECG trace across the middle
  let trace = `M -540 22`;
  for (let x = -540; x <= 540; x += 12) {
    const u = (x + 540) / 1080;
    const seen = inv(0, .95, p) * 1.25 - u;
    let yy = 22 + Math.sin(x / 90) * 4 + (vnoise(x / 40, 5) - .5) * 7;
    const k = (x / 12) % 44;
    if (k > 40) { const q = (k - 40) / 4; yy -= (q === 0 ? 0 : 0); }
    if (Math.abs(((x / 12) % 44) - 42) < 1.2) yy -= 46;
    if (Math.abs(((x / 12) % 44) - 39) < 1.2) yy += 22;
    if (seen < 0) yy = 22;
    trace += ` L ${x} ${f1(yy)}`;
  }

  o += `<defs>
    <clipPath id="hclip"><path d="${heartPath}" transform="translate(${cx},${cy}) scale(${f1(sc)})"/></clipPath>
  </defs>`;

  o += `<g transform="translate(${cx},${cy})">
    <g transform="scale(${f1(sc)})">
      <path d="${heartPath}" fill="rgba(139,26,26,.10)"/>
      <path d="${heartPath}" fill="none" stroke="${C.paper}" stroke-width="2.4" opacity=".85"/>
      <path d="${heartPath}" fill="none" stroke="${C.accent}" stroke-width="1" opacity=".34"
        transform="scale(.9) translate(0,4)"/>
      <g clip-path="url(#hclip)">${barsSvg}</g>
      <path d="${trace}" fill="none" stroke="${C.paper}" stroke-width="1.5" opacity=".5"
        transform="translate(0,10)" clip-path="url(#hclip)"/>
    </g>`;

  // every beat writes the same name
  const bl = clamp(1 - ph * 2.6, 0, 1);
  if (bl > .02) {
    o += `<text x="0" y="26" text-anchor="middle" font-family="Tajawal" font-weight="900"
      font-size="${f1(46 + 10 * (1 - bl))}" fill="${C.accent}"
      opacity="${f1(bl * .9 * (.4 + .6 * grown))}"
      transform="scale(${f1(1 + (1 - bl) * .16)})">أَنْتَ</text>`;
  }
  o += `</g>`;

  // pulse rings
  for (let k = 0; k < 3; k++) {
    const kk = (ph + k / 3) % 1;
    const rr = R * (1 + kk * 1.35);
    o += `<circle cx="${cx}" cy="${cy}" r="${f1(rr)}" fill="none" stroke="${C.accent}"
      stroke-width="1.4" opacity="${f1(.30 * (1 - kk) * (1 - kk))}"/>`;
  }

  // axis labels — VOX annotation language
  o += `<g font-family="PlexAr" font-size="13" fill="${C.paper}" opacity=".30" letter-spacing="2">
    <text x="${cx - 520}" y="${cy + 344}" text-anchor="start">مِنْسُوبُ الْحُزْنِ</text>
    <text x="${cx + 520}" y="${cy + 344}" text-anchor="end">٧٢ نَبْضَة / د</text>
  </g>`;
  return o;
}

/* ============================================================== SCENE 4 =====
   Verse 3 — dozens of small sorrows converge into a single face.
   ========================================================================== */
function artCollage(S) {
  const { t, p } = S;
  const m = smooth(inv(.12, .80, p));           // morph 0 -> 1
  const cx = 960, cy = 500;
  const N = 96;
  let o = '';

  const faceIcon = (x, y, s, rot, op, col) =>
    `<g transform="translate(${f1(x)},${f1(y)}) rotate(${f1(rot)}) scale(${f1(s)})" opacity="${f1(op)}">
      <circle r="9" fill="none" stroke="${col}" stroke-width="1.5"/>
      <circle cx="-3.2" cy="-2.4" r="1.15" fill="${col}"/>
      <circle cx="3.2" cy="-2.4" r="1.15" fill="${col}"/>
      <path d="M -4 4.6 Q 0 1.4 4 4.6" fill="none" stroke="${col}" stroke-width="1.2"/>
    </g>`;
  const tearIcon = (x, y, s, rot, op, col) =>
    `<g transform="translate(${f1(x)},${f1(y)}) rotate(${f1(rot)}) scale(${f1(s)})" opacity="${f1(op)}">
      <path d="M 0 -9 C 4.6 -3.2 6.4 0.4 6.4 3.2 C 6.4 7 3.6 9.4 0 9.4 C -3.6 9.4 -6.4 7 -6.4 3.2 C -6.4 0.4 -4.6 -3.2 0 -9 Z"
        fill="none" stroke="${col}" stroke-width="1.3"/>
    </g>`;
  const crossIcon = (x, y, s, rot, op, col) =>
    `<g transform="translate(${f1(x)},${f1(y)}) rotate(${f1(rot)}) scale(${f1(s)})" opacity="${f1(op)}">
      <rect x="-7" y="-2.4" width="14" height="4.8" fill="none" stroke="${col}" stroke-width="1.2"/>
      <rect x="-2.4" y="-7" width="4.8" height="14" fill="none" stroke="${col}" stroke-width="1.2"/>
    </g>`;

  // the target: one large face outline
  const bigR = 250;
  if (m > .35) {
    const a = inv(.35, 1, m);
    o += `<g opacity="${f1(a)}" transform="translate(${cx},${cy})">
      <path d="M 0 ${f1(-bigR)} C ${f1(bigR * .82)} ${f1(-bigR)} ${f1(bigR * .96)} ${f1(-bigR * .30)} ${f1(bigR * .96)} ${f1(bigR * .06)}
        C ${f1(bigR * .96)} ${f1(bigR * .62)} ${f1(bigR * .52)} ${f1(bigR)} 0 ${f1(bigR)}
        C ${f1(-bigR * .52)} ${f1(bigR)} ${f1(-bigR * .96)} ${f1(bigR * .62)} ${f1(-bigR * .96)} ${f1(bigR * .06)}
        C ${f1(-bigR * .96)} ${f1(-bigR * .30)} ${f1(-bigR * .82)} ${f1(-bigR)} 0 ${f1(-bigR)} Z"
        fill="rgba(139,26,26,.05)" stroke="${C.paper}" stroke-width="2.2"/>
      <g fill="${C.paper}">
        <ellipse cx="${f1(-bigR * .34)}" cy="${f1(-bigR * .16)}" rx="${f1(bigR * .10)}" ry="${f1(bigR * .062)}"/>
        <ellipse cx="${f1(bigR * .34)}" cy="${f1(-bigR * .16)}" rx="${f1(bigR * .10)}" ry="${f1(bigR * .062)}"/>
      </g>
      <path d="M ${f1(-bigR * .34)} ${f1(bigR * .42)} Q 0 ${f1(bigR * .18)} ${f1(bigR * .34)} ${f1(bigR * .42)}"
        fill="none" stroke="${C.paper}" stroke-width="2" opacity=".8"/>
    </g>`;
  }

  for (let i = 0; i < N; i++) {
    // start: scattered cloud
    const gx = (i % 12) / 11, gy = Math.floor(i / 12) / 7;
    const sx = 220 + gx * 1480 + (hsh(i * 3.7) - .5) * 130;
    const sy = 130 + gy * 830 + (hsh(i * 7.1) - .5) * 110;
    // end: on the rim / features of the big face
    const kind = i % 3;
    let ex, ey;
    if (kind === 0) {
      const a = (i / N) * TAU * 1.0 - Math.PI / 2;
      const jitter = .93 + hsh(i * 2.3) * .13;
      ex = cx + Math.cos(a) * bigR * .95 * jitter;
      ey = cy + Math.sin(a) * bigR * jitter * 1.06;
    } else if (kind === 1) {
      const a = -Math.PI / 2 + (hsh(i * 5.5) - .5) * .5;
      ex = cx + (hsh(i * 9.1) - .5) * bigR * .74;
      ey = cy - bigR * .16 + (hsh(i * 4.4) - .5) * 26;
    } else {
      const a = Math.PI * (.16 + hsh(i * 6.2) * .68);
      ex = cx + Math.cos(a) * bigR * .40;
      ey = cy + bigR * .30 + Math.sin(a) * bigR * .16;
    }
    const e2 = easeIO(m);
    const swirl = (1 - e2) * Math.sin(t * .8 + i * .3) * 60;
    const x = lerp(sx, ex, e2) + swirl * (1 - e2);
    const y = lerp(sy, ey, e2) + Math.cos(t * .7 + i * .21) * 14 * (1 - e2);
    const s = lerp(.78 + hsh(i * 1.9) * .5, .30 + hsh(i * 8.8) * .22, e2);
    const rot = lerp((hsh(i * 6.1) - .5) * 90, 0, e2) + Math.sin(t + i) * 6 * (1 - e2);
    const op = lerp(.55, .34, e2) * (.6 + .4 * Math.sin(t * 1.6 + i));
    const col = (i % 11 === 0) ? C.accent : C.paper;
    if (kind === 0) o += faceIcon(x, y, s, rot, op, col);
    else if (kind === 1) o += tearIcon(x, y, s * 1.1, rot, op, col);
    else o += crossIcon(x, y, s, rot, op * .8, col);
  }

  o += dustField(t, 60, { op: .12, size: 1.5, seed: 23 });
  return o;
}

/* ============================================================== SCENE 5 =====
   Chorus — brutalist type with heat-haze, a tightening rope, a cracking world.
   ========================================================================== */
function artBrutalist(S) {
  const { t, p } = S;
  let o = '';

  // heat haze: sine-displaced horizontal rules (cheap, no filters)
  o += `<g stroke="${C.accent}" fill="none" opacity=".16">`;
  for (let k = 0; k < 9; k++) {
    const yy = 190 + k * 82;
    let d = `M -40 ${f1(yy)}`;
    for (let x = -40; x <= W + 40; x += 26) {
      const a = Math.sin(x / 210 + t * 1.25 + k * .7) * (7 + k) + Math.sin(x / 61 - t * 2.1) * 3.2;
      d += ` L ${x} ${f1(yy + a)}`;
    }
    o += `<path d="${d}" stroke-width="1.1"/>`;
  }
  o += `</g>`;

  // a rope that tightens
  const tight = 1 - smooth(inv(.15, .95, p));
  const amp = 26 + 54 * tight;
  o += `<g stroke="${C.paper}" fill="none" opacity="${f1(.14 + .20 * tight)}">`;
  for (let s = 0; s < 2; s++) {
    let d = `M ${-40} 300`;
    for (let x = -40; x <= W + 40; x += 18) {
      const y = 300 + Math.sin(x / 74 + t * .5 + s * Math.PI) * amp + vnoise(x / 120, s) * 14;
      d += ` L ${x} ${f1(y)}`;
    }
    o += `<path d="${d}" stroke-width="2.2"/>`;
  }
  o += `</g>`;

  // the world cracks
  const cr = smooth(inv(.45, 1, p));
  if (cr > 0) {
    o += `<g opacity="${f1(cr * .5)}" stroke="${C.paper}" fill="none" stroke-width="1">
      <ellipse cx="960" cy="540" rx="360" ry="360" opacity=".28"/>
      <ellipse cx="960" cy="540" rx="360" ry="130" opacity=".22"/>
      <ellipse cx="960" cy="540" rx="130" ry="360" opacity=".22"/>
      <line x1="600" y1="180" x2="1320" y2="900" opacity=".2"/>
      <line x1="600" y1="900" x2="1320" y2="180" opacity=".2"/>
    </g>`;
    for (let c = 0; c < 6; c++) {
      const grow = clamp(cr * 1.5 - c * .12, 0, 1);
      if (grow <= 0) continue;
      const a0 = hsh(c * 3.3) * TAU;
      let d = `M 960 540`;
      let x = 960, y = 540, ang = a0;
      for (let s = 0; s < 9; s++) {
        ang += (hsh(c * 17 + s) - .5) * 1.1;
        const seg = 46 * grow;
        x += Math.cos(ang) * seg; y += Math.sin(ang) * seg;
        d += ` L ${f1(x)} ${f1(y)}`;
      }
      o += `<path d="${d}" stroke="${C.accent}" stroke-width="${f1(1.6 + hsh(c) * 1.6)}" opacity="${f1(.55 * grow)}"/>`;
    }
  }

  o += dustField(t, 70, { op: .13, size: 2.0, rise: -34, seed: 31 });
  return o;
}

/* ============================================================== SCENE 6 =====
   The three crucifixions — isometric, three vertical panels.
   ========================================================================== */
function artSplit3(S) {
  const { t, p } = S;
  const PW = 560, GAP = 40, PY = 132, PH = 660;
  const X0 = (W - (PW * 3 + GAP * 2)) / 2;
  let o = '';

  for (let c = 0; c < 3; c++) {
    const ap = smooth(inv(.06 + c * .16, .30 + c * .16, p));
    if (ap <= 0) continue;
    const x = X0 + c * (PW + GAP);
    const cx = x + PW / 2, cy = PY + PH / 2;

    // panel shell with a centre-out vertical split reveal
    o += `<g opacity="${f1(ap)}">`;
    o += `<defs><clipPath id="pan${c}">
      <rect x="${f1(x)}" y="${f1(PY + PH / 2 - (PH / 2) * ap)}" width="${PW}" height="${f1(PH * ap)}" rx="10"/>
    </clipPath></defs>`;
    o += `<rect x="${f1(x)}" y="${PY}" width="${PW}" height="${PH}" rx="10"
      fill="rgba(232,221,203,.035)" stroke="rgba(232,221,203,.16)" stroke-width="1"/>`;
    o += `<g clip-path="url(#pan${c})">`;

    if (c === 0) {
      /* ---- broken calendar ------------------------------------------- */
      const gx = cx - 168, gy = cy - 130, cw = 44, ch = 34;
      for (let r = 0; r < 6; r++) for (let q = 0; q < 8; q++) {
        const jx = (hsh(r * 8 + q) - .5) * (r > 2 ? 16 : 3) * (1 - .0);
        const jy = (hsh(r * 8 + q + 40) - .5) * (r > 2 ? 14 : 3);
        o += `<rect x="${f1(gx + q * cw + jx)}" y="${f1(gy + r * ch + jy)}" width="36" height="26" rx="2"
          fill="none" stroke="${C.paper}" stroke-width="1" opacity="${f1(.30 - r * .02)}"/>`;
      }
      let d = `M ${f1(cx - 190)} ${f1(gy - 20)}`;
      let yy = gy - 20;
      for (let s = 0; s < 8; s++) {
        yy += 28 + hsh(s * 3) * 12;
        d += ` L ${f1(cx - 190 + (hsh(s * 7) - .5) * 90)} ${f1(yy)}`;
      }
      o += `<path d="${d}" fill="none" stroke="${C.accent}" stroke-width="2" opacity=".7"/>`;
      // torn page drifting
      const fl = (t * .35) % 1;
      o += `<g transform="translate(${f1(cx + 130)},${f1(cy + 40 + Math.sin(t * 1.2) * 12)}) rotate(${f1(14 + Math.sin(t) * 6)})"
        opacity=".55"><rect x="-20" y="-26" width="40" height="52" fill="${C.bg}" stroke="${C.paper}" stroke-width="1"/></g>`;

    } else if (c === 1) {
      /* ---- the road --------------------------------------------------- */
      const rw = 300, rh = 92;
      const iso = (px, py) => [cx + (px - py) * 1.0, cy + (px + py) * .46];
      const P = [iso(-rw / 2, -rh / 2), iso(rw / 2, -rh / 2), iso(rw / 2, rh / 2), iso(-rw / 2, rh / 2)];
      o += `<path d="M ${P.map(q => f1(q[0]) + ' ' + f1(q[1])).join(' L ')} Z"
        fill="rgba(232,221,203,.05)" stroke="${C.paper}" stroke-width="1" opacity=".55"/>`;
      // centre dashes
      for (let k = 0; k < 6; k++) {
        const a = iso(-rw / 2 + 30 + k * 46, 0), b = iso(-rw / 2 + 46 + k * 46, 0);
        o += `<line x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"
          stroke="${C.paper}" stroke-width="2.4" opacity=".35"/>`;
      }
      // what is spilled — suggestion only, never gore
      const flow = smooth(inv(.05, .8, p));
      const A = iso(-rw / 2, -rh * .1), B = iso(rw / 2, -rh * .1), Cc = iso(rw / 2 + 10, rh * .9), D = iso(-rw / 2 - 10, rh * .9);
      const L = .18 + .82 * flow;
      o += `<path d="M ${f1(A[0])} ${f1(A[1])} L ${f1(B[0])} ${f1(B[1])}
        L ${f1(lerp(B[0], Cc[0], L))} ${f1(lerp(B[1], Cc[1], L))}
        L ${f1(lerp(A[0], D[0], L))} ${f1(lerp(A[1], D[1], L))} Z"
        fill="${C.accent}" opacity="${f1(.30 * flow)}"/>`;
      o += `<path d="M ${f1(A[0])} ${f1(A[1])} L ${f1(B[0])} ${f1(B[1])}"
        stroke="${C.accent}" stroke-width="2" opacity="${f1(.55 * flow)}" fill="none"/>`;

    } else {
      /* ---- the ruins and the rope ------------------------------------- */
      const boxes = [
        { x: -150, y: 40, w: 78, h: 190, br: 1 },
        { x: -46, y: -30, w: 92, h: 260, br: 2 },
        { x: 74, y: 30, w: 70, h: 200, br: 1 },
        { x: -190, y: 96, w: 62, h: 134, br: 0 },
      ];
      boxes.forEach((b, bi) => {
        const bx = cx + b.x, by = cy + b.y;
        const top = by - b.h;
        const n = 5, jag = b.br ? 26 : 8;
        let d = `M ${f1(bx)} ${f1(by)} L ${f1(bx)} ${f1(top)}`;
        for (let s = 0; s <= n; s++) {
          const xx = bx + (b.w * s) / n;
          d += ` L ${f1(xx)} ${f1(top + (s % 2 ? jag : 0) * (.4 + hsh(bi * 5 + s) * .9))}`;
        }
        d += ` L ${f1(bx + b.w)} ${f1(by)} Z`;
        o += `<path d="${d}" fill="rgba(232,221,203,.045)" stroke="${C.paper}" stroke-width="1.1" opacity=".55"/>`;
        o += `<line x1="${f1(bx)}" y1="${f1(by)}" x2="${f1(bx - 26)}" y2="${f1(by - 15)}"
          stroke="${C.paper}" stroke-width="1" opacity=".3"/>`;
      });
      // the rope: implied, never explicit
      const sw = Math.sin(t * .9) * .05;
      o += `<path d="M ${f1(cx - 4)} ${f1(cy - 300)} C ${f1(cx + 20)} ${f1(cy - 190)} ${f1(cx - 18)} ${f1(cy - 90)} ${f1(cx + 2 + sw * 90)} ${f1(cy - 6)}"
        fill="none" stroke="${C.paper}" stroke-width="2.2" opacity=".42"/>`;
      o += `<circle cx="${f1(cx + 2 + sw * 90)}" cy="${f1(cy + 6)}" r="13" fill="none"
        stroke="${C.paper}" stroke-width="2" opacity=".34"/>`;
    }

    o += `</g>`;
    // panel index
    o += `<text x="${f1(x + 22)}" y="${f1(PY + 34)}" font-family="PlexAr" font-size="15"
      fill="${C.paper}" opacity=".30" letter-spacing="3">٠${c + 1}</text>`;
    o += `</g>`;
  }

  o += dustField(t, 70, { op: .13, size: 1.7, seed: 41 });
  return o;
}

/* ============================================================== SCENE 7 =====
   Outro — the tear that carries the homeland, then the word becomes the map.
   ========================================================================== */
function artTear(S) {
  const { t, p } = S;
  const cx = 960, cy = 520;
  let o = '';
  const phA = inv(0, .40, p), phB = inv(.34, .74, p), phC = inv(.70, 1, p);

  /* ---- phase A: orbiting the lone figure ------------------------------- */
  if (phA > 0 && phB < .99) {
    const a = inv(0, .46, p) * TAU;                    // one full turn
    const gy = 690;
    const par = Math.sin(a) * 150;
    // parallax dunes
    for (let L = 0; L < 3; L++) {
      const off = par * (.2 + L * .35);
      let d = `M -100 1080 L -100 ${f1(gy + 30 + L * 70)}`;
      for (let x = -100; x <= W + 100; x += 46) {
        d += ` L ${f1(x + off)} ${f1(gy + 30 + L * 70 + Math.sin((x + off) / 240 + L * 2) * (14 + L * 8))}`;
      }
      d += ` L ${W + 100} 1080 Z`;
      o += `<path d="${d}" fill="${C.paper}" opacity="${f1(.05 + L * .022)}"/>`;
    }
    o += loneFigure(cx, gy, 132, C.paper, .88);
    // the orbit ring — an ellipse whose width breathes with cos(angle)
    const rx = Math.abs(Math.cos(a)) * 330 + 24, ry = 84;
    o += `<ellipse cx="${cx}" cy="${f1(gy - 8)}" rx="${f1(rx)}" ry="${f1(ry)}" fill="none"
      stroke="${C.paper}" stroke-width="1" opacity=".30"/>`;
    const mx = cx + Math.cos(a) * rx, my = gy - 8 + Math.sin(a) * ry;
    o += `<circle cx="${f1(mx)}" cy="${f1(my)}" r="4.5" fill="${C.accent}" opacity="${f1(.9 * (1 - phB))}"/>`;
  }

  /* ---- phase B: the tear ---------------------------------------------- */
  if (phB > 0 && phC < .98) {
    const fall = easeIn(phB);
    const R = 250 + 90 * phB;
    const ty = cy - 120 + fall * 240;
    const dripY = ty + R * 1.35;
    const tp = `M ${f1(cx)} ${f1(ty - R * 1.42)}
      C ${f1(cx + R * .78)} ${f1(ty - R * .2)} ${f1(cx + R * .92)} ${f1(ty + R * .42)} ${f1(cx + R * .62)} ${f1(ty + R * .82)}
      C ${f1(cx + R * .28)} ${f1(ty + R * 1.12)} ${f1(cx - R * .28)} ${f1(ty + R * 1.12)} ${f1(cx - R * .62)} ${f1(ty + R * .82)}
      C ${f1(cx - R * .92)} ${f1(ty + R * .42)} ${f1(cx - R * .78)} ${f1(ty - R * .2)} ${f1(cx)} ${f1(ty - R * 1.42)} Z`;

    o += `<defs>
      <clipPath id="tearclip"><path d="${tp}"/></clipPath>
      <linearGradient id="goldgrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${C.gold}" stop-opacity=".85"/>
        <stop offset="55%" stop-color="${C.gold}" stop-opacity=".18"/>
        <stop offset="100%" stop-color="${C.accent}" stop-opacity=".10"/>
      </linearGradient>
    </defs>`;
    o += `<path d="${tp}" fill="url(#goldgrad)" opacity=".22"/>`;
    o += `<g clip-path="url(#tearclip)">`;
    // the homeland reflected inside the tear
    const g = DATA.geo, yem = g.countries.yemen;
    const T = S.mapT2;
    o += `<g transform="${T}" fill="none" stroke="${C.gold}" stroke-width="2.6" opacity="${f1(.75 * phB)}">
      <path d="${yem.paths[0]}"/></g>`;
    // tiny houses along the coast
    for (let i = 0; i < 14; i++) {
      const hx = cx - 150 + hsh(i * 3.1) * 300;
      const hy = ty + 40 + hsh(i * 7.7) * 170;
      const s = 5 + hsh(i * 2.2) * 7;
      o += `<path d="M ${f1(hx - s)} ${f1(hy)} L ${f1(hx - s)} ${f1(hy - s)} L ${f1(hx)} ${f1(hy - s * 1.7)} L ${f1(hx + s)} ${f1(hy - s)} L ${f1(hx + s)} ${f1(hy)} Z"
        fill="none" stroke="${C.gold}" stroke-width="1.1" opacity="${f1(.34 * phB)}"/>`;
    }
    // caustic shimmer
    for (let k = 0; k < 4; k++) {
      let d = `M ${f1(cx - R)} ${f1(ty + k * 60 - 60)}`;
      for (let x = -R; x <= R; x += 22) {
        d += ` L ${f1(cx + x)} ${f1(ty + k * 60 - 60 + Math.sin(x / 60 + t * 1.6 + k) * 7)}`;
      }
      o += `<path d="${d}" fill="none" stroke="${C.gold}" stroke-width="1" opacity="${f1(.12 * phB)}"/>`;
    }
    o += `</g>`;
    o += `<path d="${tp}" fill="none" stroke="${C.gold}" stroke-width="2"
      opacity="${f1(.62 * (1 - phC * .6))}"/>`;
    // highlight
    o += `<ellipse cx="${f1(cx - R * .30)}" cy="${f1(ty + R * .22)}" rx="${f1(R * .16)}" ry="${f1(R * .28)}"
      fill="#fff" opacity="${f1(.10 * phB)}"/>`;
  }

  /* ---- phase C: the word becomes the map and lights up ------------------ */
  if (phC > 0) {
    const g = DATA.geo, yem = g.countries.yemen;
    const T = S.mapT3;
    const lit = easeOut(inv(.18, .95, phC));
    o += `<g transform="${T}">
      <path d="${yem.paths[0]}" fill="rgba(201,168,106,${f1(.16 * lit)})" stroke="${C.gold}"
        stroke-width="${f1(1.8 + 1.6 * lit)}" opacity="${f1(.35 + .6 * lit)}"/>
      <path d="${yem.paths[0]}" fill="none" stroke="${C.gold}" stroke-width="9" opacity="${f1(.10 * lit)}"/>
    </g>`;
    o += `<g fill="none" stroke="${C.gold}" stroke-width="1" opacity="${f1(.22 * lit)}">`;
    for (let k = 1; k <= 3; k++) {
      o += `<circle cx="960" cy="540" r="${f1(200 + k * 90 * (1 + .1 * Math.sin(t * 2)))}" opacity="${f1(.5 / k)}"/>`;
    }
    o += `</g>`;
  }
  o += dustField(t, 60, { op: .13, size: 1.6, rise: -20, seed: 51 });
  return o;
}

/* ============================================================== BRIDGE ======
   The instrumental interlude: the song breathes, and the waveform of the whole
   poem draws itself. Nothing is sung, so nothing is claimed.
   ========================================================================== */
function artBridge(S) {
  const { t, p, abs } = S;
  const rms = DATA.audio.rms, hop = DATA.audio.hopSec;
  const cx = 960, cy = 540;
  let o = '';

  // concentric "sigh" rings
  for (let k = 0; k < 5; k++) {
    const kk = ((t * .22) + k / 5) % 1;
    o += `<circle cx="${cx}" cy="${cy}" r="${f1(120 + kk * 620)}" fill="none" stroke="${C.paper}"
      stroke-width="1.1" opacity="${f1(.16 * (1 - kk))}"/>`;
  }

  // full-track waveform, drawn progressively from the live signal
  const N = 300;
  const cur = Math.floor(abs / hop);
  let bars = '';
  for (let i = 0; i < N; i++) {
    const idx = Math.round((i / N) * rms.length);
    const v = rms[Math.min(rms.length - 1, idx)] || 0;
    const x = 100 + (i / N) * (W - 200);
    const hgt = 8 + v * 150;
    const isNow = Math.abs(i / N - (abs / DATA.audio.duration)) < (2.5 / N);
    const op = idx <= cur ? (isNow ? .75 : .26) : .08;
    bars += `<rect x="${f1(x)}" y="${f1(cy - hgt / 2)}" width="${f1((W - 200) / N * .55)}" height="${f1(hgt)}"
      fill="${isNow ? C.accent : C.paper}" opacity="${f1(op)}"/>`;
  }
  o += bars;

  // three echoes of the word, receding
  for (let k = 0; k < 3; k++) {
    const kk = ((t * .3) + k / 3) % 1;
    const s = .55 + kk * .95;
    o += `<text x="${cx}" y="${f1(cy - 210)}" text-anchor="middle" font-family="Tajawal" font-weight="900"
      font-size="120" fill="${C.accent}" opacity="${f1(.16 * (1 - kk))}"
      transform="translate(${cx},${f1(cy - 210)}) scale(${f1(s)}) translate(${-cx},${f1(-(cy - 210))})">أَنْتَ</text>`;
  }
  o += dustField(t, 80, { op: .14, size: 1.7, rise: -22, seed: 61 });
  return o;
}

/* ============================================================== FINAL =======
   The lock-off: the word has become the homeland, and the homeland lights up.
   ========================================================================== */
function artFinal(S) {
  const { t, p } = S;
  const g = DATA.geo, yem = g.countries.yemen;
  const T = S.mapT3;
  const lit = easeOut(inv(.05, .80, p));
  let o = '';

  // everything converges into the outline
  const N = 130;
  for (let i = 0; i < N; i++) {
    const a = hsh(i * 3.1) * TAU;
    const r0 = 420 + hsh(i * 7.7) * 420;
    const e = easeIO(clamp(lit * 1.25 - hsh(i * 5.1) * .3, 0, 1));
    const r = lerp(r0, 8, e);
    const x = 960 + Math.cos(a + t * .12) * r;
    const y = 540 + Math.sin(a + t * .12) * r * .82;
    o += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(1.1 + hsh(i * 2.2) * 2.0)}"
      fill="${i % 9 === 0 ? C.accent : C.gold}" opacity="${f1(.55 * (1 - e * .5))}"/>`;
  }

  o += `<g transform="${T}">
    <path d="${yem.paths[0]}" fill="rgba(201,168,106,${f1(.05 + .22 * lit)})"
      stroke="${C.gold}" stroke-width="${f1(1.6 + 2.2 * lit)}" opacity="${f1(.35 + .62 * lit)}"/>
    <path d="${yem.paths[0]}" fill="none" stroke="${C.gold}" stroke-width="14"
      opacity="${f1(.07 + .13 * lit)}"/>
    <path d="${yem.paths[0]}" fill="none" stroke="#fff" stroke-width="1"
      opacity="${f1(.30 * lit)}" transform="translate(-2,-2)"/>
  </g>`;

  for (let k = 1; k <= 4; k++) {
    const kk = ((t * .5) + k / 4) % 1;
    o += `<ellipse cx="960" cy="540" rx="${f1(240 + kk * 460)}" ry="${f1((240 + kk * 460) * .82)}"
      fill="none" stroke="${C.gold}" stroke-width="1" opacity="${f1(.20 * (1 - kk))}"/>`;
  }
  // a single point of light on the homeland
  o += `<circle cx="960" cy="540" r="${f1(60 + 40 * Math.sin(t * 2))}" fill="${C.gold}"
    opacity="${f1(.05 * lit)}"/>`;
  o += dustField(t, 50, { op: .12, size: 1.5, rise: -30, seed: 71 });
  return o;
}

/* ============================================================== LOGO ========
   End card: the studio mark assembles itself out of its own pixels, then a
   single flash crosses it — "ومض" literally means a flash, so the name is
   what the animation does.
   ========================================================================== */
function artLogo(S) {
  const { t, p } = S;
  const LP = DATA.logo;
  if (!LP) return '';
  const B = S.logoBox;                       // {x,y,w,h}
  const cx = B.x + B.w / 2, cy = B.y + B.h / 2;
  let o = '';

  // ---- embers left over from the film's last frame
  o += dustField(t, 46, { op: .16, size: 1.5, rise: -16, seed: 83 });

  // ---- the assembly
  const n = LP.n;
  const settle = inv(.26, .50, p);           // particles hand over to the PNG
  let parts = '';
  for (let i = 0; i < n; i++) {
    const tx = B.x + LP.x[i] * B.w;
    const ty = B.y + LP.y[i] * B.h;
    const dx0 = tx - cx, dy0 = ty - cy;
    const ang = Math.atan2(dy0, dx0) + (hsh(i * 1.7) - .5) * 1.1;
    const r0 = 560 + hsh(i * 4.3) * 620;
    // stagger: roughly top-left -> bottom-right, with jitter so it never
    // reads as a wipe
    const st = .05 + .30 * (LP.y[i] * .50 + LP.x[i] * .22 + hsh(i * 9.1) * .28);
    const e = easeIO(inv(st, st + .30, p));
    if (e <= 0) continue;
    const swirl = (1 - e) * (1.7 + hsh(i * 2.9) * 1.5);
    const a2 = ang + swirl;
    const rr = r0 * (1 - e);
    const sx = cx + Math.cos(a2) * rr;
    const sy = cy + Math.sin(a2) * rr * .78;
    const x = lerp(sx, tx, e);
    const y = lerp(sy, ty, e);
    const r = 1.15 + (1 - e) * 1.5 + hsh(i * 6.1) * .5;
    let op = (1 - settle) * (.55 + hsh(i * 3.3) * .45);
    op *= Math.min(1, inv(.02, .12, p) * 1.2);
    if (op <= .012) continue;
    parts += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${LP.c[i]}" opacity="${f1(op)}"/>`;
  }
  o += parts;

  // ---- a ring of light closing in on the mark
  const ring = inv(.06, .48, p);
  if (ring < 1) {
    const rr = lerp(620, B.w * .62, easeIO(ring));
    o += `<ellipse cx="${cx}" cy="${cy}" rx="${f1(rr)}" ry="${f1(rr * .8)}" fill="none"
      stroke="${C.gold}" stroke-width="${f1(1.6 * (1 - ring) + .4)}"
      opacity="${f1(.34 * (1 - ring * .55))}"/>`;
  }

  // ---- hairline frame + caption rule
  const fr = inv(.50, .72, p);
  if (fr > 0) {
    const pad = 46;
    const x0 = cx - (B.w / 2 + pad), x1 = cx + (B.w / 2 + pad);
    const yA = B.y - pad, yB = B.y + B.h + pad + 74;
    o += `<g stroke="${C.paper}" stroke-width="1" opacity="${f1(.16 * fr)}" fill="none">
      <path d="M ${f1(x0)} ${f1(lerp(yA, yA - 0, fr))} L ${f1(lerp(cx, x0, easeOut(fr)))} ${f1(yA)}"/>
      <path d="M ${f1(x1)} ${f1(yA)} L ${f1(lerp(cx, x1, easeOut(fr)))} ${f1(yA)}"/>
    </g>`;
    // kept clear of the caption, which the zoom-in camera drifts downward
    const rule = easeOut(inv(.62, .84, p));
    const ruleY = 788;
    o += `<line x1="${f1(cx - 190 * rule)}" y1="${f1(ruleY)}" x2="${f1(cx + 190 * rule)}" y2="${f1(ruleY)}"
      stroke="${C.gold}" stroke-width="1.6" opacity="${f1(.72 * rule)}"/>`;
  }

  // ---- the flash that names the studio, masked to the mark.
  // Done in SVG, not CSS: a CSS mask-image blanked the whole layer in
  // headless Chromium (verified by isolating the element).
  const sw = inv(.42, .64, p);
  const fop = Math.sin(clamp(sw, 0, 1) * Math.PI);
  if (fop > .01) {
    const gw = B.w * 2.8;
    const coreX = lerp(B.x + 1.30 * B.w, B.x - 0.30 * B.w, sw);
    const rx = coreX - 1.4 * B.w;
    o += `<defs>
      <mask id="logomask" maskUnits="userSpaceOnUse" style="mask-type:alpha"
            x="${f1(B.x)}" y="${f1(B.y)}" width="${f1(B.w)}" height="${f1(B.h)}">
        <image href="../assets/brand/wamd_logo.png" x="${f1(B.x)}" y="${f1(B.y)}"
               width="${f1(B.w)}" height="${f1(B.h)}" preserveAspectRatio="none"/>
      </mask>
      <linearGradient id="flashgrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset=".38" stop-color="#fff" stop-opacity="0"/>
        <stop offset=".45" stop-color="#fff" stop-opacity=".14"/>
        <stop offset=".50" stop-color="#fff" stop-opacity=".95"/>
        <stop offset=".55" stop-color="#fff" stop-opacity=".14"/>
        <stop offset=".62" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <g mask="url(#logomask)" opacity="${f1(fop)}">
      <g transform="rotate(-9 ${f1(cx)} ${f1(cy)})">
        <rect x="${f1(rx)}" y="${f1(B.y - B.h * .25)}" width="${f1(gw)}" height="${f1(B.h * 1.5)}"
              fill="url(#flashgrad)"/>
      </g>
    </g>`;
  }

  // ---- a slow breathing glow behind the mark
  const glow = inv(.40, 1, p) * (.5 + .5 * Math.sin(t * 1.5));
  o += `<circle cx="${cx}" cy="${cy}" r="${f1(B.h * .95)}" fill="${C.gold}"
    opacity="${f1(.028 * glow)}"/>`;
  return o;
}

const ART = {
  title: artTitle, desert: artDesert, heart: artHeart, collage: artCollage,
  brutalist: artBrutalist, split3: artSplit3, tear: artTear, bridge: artBridge,
  final: artFinal, logo: artLogo,
};

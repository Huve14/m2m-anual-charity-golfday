/* <golf-stage> — Glendower Golf Club, the 2nd hole.
   Layout modelled from the club yardage book + satellite imagery:
   351 / 332 / 269 m par 4, elevated tee, forced carry over the dam, a stream down
   the left the whole way, straight tree-lined corridor climbing to a big pear-shaped
   green with one bunker off its right shoulder.

   Metres. Back tee at the origin, play direction -Z, player's left is -X.
   Two camera views: 0 TEE macro · 1 drone flyover.
   mode="explore" gives free orbit + a tee-to-green flythrough.
   Turf, water, sand, sky and ball dimples are all generated procedurally on canvas. */

const THREE_URL = '/vendor/three.module.js';

/* ---------- small maths helpers ---------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
// Yield so the browser can paint between expensive builds. rAF alone is unsafe here:
// in a hidden or throttled frame it may never fire, which would stall boot forever.
const chan = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const frame = () => new Promise(r => {
  let done = false;
  const go = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(() => setTimeout(go, 0));
  setTimeout(go, 80);
  // a hidden or frozen frame fires neither rAF nor timers; a channel task still lands,
  // so the scene always finishes building instead of stalling half-made
  if (chan) { chan.port1.onmessage = go; chan.port2.postMessage(0); }
});
const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* value-noise on a lattice, seeded, with fbm */
function makeNoise(seed) {
  const rnd = mulberry(seed);
  const S = 256, g = new Float32Array(S * S);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const at = (x, y) => g[(y & 255) * S + (x & 255)];
  const n2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = smooth(x - xi), ty = smooth(y - yi);
    return lerp(lerp(at(xi, yi), at(xi + 1, yi), tx), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), tx), ty);
  };
  return (x, y, oct = 4, lac = 2, gain = 0.5) => {
    let a = 0.5, f = 1, s = 0, norm = 0;
    for (let o = 0; o < oct; o++) { s += a * n2(x * f, y * f); norm += a; a *= gain; f *= lac; }
    return s / norm;
  };
}

/* piecewise-smooth curve through [key, value] control points */
function track(pts, t) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [a, va] = pts[i - 1], [b, vb] = pts[i];
    if (t <= b) return lerp(va, vb, smooth((t - a) / (b - a)));
  }
  return pts[pts.length - 1][1];
}

/* ================= HOLE 2 — LAYOUT ================= */

const HOLE_LEN = 351;                                  // back tee to green centre
const TEES = [
  { n: 1, m: 351, x: 0.0, z: 0, hw: 7.0, hl: 13.0, col: 0xf3c518 },
  { n: 2, m: 332, x: -1.2, z: -19, hw: 6.0, hl: 10.0, col: 0xc8102e },
  { n: 3, m: 269, x: 15.6, z: -85, hw: 5.2, hl: 8.0, col: 0x1f63c8 }
];
const GREEN = { x: 0.5, z: -351, rx: 12.2, rz: 15.0, rot: -0.14 };
const BUNKERS = [{ x: 19.0, z: -355, rx: 6.0, rz: 8.4, rot: 0.30 }];
const WY = -4.0;                                        // dam water level
const DAM = { x: -34, z: -75, rx: 46, rz: 27, rot: 0.12 };
const DAM2 = { x: -63, z: -57, rx: 25, rz: 15, rot: -0.40 };  // near-left lobe
const ARM = { x: 17, z: -70, rx: 12, rz: 4.6, rot: 0.06 };   // channel by the 3rd tee
const ISLE = { x: -24, z: -77, rx: 7, rz: 4.5, rot: 0.3 };   // reed island
const BRIDGE = { x: 17, z0: -63.5, z1: -76.5 };
/* fairway half-width along the hole, keyed on metres from the back tee */
const FW = [[90, 8], [104, 12.5], [130, 15.5], [170, 16.5], [215, 14.5], [265, 12.5], [310, 13.5], [340, 16], [372, 12]];
/* height above the tee, keyed on metres from the back tee */
const PROF = [[-45, 1.4], [0, 0], [30, -1.0], [58, -3.05], [95, -2.95], [135, -0.5], [200, 1.5], [270, 2.9], [330, 4.1], [351, 4.5], [420, 3.8]];

const nH = makeNoise(20260922);
const nW = makeNoise(8812);

const profileY = z => track(PROF, -z);
const fwHalf = z => track(FW, -z);
/* dead straight to the eye — a 1.6 m bow is all the corridor has */
const fairwayX = z => Math.sin(clamp(-z / HOLE_LEN, 0, 1) * Math.PI) * 1.6;

/* normalised radius inside a rotated ellipse: 1 at the edge */
function ellip(x, z, e) {
  const dx = x - e.x, dz = z - e.z, cs = Math.cos(e.rot || 0), sn = Math.sin(e.rot || 0);
  return Math.hypot((dx * cs + dz * sn) / e.rx, (-dx * sn + dz * cs) / e.rz);
}

/* > 0 inside the dam. Ragged shoreline, island punched back out. */
function damField(x, z) {
  let w = Math.max(1 - ellip(x, z, DAM), 1 - ellip(x, z, DAM2), 1 - ellip(x, z, ARM));
  if (w > -0.6) w += (nW(x * 0.05 + 3, z * 0.05, 2) - 0.5) * 0.14 + (nW(x * 0.15 + 9, z * 0.15, 2) - 0.5) * 0.07;
  const isl = ellip(x, z, ISLE);
  if (isl < 1.5) w -= (1 - smooth(clamp((isl - 1) / 0.4, 0, 1))) * 1.3;
  return w;
}

/* the stream: down the left rough from behind the green into the top of the dam */
const streamX = z => lerp(-38, -17.6, smooth(clamp((-z - 100) / 260, 0, 1))) + Math.sin(-z * 0.045) * 3.2;
const hasStream = z => -z > 94 && -z < 382;
const streamY = z => Math.max(WY + 0.06, profileY(z) - 1.15);

function terrainY(x, z) {
  const d = -z;
  const fh = fwHalf(z), fd = Math.abs(x - fairwayX(z));
  const inFw = fh > 0 ? 1 - smooth(clamp((fd - fh) / 8, 0, 1)) : 0;
  const w = damField(x, z);
  const nearW = smooth(clamp((w + 0.55) / 0.55, 0, 1));                // 1 at the water

  let y = profileY(z);
  y += (nH(x * 0.026 + 10, z * 0.026 + 4, 4) - 0.5) * 2 * lerp(3.2, 0.9, inFw) * (1 - 0.75 * nearW);
  y += (nH(x * 0.16, z * 0.16, 3) - 0.5) * 0.34 * (1 - inFw * 0.55);
  y += (nH(x * 0.55, z * 0.55, 2) - 0.5) * 0.10;

  // green: raised pad, back higher than front, tilting off toward the stream
  const gk = 1 - smooth(clamp((ellip(x, z, GREEN) - 1) / 0.52, 0, 1));
  if (gk > 0) {
    const top = profileY(GREEN.z) + 1.0 + (x - GREEN.x) * 0.030 - (z - GREEN.z) * 0.032
      + (nH(x * 0.34 + 60, z * 0.34, 2) - 0.5) * 0.22;
    y = lerp(y, top, gk);
  }
  // bunker: dished, with a grass lip on the outside
  for (const b of BUNKERS) {
    const r = ellip(x, z, b);
    if (r < 1.9) {
      const k = 1 - smooth(clamp((r - 0.92) / 0.30, 0, 1));
      y += -1.5 * k + Math.exp(-Math.pow((r - 1.12) / 0.22, 2)) * 0.5;
    }
  }
  // tee pads, mown flat
  for (const t of TEES) {
    const k = 1 - smooth(clamp((Math.max(Math.abs(x - t.x) / t.hw, Math.abs(z - t.z) / t.hl) - 1) / 0.45, 0, 1));
    if (k > 0) y = lerp(y, t.n === 1 ? 0 : profileY(t.z) + (t.n === 3 ? 0.75 : 0.15), k);
  }
  // stream channel
  if (hasStream(z)) {
    const ends = smooth(clamp((d - 94) / 12, 0, 1)) * smooth(clamp((382 - d) / 12, 0, 1));
    const sk = smooth(clamp(1 - Math.abs(x - streamX(z)) / 5.2, 0, 1)) * ends;
    if (sk > 0) y -= sk * 2.2;
  }
  // the dam basin wins over everything
  if (w > -0.18) y = lerp(y, WY - 2.5, smooth(clamp((w + 0.18) / 0.18, 0, 1)));
  return y;
}

/* land beyond the detailed plane: exact match at the rim, rising into a wooded ridge
   so the aerial never shows an edge */
function landY(x, z) {
  const cx = clamp(x, TEX.minX, TEX.maxX), cz = clamp(z, TEX.minZ, TEX.maxZ);
  const out = Math.hypot(x - cx, z - cz);
  const base = terrainY(cx, cz);
  if (out < 0.01) return base;
  return base + out * 0.05 + (nH(x * 0.021 + 30, z * 0.021, 4) - 0.5) * Math.min(out, 90) * 0.30;
}

/* cart path, right side of the hole, over the bridge and past the 3rd tee */
const PATH = [[23, 46], [22, 10], [20, -28], [18.4, -54], [17, -62],
  /* bridge */[17, -78], [16.4, -90], [19, -100], [21.5, -118], [22.5, -170],
[21.5, -235], [21, -300], [23, -332], [29, -352], [27, -370], [18, -382]];
const PATH_SPUR = [[21.4, -112], [8, -106], [-8, -103], [-20, -101]];

/* ---------- textures ---------- */

/* Equirect normal + roughness maps for a real golf-ball dimple pattern. */
function dimpleMaps(THREE, W = 1024, H = 512, N = 372) {
  const ga = Math.PI * (3 - Math.sqrt(5));
  const pts = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), th = ga * i;
    const p = [Math.cos(th) * r, y, Math.sin(th) * r];
    p.push(Math.acos(clamp(y, -1, 1)));
    pts.push(p);
  }
  const R = 0.101, cosR = Math.cos(R), R2 = R * R;
  const B = 96, band = [];
  for (let i = 0; i < B; i++) band.push([]);
  for (const p of pts) {
    const c = Math.floor(p[3] / Math.PI * B);
    const span = Math.ceil(R / (Math.PI / B)) + 1;
    for (let k = c - span; k <= c + span; k++) if (k >= 0 && k < B) band[k].push(p);
  }
  const h = new Float32Array(W * H);
  for (let py = 0; py < H; py++) {
    const phi = (py + 0.5) / H * Math.PI, sp = Math.sin(phi), cp = Math.cos(phi);
    const cand = band[clamp(Math.floor(phi / Math.PI * B), 0, B - 1)];
    for (let px = 0; px < W; px++) {
      const th = (px + 0.5) / W * Math.PI * 2;
      const dx = sp * Math.cos(th), dy = cp, dz = sp * Math.sin(th);
      let best = 0;
      for (let i = 0; i < cand.length; i++) {
        const p = cand[i];
        const dot = dx * p[0] + dy * p[1] + dz * p[2];
        if (dot > cosR) {
          const t = 1 - (2 * (1 - dot)) / R2;
          if (t > best) best = t;
        }
      }
      h[py * W + px] = best;
    }
  }
  const nc = document.createElement('canvas'); nc.width = W; nc.height = H;
  const rc = document.createElement('canvas'); rc.width = W; rc.height = H;
  const nctx = nc.getContext('2d'), rctx = rc.getContext('2d');
  const nd = nctx.createImageData(W, H), rd = rctx.createImageData(W, H);
  const DEPTH = 2.35;
  for (let py = 0; py < H; py++) {
    const phi = (py + 0.5) / H * Math.PI;
    const xs = 1 / Math.max(Math.sin(phi), 0.22);
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      const l = h[py * W + ((px - 1 + W) % W)], r = h[py * W + ((px + 1) % W)];
      const u = h[Math.max(0, py - 1) * W + px], dn = h[Math.min(H - 1, py + 1) * W + px];
      let gx = (l - r) * DEPTH * xs, gy = (u - dn) * DEPTH;
      const len = Math.hypot(gx, gy, 1);
      nd.data[i * 4] = Math.round((gx / len * 0.5 + 0.5) * 255);
      nd.data[i * 4 + 1] = Math.round((gy / len * 0.5 + 0.5) * 255);
      nd.data[i * 4 + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      nd.data[i * 4 + 3] = 255;
      const rough = 190 + h[i] * 46;
      rd.data[i * 4] = rd.data[i * 4 + 1] = rd.data[i * 4 + 2] = rough;
      rd.data[i * 4 + 3] = 255;
    }
  }
  nctx.putImageData(nd, 0, 0); rctx.putImageData(rd, 0, 0);
  const mk = cv => { const t = new THREE.CanvasTexture(cv); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
  return { normal: mk(nc), rough: mk(rc) };
}

/* white ball with a small crimson M2M stamp */
function ballColorMap(THREE) {
  const W = 1024, H = 512, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#fffdfc'; x.fillRect(0, 0, W, H);
  x.save();
  x.translate(W * 0.30, H * 0.52); x.rotate(-0.06);
  x.fillStyle = '#c8102e';
  x.font = '700 62px Montserrat, Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('M2M', 0, -16);
  x.fillStyle = '#a70b24';
  x.font = '600 17px Montserrat, Arial, sans-serif';
  x.letterSpacing = '4px';
  x.fillText('GOLF DAY', 0, 26);
  x.fillRect(-46, 40, 92, 2.4);
  x.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/* dawn sky, equirect — drives every reflection in the scene */
function skyCanvas() {
  const W = 2048, H = 1024, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.00, '#0e1116');
  g.addColorStop(0.22, '#1d2430');
  g.addColorStop(0.40, '#3c4250');
  g.addColorStop(0.478, '#8a7a75');
  g.addColorStop(0.498, '#e0a074');
  g.addColorStop(0.507, '#8d6a52');
  g.addColorStop(0.60, '#2b2a26');
  g.addColorStop(1.00, '#141312');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const sx = W * 0.5, sy = H * 0.487;
  const sun = x.createRadialGradient(sx, sy, 0, sx, sy, W * 0.20);
  sun.addColorStop(0, 'rgba(255,244,226,1)');
  sun.addColorStop(0.05, 'rgba(255,214,163,0.95)');
  sun.addColorStop(0.24, 'rgba(255,163,104,0.34)');
  sun.addColorStop(1, 'rgba(255,140,90,0)');
  x.fillStyle = sun; x.fillRect(0, 0, W, H);
  const n = makeNoise(77);
  x.globalAlpha = 0.20;
  for (let i = 0; i < 190; i++) {
    const px = Math.random() * W, py = H * (0.10 + Math.random() * 0.31);
    const w = 90 + Math.random() * 420, hh = 8 + Math.random() * 30;
    const v = n(px * 0.01, py * 0.02, 3);
    x.fillStyle = `rgba(${190 + v * 60 | 0},${180 + v * 55 | 0},${180 + v * 50 | 0},${0.05 + v * 0.14})`;
    x.beginPath(); x.ellipse(px, py, w, hh, 0, 0, 6.284); x.fill();
  }
  x.globalAlpha = 1;
  return c;
}

/* the whole hole, painted: rough, mown corridor, green, sand, dam bed, paths */
const TEX = { minX: -100, maxX: 100, minZ: -405, maxZ: 55, W: 1024, H: 2048 };
const TW = TEX.maxX - TEX.minX, TL = TEX.maxZ - TEX.minZ;
const toPx = (X, Z) => [(X - TEX.minX) / TW * TEX.W, (Z - TEX.minZ) / TL * TEX.H];

function courseMap(THREE) {
  const { W, H } = TEX;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const nR = makeNoise(4242), nF = makeNoise(909);
  const PPM = W / TW;                                            // px per metre

  // base rough, generated coarse and scaled up (parkland rough is soft anyway)
  const BW = 256, BH = 512;
  const bc = document.createElement('canvas'); bc.width = BW; bc.height = BH;
  const bx = bc.getContext('2d');
  const id = bx.createImageData(BW, BH);
  for (let py = 0; py < BH; py++) {
    for (let px = 0; px < BW; px++) {
      const X = TEX.minX + px / BW * TW, Z = TEX.minZ + py / BH * TL;
      const m = nR(X * 0.055, Z * 0.055, 4), f = nR(X * 0.35 + 5, Z * 0.35, 2);
      const shade = clamp((Math.abs(X - fairwayX(Z)) - 21) / 26, 0, 1);   // under the trees
      let r = 46 + m * 26 + f * 12, g = 70 + m * 32 + f * 14, b = 34 + m * 16 + f * 8;
      const i = (py * BW + px) * 4;
      id.data[i] = r * (1 - shade * 0.66); id.data[i + 1] = g * (1 - shade * 0.46);
      id.data[i + 2] = b * (1 - shade * 0.5); id.data[i + 3] = 255;
    }
  }
  bx.putImageData(id, 0, 0);
  x.imageSmoothingEnabled = true;
  x.drawImage(bc, 0, 0, W, H);

  // rough mottle
  x.globalAlpha = 0.3;
  for (let i = 0; i < 14000; i++) {
    const px = Math.random() * W, py = Math.random() * H;
    const v = nF(px * 0.05, py * 0.05, 2);
    x.fillStyle = v > 0.5 ? 'rgba(104,136,68,0.45)' : 'rgba(34,52,26,0.5)';
    x.fillRect(px, py, 2 + v * 7, 2 + v * 5);
  }
  x.globalAlpha = 1;

  // ---- helpers ----
  const corridor = (from, to, off) => {
    x.beginPath();
    for (let Z = -from; Z >= -to; Z -= 1.5) { const [a, b] = toPx(fairwayX(Z) - fwHalf(Z) - off, Z); Z === -from ? x.moveTo(a, b) : x.lineTo(a, b); }
    for (let Z = -to; Z <= -from; Z += 1.5) { const [a, b] = toPx(fairwayX(Z) + fwHalf(Z) + off, Z); x.lineTo(a, b); }
    x.closePath();
  };
  const ellipsePath = (e, k = 1) => {
    x.beginPath();
    for (let a = 0; a <= 6.30; a += 0.05) {
      const wob = 1 + (nR(Math.cos(a) * 1.5 + e.x, Math.sin(a) * 1.5 + e.z, 2) - 0.5) * 0.20;
      const u = Math.cos(a) * e.rx * k * wob, v = Math.sin(a) * e.rz * k * wob;
      const cs = Math.cos(e.rot || 0), sn = Math.sin(e.rot || 0);
      const [px, py] = toPx(e.x + u * cs - v * sn, e.z + u * sn + v * cs);
      a === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
    }
    x.closePath();
  };
  const polyline = (pts, wm, style) => {
    x.strokeStyle = style; x.lineWidth = wm * PPM; x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath();
    pts.forEach((p, i) => { const [a, b] = toPx(p[0], p[1]); i ? x.lineTo(a, b) : x.moveTo(a, b); });
    x.stroke();
  };

  // ---- semi-rough collar, then the mown corridor ----
  x.save(); corridor(88, 374, 4.2); x.fillStyle = 'rgba(44,64,32,0.75)'; x.fill(); x.restore();

  x.save(); corridor(90, 372, 0); x.clip();
  const fg = x.createLinearGradient(0, 0, 0, H);
  fg.addColorStop(0, '#638547'); fg.addColorStop(1, '#587c40');
  x.fillStyle = fg; x.fillRect(0, 0, W, H);
  for (let X = -20; X <= 20; X += 4.4) {                          // lengthwise mowing bands
    const [ax] = toPx(X, 0), [bx2] = toPx(X + 4.4, 0);
    x.fillStyle = ((X / 4.4) | 0) % 2 ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.045)';
    x.fillRect(ax, 0, bx2 - ax, H);
  }
  x.globalAlpha = 0.26;
  for (let i = 0; i < 9000; i++) {
    const px = Math.random() * W, py = Math.random() * H;
    const v = nF(px * 0.04 + 11, py * 0.04, 2);
    x.fillStyle = v > 0.5 ? 'rgba(134,168,90,0.5)' : 'rgba(62,88,42,0.5)';
    x.fillRect(px, py, 2 + v * 6, 1 + v * 3);
  }
  x.globalAlpha = 1;
  x.restore();

  // ---- green: apron, putting surface, cross-mow, cup ----
  x.save(); ellipsePath(GREEN, 1.34); x.fillStyle = '#5f8244'; x.fill(); x.restore();
  x.save(); ellipsePath(GREEN, 1.10); x.fillStyle = '#6d9450'; x.fill(); x.restore();
  x.save();
  ellipsePath(GREEN, 1); x.clip();
  x.fillStyle = '#84a95c'; x.fillRect(0, 0, W, H);
  const [gpx, gpy] = toPx(GREEN.x, GREEN.z), grp = GREEN.rz * 1.4 * PPM;
  for (let i = -30; i < 30; i++) {
    x.fillStyle = i % 2 ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.04)';
    x.fillRect(gpx - grp, gpy + i * 1.1 * PPM, grp * 2, 1.1 * PPM);
  }
  x.globalAlpha = 0.22;
  for (let i = 0; i < 2600; i++) {
    const a = Math.random() * 6.283, r = Math.sqrt(Math.random());
    x.fillStyle = Math.random() > 0.5 ? 'rgba(160,196,112,0.6)' : 'rgba(96,128,64,0.5)';
    x.fillRect(gpx + Math.cos(a) * r * grp, gpy + Math.sin(a) * r * grp * 0.9, 2, 2);
  }
  x.globalAlpha = 1;
  x.restore();
  const [cupx, cupy] = toPx(GREEN.x + 0.6, GREEN.z + 1.0);
  x.beginPath(); x.ellipse(cupx, cupy, 0.108 * PPM * 1.6, 0.108 * PPM * 1.4, 0, 0, 6.284);
  x.fillStyle = '#12160e'; x.fill();

  // ---- bunker ----
  for (const b of BUNKERS) {
    x.save();
    ellipsePath(b, 1.06);
    x.strokeStyle = 'rgba(44,62,30,0.7)'; x.lineWidth = 0.45 * PPM; x.stroke();
    x.fillStyle = '#d5bf95'; x.fill(); x.clip();
    const [bx2, by2] = toPx(b.x, b.z);
    const sg = x.createLinearGradient(bx2 - b.rx * PPM, by2, bx2 + b.rx * PPM, by2);
    sg.addColorStop(0, 'rgba(255,248,228,0.42)'); sg.addColorStop(1, 'rgba(150,128,92,0.5)');
    x.fillStyle = sg; x.fillRect(0, 0, W, H);
    x.globalAlpha = 0.4;
    for (let i = 0; i < 1400; i++) {
      const a = Math.random() * 6.283, r = Math.sqrt(Math.random());
      x.fillStyle = Math.random() > 0.5 ? 'rgba(255,252,240,0.6)' : 'rgba(176,154,116,0.5)';
      x.fillRect(bx2 + Math.cos(a) * r * b.rx * PPM, by2 + Math.sin(a) * r * b.rz * PPM, 3, 2);
    }
    x.restore();
  }

  // ---- tee pads ----
  for (const t of TEES) {
    const [tx, ty] = toPx(t.x, t.z);
    const hw = t.hw * PPM, hl = t.hl * PPM;
    x.save();
    x.beginPath(); x.rect(tx - hw, ty - hl, hw * 2, hl * 2); x.clip();
    x.fillStyle = '#6d9049'; x.fillRect(0, 0, W, H);
    for (let i = -20; i < 20; i++) {
      x.fillStyle = i % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.045)';
      x.fillRect(tx - hw + i * 1.1 * PPM, ty - hl, 1.1 * PPM, hl * 2);
    }
    x.restore();
    x.save();
    x.beginPath(); x.rect(tx - hw, ty - hl, hw * 2, hl * 2);
    x.strokeStyle = 'rgba(40,58,28,0.5)'; x.lineWidth = 0.5 * PPM; x.stroke();
    x.restore();
  }

  // ---- dam bed + stream bed (mostly under water, read through the shallows) ----
  x.save();
  ellipsePath(DAM, 1.02); x.fillStyle = '#2a2f22'; x.fill();
  ellipsePath(DAM2, 1.02); x.fillStyle = '#2a2f22'; x.fill();
  ellipsePath(ARM, 1.02); x.fillStyle = '#2a2f22'; x.fill();
  ellipsePath(ISLE, 1.12); x.fillStyle = '#3d4a28'; x.fill();
  x.restore();
  {
    const pts = [];
    for (let d = 96; d <= 380; d += 4) pts.push([streamX(-d), -d]);
    polyline(pts, 5.4, 'rgba(38,46,30,0.9)');
    polyline(pts, 2.6, '#232b21');
  }

  // ---- cart paths ----
  polyline(PATH.slice(0, 5), 3.4, 'rgba(46,56,34,0.75)');
  polyline(PATH.slice(5), 3.4, 'rgba(46,56,34,0.75)');
  polyline(PATH.slice(0, 5), 2.5, '#9b9077');
  polyline(PATH.slice(5), 2.5, '#9b9077');
  polyline(PATH_SPUR, 3.2, 'rgba(46,56,34,0.7)');
  polyline(PATH_SPUR, 2.3, '#9b9077');

  // 150 m plate, mid-fairway
  const [mx, my] = toPx(fairwayX(-201), -201);
  x.beginPath(); x.ellipse(mx, my, 0.55 * PPM, 0.5 * PPM, 0, 0, 6.284);
  x.fillStyle = '#e8e3d6'; x.fill();

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 16;
  return map;
}

/* tight, high-detail turf right around the back tee (the ground map is 20 cm/px) */
function teePatchMaps(THREE) {
  const S = 1024, PATCH = 9;
  const cc = document.createElement('canvas'); cc.width = cc.height = S;
  const nc = document.createElement('canvas'); nc.width = nc.height = S;
  const ac = document.createElement('canvas'); ac.width = ac.height = 512;
  const cx = cc.getContext('2d'), nx = nc.getContext('2d'), ax = ac.getContext('2d');
  const n = makeNoise(31337);
  const cd = cx.createImageData(S, S), nd = nx.createImageData(S, S);
  const hh = new Float32Array(S * S);
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const u = px / S * PATCH, v = py / S * PATCH;
      const blade = n(u * 46, v * 46, 2);
      const clump = n(u * 5.5 + 3, v * 5.5, 4);
      const stripe = ((Math.floor(v / 1.1) % 2) ? 1 : 0) * 0.055;
      const shade = n(u * 130, v * 18, 2);
      const k = blade * 0.55 + clump * 0.45;
      const i = (py * S + px) * 4;
      cd.data[i] = 52 + k * 46 + stripe * 120 + shade * 16;
      cd.data[i + 1] = 78 + k * 62 + stripe * 150 + shade * 20;
      cd.data[i + 2] = 38 + k * 30 + stripe * 90 + shade * 10;
      cd.data[i + 3] = 255;
      hh[py * S + px] = k * 0.7 + shade * 0.3;
    }
  }
  cx.putImageData(cd, 0, 0);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const i = py * S + px;
    const l = hh[py * S + Math.max(0, px - 1)], r = hh[py * S + Math.min(S - 1, px + 1)];
    const u = hh[Math.max(0, py - 1) * S + px], d2 = hh[Math.min(S - 1, py + 1) * S + px];
    let gx = (l - r) * 5.5, gy = (u - d2) * 5.5;
    const len = Math.hypot(gx, gy, 1);
    nd.data[i * 4] = (gx / len * 0.5 + 0.5) * 255;
    nd.data[i * 4 + 1] = (gy / len * 0.5 + 0.5) * 255;
    nd.data[i * 4 + 2] = (1 / len * 0.5 + 0.5) * 255;
    nd.data[i * 4 + 3] = 255;
  }
  nx.putImageData(nd, 0, 0);
  const ag = ax.createRadialGradient(256, 256, 40, 256, 256, 250);
  ag.addColorStop(0, '#fff'); ag.addColorStop(0.62, '#fff'); ag.addColorStop(1, '#000');
  ax.fillStyle = ag; ax.fillRect(0, 0, 512, 512);
  const map = new THREE.CanvasTexture(cc); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 16;
  const nrm = new THREE.CanvasTexture(nc); nrm.anisotropy = 16;
  const alpha = new THREE.CanvasTexture(ac);
  return { map, nrm, alpha, PATCH };
}

/* seamless-ish rough tile for the land beyond the mapped hole */
function roughTile(THREE) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const n = makeNoise(6161);
  const d = x.createImageData(S, S);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const u = px / S * 6, v = py / S * 6;
    const m = n(u, v, 4), f = n(u * 7 + 3, v * 7, 2);
    const i = (py * S + px) * 4;
    d.data[i] = 58 + m * 40 + f * 20;
    d.data[i + 1] = 82 + m * 50 + f * 26;
    d.data[i + 2] = 42 + m * 26 + f * 14;
    d.data[i + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* milled face grooves for the driver */
function grooveNormal(THREE) {
  const W = 512, H = 512, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = 'rgb(128,128,255)'; x.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 11) {
    x.fillStyle = 'rgb(128,186,214)'; x.fillRect(0, y, W, 2);
    x.fillStyle = 'rgb(128,70,214)'; x.fillRect(0, y + 3, W, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

/* tiling ripple normal for the dam */
function rippleNormal(THREE) {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const n = makeNoise(5150);
  const h = new Float32Array(S * S);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const u = px / S * 8, v = py / S * 8;
    h[py * S + px] = n(u * 2.2, v * 5.5, 3) * 0.7 + Math.sin(v * 9 + n(u, v, 2) * 5) * 0.15;
  }
  const d = x.createImageData(S, S);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const i = py * S + px;
    const l = h[py * S + ((px - 1 + S) % S)], r = h[py * S + ((px + 1) % S)];
    const u = h[((py - 1 + S) % S) * S + px], dn = h[((py + 1) % S) * S + px];
    let gx = (l - r) * 2.6, gy = (u - dn) * 2.6;
    const len = Math.hypot(gx, gy, 1);
    d.data[i * 4] = (gx / len * 0.5 + 0.5) * 255;
    d.data[i * 4 + 1] = (gy / len * 0.5 + 0.5) * 255;
    d.data[i * 4 + 2] = (1 / len * 0.5 + 0.5) * 255;
    d.data[i * 4 + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 3);
  t.anisotropy = 8;
  return t;
}

/* ---------- shots ---------- */
const MACRO = { exp: 1.06, env: 0.95, bg: 0.9, fog: 0.0125, sun: 3.5, fill: 0.62 };
const AERIAL = { exp: 1.38, env: 1.42, bg: 1.05, fog: 0.0028, sun: 4.1, fill: 0.92 };
const SHOTS = [
  { key: 'tee', pos: [0.215, 0.104, 0.215], tgt: [-0.112, 0.064, -0.018], fov: 33, shadow: 1.1, drift: 0.009, grade: MACRO },
  { key: 'flyover', orbit: true, fov: 42, shadow: 210, drift: 0, grade: AERIAL }
];
const SUN_DIR = [-0.40, 0.33, -0.85];      // from beyond the green, left — long morning shadows
const MID = -175;                          // mid-hole, the aerial pivot

/* endless drone orbit over the hole — loops with no cut, so it can sit under a whole page */
function orbitPose(T) {
  const tgt = [0, 2, MID];
  const th = 1.15 + T * 0.010;
  const dist = 250 + Math.sin(T * 0.05) * 34;
  const phi = 1.02 + Math.sin(T * 0.034) * 0.07;
  const sp = Math.sin(phi);
  return {
    pos: [tgt[0] + dist * sp * Math.cos(th), tgt[1] + dist * Math.cos(phi), tgt[2] + dist * sp * Math.sin(th)],
    tgt
  };
}

const FLY_SECONDS = 32;

/* camera down the line of play, u = 0 behind the back tee, 1 settled at the green */
function flyPose(u) {
  if (u < 0.74) {
    const t = u / 0.74;
    const z = lerp(26, -300, t);
    const x = fairwayX(z) + Math.sin(t * Math.PI * 1.4) * 4.5 * (1 - t * 0.7);
    const h = 7 + Math.sin(Math.min(1, t * 1.25) * Math.PI) * 9 + t * t * 16;
    const zt = z - lerp(70, 40, t);
    const xt = lerp(fairwayX(zt), GREEN.x, smooth(clamp((t - 0.35) / 0.65, 0, 1)));
    return {
      pos: [x, terrainY(x, z) + h, z],
      tgt: [xt, profileY(zt) + 2.6, Math.max(zt, GREEN.z)]
    };
  }
  // settle: swing round the green from the right and look back down the hole
  const t = smooth((u - 0.74) / 0.26);
  const a = lerp(1.62, 0.62, t);
  const r = lerp(58, 40, t);
  const x = GREEN.x + Math.cos(a) * r * 0.9, z = GREEN.z + Math.sin(a) * r;
  return {
    pos: [x, profileY(GREEN.z) + lerp(23, 15, t), z],
    tgt: [GREEN.x, profileY(GREEN.z) + 1.6, GREEN.z - lerp(0, 4, t)]
  };
}

class GolfStage extends HTMLElement {
  constructor() {
    super();
    this._shot = 0;
    this._flying = false;
    this.ready = new Promise(r => (this._resolveReady = r));
  }

  /* ---- explore mode: free orbit + hole flythrough ---- */
  get isExplore() { return this.getAttribute('mode') === 'explore'; }

  startFlythrough() {
    if (!this._cam) return;
    this._flying = true;
    this._flyT0 = performance.now();
    this.dispatchEvent(new CustomEvent('flystate', { detail: { flying: true, progress: 0 } }));
  }

  stopFlythrough() {
    if (!this._flying) return;
    this._flying = false;
    if (this._orbit) {                          // hand the rig the pose we stopped at
      const p = this._cam.position, t = this._orbit.tgt;
      const dx = p.x - t.x, dy = p.y - t.y, dz = p.z - t.z;
      this._orbit.dist = Math.max(20, Math.hypot(dx, dy, dz));
      this._orbit.phi = Math.acos(clamp(dy / this._orbit.dist, -1, 1));
      this._orbit.theta = Math.atan2(dz, dx);
    }
    this.dispatchEvent(new CustomEvent('flystate', { detail: { flying: false, progress: 0 } }));
  }

  resetView() {
    this.stopFlythrough();
    if (this._orbit) Object.assign(this._orbit, { theta: 1.50, phi: 1.09, dist: 268, tgt: { x: 0, y: 1, z: MID } });
  }

  _bindOrbit() {
    this._orbit = { theta: 1.50, phi: 1.09, dist: 268, tgt: { x: 0, y: 1, z: MID } };
    let down = false, lx = 0, ly = 0;
    this.style.touchAction = 'none';
    this.style.cursor = 'grab';
    this.addEventListener('pointerdown', e => {
      down = true; lx = e.clientX; ly = e.clientY;
      this.style.cursor = 'grabbing';
      this.setPointerCapture(e.pointerId);
      this.stopFlythrough();
    });
    this.addEventListener('pointerup', e => {
      down = false; this.style.cursor = 'grab';
      try { this.releasePointerCapture(e.pointerId); } catch (_) {}
    });
    this.addEventListener('pointermove', e => {
      if (!down) return;
      const o = this._orbit;
      o.theta -= (e.clientX - lx) * 0.005;
      o.phi = clamp(o.phi - (e.clientY - ly) * 0.005, 0.14, 1.44);
      lx = e.clientX; ly = e.clientY;
    });
    this.addEventListener('wheel', e => {
      e.preventDefault();
      this._orbit.dist = clamp(this._orbit.dist * (1 + Math.sign(e.deltaY) * 0.09), 26, 620);
    }, { passive: false });
  }

  connectedCallback() {
    if (this._booted) return;
    this._booted = true;
    const cs = getComputedStyle(this);
    if (cs.position === 'static') this.style.position = 'relative';
    this.style.display = 'block';
    this.style.overflow = 'hidden';
    if (!this.style.height) this.style.height = '100%';
    if (!this.style.width) this.style.width = '100%';
    const cv = document.createElement('canvas');
    Object.assign(cv.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      display: 'block', opacity: '0', transition: 'opacity 1.1s cubic-bezier(.2,.7,.2,1)'
    });
    this.appendChild(cv);
    this._cv = cv;
    this._boot().catch(e => { console.error('[golf-stage]', e); this.setAttribute('data-failed', ''); });
  }

  disconnectedCallback() { this._stop = true; this.stopCycle(); if (this._ro) this._ro.disconnect(); }

  /* ---- auto-cycling the cameras ---- */
  startCycle() {
    if (this.isExplore || this._userLocked) return;
    this.stopCycle();
    const dwell = [7000, 15000];
    const step = () => {
      if (this._userLocked) return;
      const next = (this._shot + 1) % SHOTS.length;
      this.setShot(next);
      this._cycleT = setTimeout(step, dwell[next]);
    };
    this._cycleT = setTimeout(step, dwell[this._shot] || 9000);
  }

  stopCycle() { if (this._cycleT) { clearTimeout(this._cycleT); this._cycleT = null; } }

  lockCamera() { this._userLocked = true; this.stopCycle(); }

  get shot() { return this._shot; }
  set shot(v) { this.setShot(v); }

  setShot(i) {
    i = clamp(i | 0, 0, SHOTS.length - 1);
    if (i === this._shot) return;
    this._shot = i;
    this._showMacro(i < 2);
    this._from = { pos: this._camPos.clone(), tgt: this._camTgt.clone(), fov: this._cam.fov };
    this._t0 = performance.now();
    this.dispatchEvent(new CustomEvent('shotchange', { detail: { shot: i, key: SHOTS[i].key } }));
  }

  async _boot() {
    const THREE = await import(THREE_URL);
    this._THREE = THREE;
    const cv = this._cv;

    const renderer = new THREE.WebGLRenderer({
      canvas: cv, antialias: true, powerPreference: 'high-performance',
      logarithmicDepthBuffer: true                       // 4 mm dimples and a 400 m hole in one scene
    });
    const constrained = matchMedia('(max-width: 820px)').matches ||
      (Number(navigator.deviceMemory || 8) <= 4);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, constrained ? 1.3 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this._renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x4b4247, 0.0125);
    this._scene = scene;

    const cam = new THREE.PerspectiveCamera(33, 16 / 9, 0.004, 1600);
    this._cam = cam;
    this._camPos = new THREE.Vector3().fromArray(SHOTS[0].pos);
    this._camTgt = new THREE.Vector3().fromArray(SHOTS[0].tgt);

    /* environment */
    const skyTex = new THREE.CanvasTexture(skyCanvas());
    skyTex.mapping = THREE.EquirectangularReflectionMapping;
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(skyTex).texture;
    scene.environment = env;
    scene.background = skyTex;
    scene.backgroundIntensity = 0.9;
    scene.environmentIntensity = 0.95;
    pmrem.dispose();

    /* light: low morning sun from beyond the green, left */
    const sun = new THREE.DirectionalLight(0xffd9ad, 3.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.00015;
    scene.add(sun, sun.target);
    this._sun = sun;

    const bounce = new THREE.DirectionalLight(0xbfd0e0, 0.42);
    bounce.position.set(6, 4, 12);
    scene.add(bounce);

    const fill = new THREE.DirectionalLight(0xffe4c8, 0.62);
    fill.position.set(9, 6, 14);
    scene.add(fill);
    this._fill = fill;

    await frame();

    /* ---- ground: 200 × 460 m of the hole ---- */
    const gGeo = new THREE.PlaneGeometry(TW, TL, 184, 400);
    gGeo.rotateX(-Math.PI / 2);
    const gp = gGeo.attributes.position;
    const zOff = (TEX.minZ + TEX.maxZ) / 2;
    for (let i = 0; i < gp.count; i++) {
      const X = gp.getX(i), Z = gp.getZ(i) + zOff;
      gp.setZ(i, Z);
      gp.setY(i, terrainY(X, Z));
    }
    gGeo.computeVertexNormals();
    const cmap = courseMap(THREE);
    const ground = new THREE.Mesh(gGeo, new THREE.MeshStandardMaterial({
      map: cmap, roughness: 0.93, metalness: 0, dithering: true
    }));
    ground.receiveShadow = true;
    ground.name = 'ground';
    scene.add(ground);

    await frame();

    /* ---- the dam ---- */
    const ripple = rippleNormal(THREE);
    this._ripple = ripple;
    const waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a3844, roughness: 0.09, metalness: 0,
      normalMap: ripple, normalScale: new THREE.Vector2(0.34, 0.34),
      envMapIntensity: 1.35, transparent: true, opacity: 0.95,
      clearcoat: 0.6, clearcoatRoughness: 0.12
    });
    const WB = { x0: -98, x1: 40, z0: -116, z1: -38 };
    const mw = WB.x1 - WB.x0, ml = WB.z1 - WB.z0;
    {
      const AW = 512, AH = 290;
      const ac = document.createElement('canvas'); ac.width = AW; ac.height = AH;
      const actx = ac.getContext('2d');
      const ad = actx.createImageData(AW, AH);
      for (let py = 0; py < AH; py++) for (let px = 0; px < AW; px++) {
        const X = WB.x0 + px / AW * mw, Z = WB.z0 + py / AH * ml;
        const v = clamp(damField(X, Z) / 0.045, 0, 1);
        const i = (py * AW + px) * 4;
        ad.data[i] = ad.data[i + 1] = ad.data[i + 2] = 255;
        ad.data[i + 3] = v * 255;
      }
      actx.putImageData(ad, 0, 0);
      const alpha = new THREE.CanvasTexture(ac);
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(mw, ml, 1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshPhysicalMaterial({
          color: waterMat.color, roughness: 0.09, metalness: 0,
          normalMap: ripple, normalScale: new THREE.Vector2(0.34, 0.34),
          envMapIntensity: 1.35, transparent: true, alphaMap: alpha,
          clearcoat: 0.6, clearcoatRoughness: 0.12, depthWrite: false
        })
      );
      water.position.set((WB.x0 + WB.x1) / 2, WY, (WB.z0 + WB.z1) / 2);
      water.name = 'dam';
      scene.add(water);
    }

    /* ---- the stream down the left ---- */
    {
      const pos = [], uv = [], idx = [];
      let k = 0;
      for (let d = 94; d <= 382; d += 3) {
        const z = -d, cxs = streamX(z), y = streamY(z);
        const half = 1.35 + Math.sin(d * 0.11) * 0.35;
        pos.push(cxs - half, y, z, cxs + half, y, z);
        uv.push(0, d / 12, 1, d / 12);
        if (d > 94) { idx.push(k - 2, k - 1, k + 1, k - 2, k + 1, k); }
        k += 2;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const stream = new THREE.Mesh(g, waterMat);
      stream.name = 'stream';
      scene.add(stream);
    }

    /* ---- timber footbridge over the channel to the 3rd tee ---- */
    {
      const br = new THREE.Group(); br.name = 'bridge';
      const timber = new THREE.MeshStandardMaterial({ color: 0x6b5540, roughness: 0.86 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x3f3428, roughness: 0.9 });
      const span = BRIDGE.z0 - BRIDGE.z1;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.22, Math.abs(span)), timber);
      deck.position.set(BRIDGE.x, WY + 1.15, (BRIDGE.z0 + BRIDGE.z1) / 2);
      br.add(deck);
      for (let s = -1; s <= 1; s += 2) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, Math.abs(span)), dark);
        rail.position.set(BRIDGE.x + s * 1.05, WY + 2.05, (BRIDGE.z0 + BRIDGE.z1) / 2);
        br.add(rail);
        for (let i = 0; i <= 6; i++) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 0.12), dark);
          post.position.set(BRIDGE.x + s * 1.05, WY + 1.62, lerp(BRIDGE.z0, BRIDGE.z1, i / 6));
          br.add(post);
        }
      }
      for (let i = 1; i <= 2; i++) {
        const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.2, 8), dark);
        pier.position.set(BRIDGE.x, WY - 0.6, lerp(BRIDGE.z0, BRIDGE.z1, i / 3));
        br.add(pier);
      }
      br.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      scene.add(br);
    }

    await frame();

    /* ---- reeds along the water's edge ---- */
    {
      const tuft = new THREE.BufferGeometry();
      const P = [], I = [];
      for (let b = 0; b < 3; b++) {
        const a = b / 3 * Math.PI, cs = Math.cos(a) * 0.09, sn = Math.sin(a) * 0.09;
        const o = P.length / 3;
        P.push(-cs, 0, -sn, cs, 0, sn, cs * 0.25, 1, sn * 0.25, -cs * 0.25, 1, -sn * 0.25);
        I.push(o, o + 1, o + 2, o, o + 2, o + 3);
      }
      tuft.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      tuft.setIndex(I);
      tuft.computeVertexNormals();
      const NR = 3000;
      const reeds = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide
      }), NR);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
      const rr = mulberry(4711);
      let placed = 0, tries = 0;
      while (placed < NR && tries++ < NR * 26) {
        let X, Z;
        if (rr() < 0.66) {                                  // dam shore + reed island
          X = WB.x0 + rr() * mw; Z = WB.z0 + rr() * ml;
          const w = damField(X, Z);
          if (ellip(X, Z, ISLE) > 1.02 && (w < -0.055 || w > 0.045)) continue;
        } else {                                            // stream banks
          const d = 96 + rr() * 284, z = -d;
          Z = z; X = streamX(z) + (rr() < 0.5 ? -1 : 1) * (1.2 + rr() * 1.9);
        }
        const y = terrainY(X, Z);
        if (y < WY - 1.1) continue;
        const s = 0.55 + rr() * 0.85;
        e.set((rr() - 0.5) * 0.3, rr() * 6.2832, (rr() - 0.5) * 0.3);
        m4.compose(new THREE.Vector3(X, y - 0.1, Z), q.setFromEuler(e), new THREE.Vector3(s, s * (0.8 + rr() * 1.1), s));
        reeds.setMatrixAt(placed, m4);
        col.setHSL(0.18 + rr() * 0.09, 0.26 + rr() * 0.16, 0.16 + rr() * 0.10);
        reeds.setColorAt(placed, col);
        placed++;
      }
      reeds.count = placed;
      reeds.instanceMatrix.needsUpdate = true;
      reeds.receiveShadow = true;
      reeds.name = 'reeds';
      scene.add(reeds);
    }

    await frame();

    /* ---- outer land: a wooded ridge that hides the plane's edges ---- */
    {
      const rings = [0, 40, 110, 250], K = 320;
      const perim = (W, ZA, ZB, f) => {
        const w = 2 * W, h = ZA - ZB, L = 2 * w + 2 * h;
        let d = f * L;
        if (d < w) return [-W + d, ZA];
        d -= w; if (d < h) return [W, ZA - d];
        d -= h; if (d < w) return [W - d, ZB];
        d -= w; return [-W, ZB + d];
      };
      const pos = [], col = [], uv = [], idx = [];
      const c1 = new THREE.Color(0xa8c078), c2 = new THREE.Color(0x40542c), tmp = new THREE.Color();
      for (let r = 0; r < rings.length; r++) {
        const d = rings[r];
        for (let i = 0; i <= K; i++) {
          const [X, Z] = perim(TEX.maxX + d, TEX.maxZ + d, TEX.minZ - d, i / K);
          pos.push(X, r === 0 ? terrainY(X, Z) - 0.7 : landY(X, Z), Z);
          uv.push(X / 46, Z / 46);
          tmp.copy(c1).lerp(c2, Math.pow(r / (rings.length - 1), 0.7));
          col.push(tmp.r, tmp.g, tmp.b);
        }
      }
      for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < K; i++) {
        const a = r * (K + 1) + i, b = a + 1, c = a + K + 1, d2 = c + 1;
        idx.push(a, c, d2, a, d2, b);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const nrm = g.attributes.normal;                       // face the sky whichever way it wound
      for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) < 0) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
      const outer = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        map: roughTile(THREE), vertexColors: true, roughness: 0.95, metalness: 0, dithering: true
      }));
      outer.receiveShadow = true;
      outer.name = 'outerLand';
      scene.add(outer);
    }

    /* ---- parkland trees: the reason Glendower looks like Glendower ---- */
    {
      const trunkG = new THREE.CylinderGeometry(0.26, 0.52, 4.4, 7);
      const canopyG = new THREE.IcosahedronGeometry(1, 1);
      const trunkM = new THREE.MeshStandardMaterial({ color: 0x2c2219, roughness: 0.95 });
      const canopyM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
      const NT = 620, NC = NT * 3;
      const trunks = new THREE.InstancedMesh(trunkG, trunkM, NT);
      const canopies = new THREE.InstancedMesh(canopyG, canopyM, NC);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
      const rt = mulberry(555);
      const clear = (X, Z) => {
        if (damField(X, Z) > -0.12) return false;
        if (hasStream(Z) && Math.abs(X - streamX(Z)) < 4.5) return false;
        if (ellip(X, Z, GREEN) < 1.7) return false;
        for (const b of BUNKERS) if (ellip(X, Z, b) < 1.6) return false;
        for (const t of TEES) if (Math.abs(X - t.x) < t.hw + 5 && Math.abs(Z - t.z) < t.hl + 6) return false;
        const fh = -Z > 382 ? 0 : fwHalf(Z);
        if (fh > 0 && Math.abs(X - fairwayX(Z)) < fh + 3.5) return false;
        return true;
      };
      let n = 0, ci = 0, tries = 0, cx = 0, cz = 0, left = 0;
      while (n < NT && tries++ < NT * 70) {
        if (left <= 0) {                                            // trees come in clumps
          const side = rt() < 0.5 ? -1 : 1;
          cz = 120 - rt() * 700;
          cx = fairwayX(clamp(cz, TEX.minZ, TEX.maxZ)) + side * (15 + Math.pow(rt(), 0.62) * 265);
          left = 1 + Math.floor(rt() * 6);
        }
        left--;
        const X = cx + (rt() - 0.5) * 30, Z = cz + (rt() - 0.5) * 30;
        if (!clear(X, Z)) continue;
        const Y = landY(X, Z);
        const near = 1 - clamp((Math.abs(X - fairwayX(Z)) - 19) / 30, 0, 1);
        const s = (0.7 + Math.pow(rt(), 1.7) * 2.4) * lerp(0.92, 1.22, near);   // big specimens at the edge
        const wet = damField(X, Z) > -0.9 || (hasStream(Z) && Math.abs(X - streamX(Z)) < 9);
        m4.compose(new THREE.Vector3(X, Y + 2.2 * s, Z), q.setFromEuler(e.set(0, rt() * 6.28, 0)), new THREE.Vector3(s, s, s));
        trunks.setMatrixAt(n, m4);
        const hue = wet ? 0.235 + rt() * 0.03 : 0.255 + rt() * 0.045;
        const lum = 0.115 + rt() * 0.095;
        for (let b = 0; b < 3; b++) {
          const cs = s * (2.5 + rt() * 1.5), spread = s * 1.5;
          m4.compose(
            new THREE.Vector3(X + (rt() - 0.5) * spread, Y + s * (4.6 + b * 1.5) + (rt() - 0.5) * s, Z + (rt() - 0.5) * spread),
            q.setFromEuler(e.set(rt() * 0.6, rt() * 6.28, rt() * 0.6)),
            new THREE.Vector3(cs, cs * (wet ? 1.15 : 0.78 + rt() * 0.35), cs)
          );
          canopies.setMatrixAt(ci, m4);
          col.setHSL(hue, 0.26 + rt() * 0.18, lum * (b === 2 ? 1.25 : 1));
          canopies.setColorAt(ci, col);
          ci++;
        }
        n++;
      }
      trunks.count = n; canopies.count = ci;
      trunks.instanceMatrix.needsUpdate = true;
      canopies.instanceMatrix.needsUpdate = true;
      canopies.castShadow = true;
      trunks.castShadow = true;
      canopies.receiveShadow = true;
      trunks.name = 'trunks'; canopies.name = 'canopies';
      scene.add(trunks, canopies);
    }

    await frame();

    /* ---- tee markers, one pair per tee, in the book's colours ---- */
    {
      const mg = new THREE.SphereGeometry(0.26, 16, 10);
      for (const t of TEES) {
        const mat = new THREE.MeshPhysicalMaterial({ color: t.col, roughness: 0.35, metalness: 0.05, clearcoat: 0.6 });
        for (const s of [-1, 1]) {
          const X = t.x + s * (t.hw * 0.42), Z = t.z + t.hl * 0.62;
          const m = new THREE.Mesh(mg, mat);
          m.position.set(X, terrainY(X, Z) + 0.17, Z);
          m.scale.y = 0.75;
          m.castShadow = true;
          m.name = `teeMarker${t.n}`;
          scene.add(m);
        }
      }
    }

    /* ---- 150 m post, right edge of the fairway ---- */
    {
      const z = -201, X = fairwayX(z) + fwHalf(z) + 1.6;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.1, 8),
        new THREE.MeshStandardMaterial({ color: 0xe8e3d6, roughness: 0.6 }));
      post.position.set(X, terrainY(X, z) + 0.55, z);
      post.castShadow = true; post.name = 'marker150';
      scene.add(post);
    }

    await frame();

    if (!this.isExplore) {
    /* high-detail turf right at the back tee — only the macro shots use it */
    const tp = teePatchMaps(THREE);
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(tp.PATCH, tp.PATCH, 1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        map: tp.map, normalMap: tp.nrm, normalScale: new THREE.Vector2(1.5, 1.5),
        alphaMap: tp.alpha, transparent: true, roughness: 0.96, metalness: 0, depthWrite: true
      })
    );
    patch.position.set(0, 0.0035, -0.4);
    patch.receiveShadow = true;
    patch.name = 'teeTurf';
    scene.add(patch);
    this._macro = [patch];

    /* mown tee-box grass — blades ~13 mm, well under the 21 mm ball radius */
    const bg = new THREE.PlaneGeometry(0.0038, 0.013, 1, 3);
    {
      const p = bg.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i), t = (y + 0.0065) / 0.013;
        p.setX(i, p.getX(i) * (1 - 0.85 * t));
        p.setZ(i, 0.0042 * t * t);
        p.setY(i, y + 0.0065);
      }
      bg.computeVertexNormals();
    }
    const NB = 13000;
    const blades = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.86, metalness: 0, side: THREE.DoubleSide
    }), NB);
    {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), col = new THREE.Color();
      const rnd = mulberry(9182);
      for (let i = 0; i < NB; i++) {
        const a = rnd() * 6.2832;
        let rr2 = 0.03 + Math.pow(rnd(), 0.5) * 0.40;
        let X = Math.cos(a) * rr2, Z = Math.sin(a) * rr2;
        // both close cameras sit inside the turf: hold the blade field clear of each
        let guard = 0;
        while ((Math.hypot(X - 0.16, Z - 0.19) < 0.13 || Math.hypot(X + 0.21, Z - 0.20) < 0.12) && guard++ < 16) {
          rr2 = 0.03 + Math.pow(rnd(), 0.5) * 0.40;
          const a2 = rnd() * 6.2832;
          X = Math.cos(a2) * rr2; Z = Math.sin(a2) * rr2;
        }
        e.set((rnd() - 0.5) * 0.44, rnd() * 6.2832, (rnd() - 0.5) * 0.44);
        q.setFromEuler(e);
        const s = 0.55 + rnd() * 0.8;
        v3.set(s, s * (0.7 + rnd() * 0.6), s);
        m4.compose(new THREE.Vector3(X, 0.002, Z), q, v3);
        blades.setMatrixAt(i, m4);
        col.setHSL(0.253 + rnd() * 0.025, 0.30 + rnd() * 0.14, 0.115 + rnd() * 0.075);
        blades.setColorAt(i, col);
      }
    }
    blades.instanceMatrix.needsUpdate = true;
    blades.castShadow = false;
    blades.receiveShadow = true;
    blades.name = 'grass';
    scene.add(blades);
    this._macro.push(blades);

    /* tee peg */
    const teeProfile = [];
    for (let i = 0; i <= 22; i++) {
      const t = i / 22;
      let r;
      if (t < 0.16) r = lerp(0.0052, 0.0088, t / 0.16);
      else if (t < 0.30) r = lerp(0.0088, 0.0022, (t - 0.16) / 0.14);
      else r = lerp(0.0022, 0.0009, (t - 0.30) / 0.70);
      teeProfile.push(new THREE.Vector2(r, lerp(0.041, 0, t)));
    }
    const peg = new THREE.Mesh(
      new THREE.LatheGeometry(teeProfile, 48),
      new THREE.MeshPhysicalMaterial({ color: 0xf3efe6, roughness: 0.44, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.5, sheen: 0.2 })
    );
    peg.castShadow = true; peg.name = 'tee';
    scene.add(peg);
    this._macro.push(peg);

    await frame();

    /* ball */
    const dm = dimpleMaps(THREE);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.02135, 96, 64),
      new THREE.MeshPhysicalMaterial({
        map: ballColorMap(THREE),
        normalMap: dm.normal, normalScale: new THREE.Vector2(1.0, 1.0),
        roughnessMap: dm.rough, roughness: 1.0, metalness: 0,
        clearcoat: 0.72, clearcoatRoughness: 0.22, sheen: 0.25, sheenRoughness: 0.6,
        envMapIntensity: 1.05
      })
    );
    ball.position.set(0, 0.0415 + 0.02135 * 0.78, 0);
    ball.rotation.set(0.22, -0.55, 0.1);
    ball.castShadow = true; ball.receiveShadow = true; ball.name = 'ball';
    scene.add(ball);
    this._ball = ball;
    this._macro.push(ball);

    }

    /* flagstick, pin in the middle of the green */
    {
      const flag = new THREE.Group(); flag.name = 'flagstick';
      const px = GREEN.x + 0.6, pz = GREEN.z + 1.0;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 2.2, 12),
        new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.5, metalness: 0.1 }));
      stick.position.y = 1.1;
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.108, 0.1, 0.24, 20),
        new THREE.MeshStandardMaterial({ color: 0x14170f, roughness: 1 }));
      cup.position.y = -0.11;
      const cloth = new THREE.PlaneGeometry(0.56, 0.36, 12, 4);
      const p = cloth.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = (p.getX(i) + 0.28) / 0.56;
        p.setZ(i, Math.sin(t * 4.2) * 0.04 * t);
        p.setY(i, p.getY(i) + Math.sin(t * 2.6) * 0.02 * t);
      }
      cloth.computeVertexNormals();
      const flagMesh = new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({
        color: 0xc8102e, roughness: 0.82, metalness: 0, side: THREE.DoubleSide
      }));
      flagMesh.position.set(0.29, 1.95, 0);
      flag.add(stick, cup, flagMesh);
      flag.position.set(px, terrainY(px, pz), pz);
      flag.traverse(o => { if (o.isMesh) o.castShadow = true; });
      scene.add(flag);
    }

    /* ---- runtime ---- */
    this._grade = MACRO;
    const startShot = clamp(parseInt(this.getAttribute('start-shot') || this.getAttribute('startshot') || '0', 10) || 0, 0, SHOTS.length - 1);
    this._shot = startShot;
    this._showMacro(!this.isExplore && startShot < 2);
    this._applyShadow(SHOTS[startShot].shadow);
    this._applyGrade(SHOTS[startShot].grade);
    cam.fov = SHOTS[startShot].fov;
    this._mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = ev => {
      const r = this.getBoundingClientRect();
      this._mouse.tx = ((ev.clientX - r.left) / r.width - 0.5) * 2;
      this._mouse.ty = ((ev.clientY - r.top) / r.height - 0.5) * 2;
    };
    this.addEventListener('pointermove', onMove);
    this.addEventListener('pointerleave', () => { this._mouse.tx = 0; this._mouse.ty = 0; });

    const resize = () => {
      const w = this.clientWidth || 1, h = this.clientHeight || 1;
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    resize();
    this._ro = new ResizeObserver(resize);
    this._ro.observe(this);

    this._visible = true;
    new IntersectionObserver(es => { this._visible = es[0].isIntersecting; }, { threshold: 0.01 }).observe(this);

    this._reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._t0 = -1e9;
    this._start = performance.now();
    if (this.isExplore) {
      this._bindOrbit();
      this._applyShadow(210);
      this._applyGrade(AERIAL);
      cam.fov = 40;
      cam.updateProjectionMatrix();
    }
    this._loop();
    requestAnimationFrame(() => { cv.style.opacity = '1'; });
    this.setAttribute('data-ready', '');
    this._resolveReady(this);
  }

  /* the tee-side props are centimetre-scale: from the air they are only a dark smudge */
  _showMacro(v) { if (this._macro) for (const o of this._macro) o.visible = v; }

  _applyGrade(g, t) {
    if (!g) return;
    const a = this._grade || MACRO;
    const k = t === undefined ? 1 : clamp(t, 0, 1);
    this._renderer.toneMappingExposure = lerp(a.exp, g.exp, k);
    this._scene.environmentIntensity = lerp(a.env, g.env, k);
    this._scene.backgroundIntensity = lerp(a.bg, g.bg, k);
    this._scene.fog.density = lerp(a.fog, g.fog, k);
    this._sun.intensity = lerp(a.sun, g.sun, k);
    if (this._fill) this._fill.intensity = lerp(a.fill, g.fill, k);
    if (k >= 1) this._grade = g;
  }

  /* keep the sun's direction fixed; move it with the shadow volume so a 4 mm dimple
     and a 400 m hole can both be lit by the same light */
  _applyShadow(half) {
    const sun = this._sun, c = sun.shadow.camera;
    const tz = half > 10 ? MID : 0;
    const D = Math.max(40, half * 1.9 + 30);
    sun.target.position.set(0, 0, tz);
    sun.position.set(SUN_DIR[0] * D, SUN_DIR[1] * D, tz + SUN_DIR[2] * D);
    sun.shadow.normalBias = half > 10 ? 0.4 : 0.006;
    c.left = -half; c.right = half; c.top = half; c.bottom = -half;
    c.near = Math.max(0.05, D - half * 3 - 30);
    c.far = D + half * 3 + 80;
    c.updateProjectionMatrix();
  }

  _loop() {
    if (this._stop) return;
    requestAnimationFrame(() => this._loop());
    if (!this._visible) return;
    if (!this._camPos || !this._camTgt || !this._cam) return;
    const now = performance.now();
    const T = (now - this._start) / 1000;

    if (!this._reduced) {
      if (this._ball) this._ball.rotation.y += 0.00035;
      if (this._ripple) { this._ripple.offset.y = -T * 0.014; this._ripple.offset.x = Math.sin(T * 0.06) * 0.012; }
    }

    if (this.isExplore) { this._poseExplore(now, T); this._renderer.render(this._scene, this._cam); return; }

    const S = SHOTS[this._shot];
    const P = this._THREE;
    const live = S.orbit ? orbitPose(T) : S;

    const k = clamp((now - this._t0) / 1500, 0, 1);
    const ease = k < 1 ? 1 - Math.pow(1 - k, 4) : 1;
    const tp = new P.Vector3().fromArray(live.pos), tt = new P.Vector3().fromArray(live.tgt);
    if (this._from && k < 1) {
      this._camPos.copy(this._from.pos).lerp(tp, ease);
      this._camTgt.copy(this._from.tgt).lerp(tt, ease);
      this._cam.fov = lerp(this._from.fov, S.fov, ease);
      this._cam.updateProjectionMatrix();
      this._applyGrade(S.grade, ease);
      if (ease > 0.45) this._applyShadow(S.shadow);
    } else {
      this._camPos.copy(tp); this._camTgt.copy(tt);
      if (Math.abs(this._cam.fov - S.fov) > 0.01) { this._cam.fov = S.fov; this._cam.updateProjectionMatrix(); }
      if (this._grade !== S.grade) this._applyGrade(S.grade);
    }

    const d = this._reduced ? 0 : S.drift;
    this._mouse.x += (this._mouse.tx - this._mouse.x) * 0.045;
    this._mouse.y += (this._mouse.ty - this._mouse.y) * 0.045;
    const px = Math.sin(T * 0.14) * d + this._mouse.x * d * 1.5;
    const py = Math.sin(T * 0.19 + 1.1) * d * 0.5 - this._mouse.y * d * 0.9;
    const pz = Math.cos(T * 0.11) * d * 0.7;
    this._cam.position.set(this._camPos.x + px, this._camPos.y + py, this._camPos.z + pz);
    this._cam.lookAt(this._camTgt);

    this._renderer.render(this._scene, this._cam);
  }

  _poseExplore(now, T) {
    if (this._flying) {
      let u = (now - this._flyT0) / (FLY_SECONDS * 1000);
      if (u >= 1) u = 1;
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      const { pos, tgt } = flyPose(e);
      this._cam.position.set(pos[0], pos[1], pos[2]);
      this._cam.lookAt(tgt[0], tgt[1], tgt[2]);
      this.dispatchEvent(new CustomEvent('flyprogress', { detail: { progress: u } }));
      if (u >= 1) this.stopFlythrough();
      return;
    }
    const o = this._orbit;
    if (!this._reduced) o.theta += 0.00022;
    const sp = Math.sin(o.phi);
    this._cam.position.set(
      o.tgt.x + o.dist * sp * Math.cos(o.theta),
      o.tgt.y + o.dist * Math.cos(o.phi),
      o.tgt.z + o.dist * sp * Math.sin(o.theta)
    );
    this._cam.lookAt(o.tgt.x, o.tgt.y, o.tgt.z);
  }
}

if (!customElements.get('golf-stage')) customElements.define('golf-stage', GolfStage);

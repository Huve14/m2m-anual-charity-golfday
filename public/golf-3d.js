/* <golf-stage>: one continuous photoreal dawn golf scene, two camera shots.
   Shot 0 TEE  · Shot 1 HOLE 07
   Everything (turf, dimples, sky, sand) is generated procedurally on canvas. */

const THREE_URL = 'https://unpkg.com/three@0.184.0/build/three.module.js';

/* ---------- small maths helpers ---------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
// Yield so the browser can paint between expensive builds. rAF alone is unsafe here:
// in a hidden or throttled frame it may never fire, which would stall boot forever.
const frame = () => new Promise(r => {
  let done = false;
  const go = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(() => setTimeout(go, 0));
  setTimeout(go, 80);
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

/* ---------- course layout, shared by geometry AND texture ---------- */
/* tee at origin, play direction -Z, green at (2,-40) */
const GREEN = { x: 2, z: -40, r: 7.4 };
const BUNKERS = [{ x: -5.4, z: -25, r: 3.6 }, { x: 7.6, z: -33.5, r: 3.0 }, { x: -2.5, z: -46, r: 2.6 }];
/* fairway centre-line: straight then a soft bend right */
function fairwayX(z) {
  const t = clamp((-z - 8) / 32, 0, 1);
  return smooth(t) * 2.6;
}
function fairwayDist(x, z) { return Math.abs(x - fairwayX(z)); }
const nH = makeNoise(20260922);

function terrainY(x, z) {
  const onCourse = z < 6 && z > -66;
  const fd = fairwayDist(x, z);
  const inFw = 1 - smooth(clamp((fd - 6.5) / 4, 0, 1));           // 1 fairway → 0 rough
  let y = -z * 0.028;                                              // gentle climb away from tee
  const mound = (nH(x * 0.035 + 10, z * 0.035 + 4, 4) - 0.5) * 2;
  y += mound * lerp(2.6, 0.55, inFw);
  y += (nH(x * 0.22, z * 0.22, 3) - 0.5) * 0.16;                   // fine undulation
  // raised, flat green
  const gd = Math.hypot(x - GREEN.x, z - GREEN.z);
  const gk = 1 - smooth(clamp((gd - GREEN.r) / 4.5, 0, 1));
  y = lerp(y, (-GREEN.z * 0.028) + 1.15 + (nH(x * 0.3 + 60, z * 0.3, 2) - 0.5) * 0.12, gk);
  // bunkers: dished with a lip
  for (const b of BUNKERS) {
    const bd = Math.hypot(x - b.x, z - b.z);
    if (bd < b.r * 1.8) {
      const k = 1 - smooth(clamp((bd - b.r) / (b.r * 0.5), 0, 1));
      const lip = Math.exp(-Math.pow((bd - b.r * 1.05) / (b.r * 0.28), 2)) * 0.42;
      y += -1.35 * k + lip;
    }
  }
  // flat tee box
  const td = Math.hypot(x, z + 1.5);
  y = lerp(y, 0, 1 - smooth(clamp((td - 4.5) / 3.5, 0, 1)));
  if (!onCourse) y += 1.2;
  return y;
}

/* ---------- textures ---------- */

/* Equirect normal + roughness maps for a real golf-ball dimple pattern. */
function dimpleMaps(THREE, W = 1024, H = 512, N = 372) {
  const ga = Math.PI * (3 - Math.sqrt(5));
  const pts = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), th = ga * i;
    const p = [Math.cos(th) * r, y, Math.sin(th) * r];
    p.push(Math.acos(clamp(y, -1, 1)));                            // polar angle
    pts.push(p);
  }
  const R = 0.101;                                                 // dimple angular radius
  const cosR = Math.cos(R), R2 = R * R;                            // test in cos-space: no acos per pixel
  const B = 96, band = [];                                         // latitude buckets
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
          const t = 1 - (2 * (1 - dot)) / R2;                       // chord² ≈ angle² at 0.1 rad
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
      const rough = 190 + h[i] * 46;                               // dimple floors read matter
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

/* dawn sky, equirect: drives every reflection in the scene */
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
  // low sun, behind the green (theta ≈ 0.5 of the wrap)
  const sx = W * 0.5, sy = H * 0.487;
  const sun = x.createRadialGradient(sx, sy, 0, sx, sy, W * 0.20);
  sun.addColorStop(0, 'rgba(255,244,226,1)');
  sun.addColorStop(0.05, 'rgba(255,214,163,0.95)');
  sun.addColorStop(0.24, 'rgba(255,163,104,0.34)');
  sun.addColorStop(1, 'rgba(255,140,90,0)');
  x.fillStyle = sun; x.fillRect(0, 0, W, H);
  // soft cloud banding, low contrast
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

/* the whole hole, painted: rough, mown fairway stripes, green, bunkers */
const TEX = { minX: -60, maxX: 60, minZ: -90, maxZ: 30 };
function courseMaps(THREE, S = 1536) {
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d');
  const wx = u => TEX.minX + u * (TEX.maxX - TEX.minX);
  const wz = v => TEX.minZ + v * (TEX.maxZ - TEX.minZ);
  const toPx = (X, Z) => [(X - TEX.minX) / 120 * S, (Z - TEX.minZ) / 120 * S];
  const nR = makeNoise(4242), nF = makeNoise(909);

  // base rough
  const id = x.createImageData(S, S);
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const X = wx(px / S), Z = wz(py / S);
      const m = nR(X * 0.10, Z * 0.10, 4), f = nR(X * 1.4 + 5, Z * 1.4, 2);
      const far = clamp((Math.abs(X) - 34) / 22, 0, 1);            // tree-line falloff
      let r = 44 + m * 24 + f * 12, g = 66 + m * 30 + f * 13, b = 32 + m * 15 + f * 8;
      r *= 1 - far * 0.55; g *= 1 - far * 0.52; b *= 1 - far * 0.5;
      const i = (py * S + px) * 4;
      id.data[i] = r; id.data[i + 1] = g; id.data[i + 2] = b; id.data[i + 3] = 255;
    }
  }
  x.putImageData(id, 0, 0);

  // fairway corridor
  x.save();
  x.beginPath();
  for (let Z = 30; Z >= -62; Z -= 1) { const [ax, ay] = toPx(fairwayX(Z) - 7.4, Z); Z === 30 ? x.moveTo(ax, ay) : x.lineTo(ax, ay); }
  for (let Z = -62; Z <= 30; Z += 1) { const [ax, ay] = toPx(fairwayX(Z) + 7.4, Z); x.lineTo(ax, ay); }
  x.closePath(); x.clip();
  const fg = x.createLinearGradient(0, 0, 0, S);
  fg.addColorStop(0, '#5d7f43'); fg.addColorStop(1, '#6a8c49');
  x.fillStyle = fg; x.fillRect(0, 0, S, S);
  // mown stripes across the line of play
  for (let Z = 30; Z > -64; Z -= 2.6) {
    const [, ay] = toPx(0, Z), [, ay2] = toPx(0, Z - 1.3);
    x.fillStyle = 'rgba(255,255,255,0.055)';
    x.fillRect(0, ay2, S, ay - ay2);
  }
  // fine mottling, drawn as sparse strokes rather than a second full-canvas pixel pass
  x.globalAlpha = 0.28;
  for (let i = 0; i < 5200; i++) {
    const px = Math.random() * S, py = Math.random() * S;
    const v = nF(px * 0.04, py * 0.04, 2);
    x.fillStyle = v > 0.5 ? 'rgba(126,162,84,0.5)' : 'rgba(58,84,40,0.5)';
    x.fillRect(px, py, 2 + v * 5, 1 + v * 2);
  }
  x.globalAlpha = 1;
  x.restore();

  // semi-rough collar
  x.save();
  x.strokeStyle = 'rgba(58,84,40,0.55)'; x.lineWidth = S / 120 * 1.6;
  x.beginPath();
  for (let Z = 30; Z >= -62; Z -= 1) { const [ax, ay] = toPx(fairwayX(Z) - 7.4, Z); Z === 30 ? x.moveTo(ax, ay) : x.lineTo(ax, ay); }
  x.stroke();
  x.beginPath();
  for (let Z = 30; Z >= -62; Z -= 1) { const [ax, ay] = toPx(fairwayX(Z) + 7.4, Z); Z === 30 ? x.moveTo(ax, ay) : x.lineTo(ax, ay); }
  x.stroke();
  x.restore();

  // putting surface
  const [gx, gy] = toPx(GREEN.x, GREEN.z), gr = GREEN.r / 120 * S;
  x.save();
  x.beginPath(); x.ellipse(gx, gy, gr * 1.18, gr, 0.2, 0, 6.284); x.clip();
  x.fillStyle = '#7ba054'; x.fillRect(0, 0, S, S);
  for (let i = -40; i < 40; i++) {
    x.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)';
    x.fillRect(gx - gr * 1.3, gy + i * (S / 120 * 0.75), gr * 2.6, S / 120 * 0.75);
  }
  x.restore();
  x.save();
  x.beginPath(); x.ellipse(gx, gy, gr * 1.30, gr * 1.12, 0.2, 0, 6.284);
  x.strokeStyle = 'rgba(104,138,72,0.85)'; x.lineWidth = S / 120 * 1.1; x.stroke();
  x.restore();
  // cup
  x.beginPath(); x.ellipse(gx + gr * 0.14, gy + gr * 0.10, S / 120 * 0.09, S / 120 * 0.09, 0, 0, 6.284);
  x.fillStyle = '#14170f'; x.fill();

  // bunkers
  for (const b of BUNKERS) {
    const [bx, by] = toPx(b.x, b.z), br = b.r / 120 * S;
    x.save();
    x.beginPath();
    for (let a = 0; a <= 6.30; a += 0.09) {
      const w = 0.82 + nR(Math.cos(a) * 2 + b.x, Math.sin(a) * 2 + b.z, 3) * 0.42;
      const px2 = bx + Math.cos(a) * br * w * 1.25, py2 = by + Math.sin(a) * br * w;
      a === 0 ? x.moveTo(px2, py2) : x.lineTo(px2, py2);
    }
    x.closePath();
    x.fillStyle = '#d9c8a2'; x.fill();
    x.strokeStyle = 'rgba(58,80,40,0.7)'; x.lineWidth = S / 120 * 0.5; x.stroke();
    x.clip();
    x.globalAlpha = 0.5;
    for (let i = 0; i < 900; i++) {
      const a = Math.random() * 6.3, rr = Math.random() * br * 1.2;
      x.fillStyle = Math.random() > 0.5 ? 'rgba(255,250,235,0.5)' : 'rgba(170,150,116,0.4)';
      x.fillRect(bx + Math.cos(a) * rr, by + Math.sin(a) * rr, 3, 2);
    }
    x.restore();
  }

  // tee box, mown tight and crossways
  const [tx, ty] = toPx(0, -1.5), tw = 4.6 / 120 * S;
  x.save();
  x.beginPath(); x.rect(tx - tw, ty - tw * 0.7, tw * 2, tw * 1.4); x.clip();
  x.fillStyle = '#6d9049'; x.fillRect(0, 0, S, S);
  for (let i = -30; i < 30; i++) {
    x.fillStyle = i % 2 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
    x.fillRect(tx - tw + i * (S / 120 * 0.55), ty - tw, S / 120 * 0.55, tw * 2);
  }
  x.restore();

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 16;
  return map;
}

/* tight, high-detail turf right around the tee (the ground map is far too coarse at 3 cm) */
function teePatchMaps(THREE, S = 1024) {
  const PATCH = 7;                                                  // metres
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
      const blade = n(u * 46, v * 46, 2);                           // blade-scale streaks
      const clump = n(u * 5.5 + 3, v * 5.5, 4);
      const stripe = ((Math.floor(v / 0.55) % 2) ? 1 : 0) * 0.055;
      const shade = n(u * 130, v * 18, 2);                          // directional blade lay
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

/* ---------- shots ---------- */
const MACRO = { exp: 1.06, env: 0.95, bg: 0.9, fog: 0.0125, sun: 3.5, fill: 0.62 };
const AERIAL = { exp: 1.34, env: 1.35, bg: 1.05, fog: 0.0055, sun: 4.1, fill: 0.9 };
const SHOTS = [
  { key: 'tee',    pos: [0.215, 0.104, 0.215], tgt: [-0.112, 0.064, -0.018], fov: 33, shadow: 1.1,  drift: 0.009, grade: MACRO },
  { key: 'flyover', orbit: true, fov: 44, shadow: 66, drift: 0, grade: AERIAL }
];

/* endless drone orbit over the hole. It loops with no cut, so it can sit under a whole page */
function orbitPose(T) {
  const tgt = [1.5, 2.2, -20];
  const th = 0.95 + T * 0.0125;
  const dist = 60 + Math.sin(T * 0.055) * 10;
  const phi = 1.05 + Math.sin(T * 0.037) * 0.08;
  const sp = Math.sin(phi);
  return {
    pos: [tgt[0] + dist * sp * Math.cos(th), tgt[1] + dist * Math.cos(phi), tgt[2] + dist * sp * Math.sin(th)],
    tgt
  };
}

const FLY_SECONDS = 26;

/* camera pose along the hole, u = 0 at the tee, 1 settled over the green */
function flyPose(u) {
  const z = lerp(16, -24, u);
  const x = fairwayX(z) + Math.sin(u * Math.PI * 1.7) * 3.4 * (1 - u * 0.85);
  const arc = Math.sin(Math.min(1, u * 1.15) * Math.PI);
  const h = lerp(4.4, 11, arc) + lerp(2.2, 10.5, u * u);
  const pos = [x, terrainY(x, z) + h, z];
  // aim down the line early, settle onto the green by the end
  const k = smooth(clamp((u - 0.45) / 0.55, 0, 1));
  const zt = lerp(z - 30, GREEN.z, k);
  const xt = lerp(fairwayX(zt), GREEN.x, k);
  const tgt = [xt, terrainY(xt, zt) + 1.4, zt];
  return { pos, tgt };
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
    // hand the orbit rig the pose we stopped at, so there is no jump
    if (this._orbit) {
      const p = this._cam.position, t = this._orbit.tgt;
      const dx = p.x - t.x, dy = p.y - t.y, dz = p.z - t.z;
      this._orbit.dist = Math.max(8, Math.hypot(dx, dy, dz));
      this._orbit.phi = Math.acos(clamp(dy / this._orbit.dist, -1, 1));
      this._orbit.theta = Math.atan2(dz, dx);
    }
    this.dispatchEvent(new CustomEvent('flystate', { detail: { flying: false, progress: 0 } }));
  }

  resetView() {
    this.stopFlythrough();
    if (this._orbit) Object.assign(this._orbit, { theta: 1.02, phi: 1.03, dist: 66, tgt: { x: 1.2, y: 1.2, z: -20 } });
  }

  _bindOrbit() {
    this._orbit = { theta: 1.02, phi: 1.03, dist: 66, tgt: { x: 1.2, y: 1.2, z: -20 } };
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
      o.phi = clamp(o.phi - (e.clientY - ly) * 0.005, 0.16, 1.46);
      lx = e.clientX; ly = e.clientY;
    });
    this.addEventListener('wheel', e => {
      e.preventDefault();
      this._orbit.dist = clamp(this._orbit.dist * (1 + Math.sign(e.deltaY) * 0.09), 9, 190);
    }, { passive: false });
  }

  connectedCallback() {
    if (this._booted) return;
    this._booted = true;
    const cs = getComputedStyle(this);
    if (cs.position === 'static') this.style.position = 'relative';
    this.style.display = 'block';
    this.style.overflow = 'hidden';
    // fill whatever box we were mounted into (an unsized custom element is 0-high)
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
    const dwell = [7000, 15000];                  // flyover earns the longest hold
    const step = () => {
      if (this._userLocked) return;
      const next = (this._shot + 1) % SHOTS.length;
      this.setShot(next);
      this._cycleT = setTimeout(step, dwell[next]);
    };
    this._cycleT = setTimeout(step, dwell[this._shot] || 9000);
  }

  stopCycle() { if (this._cycleT) { clearTimeout(this._cycleT); this._cycleT = null; } }

  /* a deliberate camera pick wins: stop cycling and stay put */
  lockCamera() { this._userLocked = true; this.stopCycle(); }

  get shot() { return this._shot; }
  set shot(v) { this.setShot(v); }

  setShot(i) {
    i = clamp(i | 0, 0, SHOTS.length - 1);
    if (i === this._shot) return;
    this._shot = i;
    // The page controller can select its opening shot while the async Three.js
    // scene is still being constructed. Remember that choice and let the first
    // render apply it once the camera vectors exist.
    if (!this._camPos || !this._camTgt || !this._cam) return;
    this._from = { pos: this._camPos.clone(), tgt: this._camTgt.clone(), fov: this._cam.fov };
    this._t0 = performance.now();
    this.dispatchEvent(new CustomEvent('shotchange', { detail: { shot: i, key: SHOTS[i].key } }));
  }

  async _boot() {
    const THREE = await import(THREE_URL);
    this._THREE = THREE;
    const cv = this._cv;
    const compact = matchMedia('(max-width: 720px)').matches;
    const constrained = compact || (navigator.deviceMemory && navigator.deviceMemory <= 4);

    const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
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

    const cam = new THREE.PerspectiveCamera(33, 16 / 9, 0.004, 600);
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

    /* light: low dawn sun from behind the green */
    const sun = new THREE.DirectionalLight(0xffd9ad, 3.5);
    sun.position.set(-13, 5.4, -34);
    sun.castShadow = true;
    sun.shadow.mapSize.set(constrained ? 1024 : 2048, constrained ? 1024 : 2048);
    sun.shadow.bias = -0.00012;
    sun.shadow.normalBias = 0.006;
    scene.add(sun, sun.target);
    this._sun = sun;

    const bounce = new THREE.DirectionalLight(0xbfd0e0, 0.42);   // cool sky bounce
    bounce.position.set(6, 4, 12);
    scene.add(bounce);

    const fill = new THREE.DirectionalLight(0xffe4c8, 0.62);      // warm fill from the camera side
    fill.position.set(9, 6, 14);
    scene.add(fill);
    this._fill = fill;

    await frame();

    /* ground */
    const groundSegments = constrained ? 190 : 320;
    const gGeo = new THREE.PlaneGeometry(120, 120, groundSegments, groundSegments);
    gGeo.rotateX(-Math.PI / 2);
    const gp = gGeo.attributes.position;
    for (let i = 0; i < gp.count; i++) {
      const X = gp.getX(i), Z = gp.getZ(i) - 30;
      gp.setZ(i, Z);
      gp.setY(i, terrainY(X, Z));
    }
    gGeo.computeVertexNormals();
    const ground = new THREE.Mesh(gGeo, new THREE.MeshStandardMaterial({
      map: courseMaps(THREE, constrained ? 1024 : 1536), roughness: 0.93, metalness: 0, dithering: true
    }));
    ground.receiveShadow = true;
    ground.name = 'ground';
    scene.add(ground);

    await frame();

    /* high-detail tee patch */
    const tp = teePatchMaps(THREE, constrained ? 768 : 1024);
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

    /* mown tee-box grass: blades ~13 mm, well under the 21 mm ball radius */
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
    const NB = constrained ? 6500 : 13000;
    const blades = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.86, metalness: 0, side: THREE.DoubleSide
    }), NB);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), col = new THREE.Color();
    const rnd = mulberry(9182);
    for (let i = 0; i < NB; i++) {
      const a = rnd() * 6.2832;
      let rr = 0.03 + Math.pow(rnd(), 0.5) * 0.40;
      let X = Math.cos(a) * rr, Z = Math.sin(a) * rr;
      // both close cameras sit inside the turf: hold the blade field clear of each
      let guard = 0;
      while ((Math.hypot(X - 0.16, Z - 0.19) < 0.13 || Math.hypot(X + 0.21, Z - 0.20) < 0.12) && guard++ < 16) {
        rr = 0.03 + Math.pow(rnd(), 0.5) * 0.40;
        const a2 = rnd() * 6.2832;
        X = Math.cos(a2) * rr; Z = Math.sin(a2) * rr;
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
    blades.instanceMatrix.needsUpdate = true;
    blades.castShadow = false;   // 13k thin blades self-shadowing only buys acne
    blades.receiveShadow = true;
    blades.name = 'grass';
    scene.add(blades);

    /* tee peg */
    const teeProfile = [];
    for (let i = 0; i <= 22; i++) {
      const t = i / 22;
      let r;
      if (t < 0.16) r = lerp(0.0052, 0.0088, t / 0.16);              // cup lip
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

    await frame();

    /* ball */
    const dm = constrained ? dimpleMaps(THREE, 640, 320, 260) : dimpleMaps(THREE);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.02135, constrained ? 64 : 96, constrained ? 40 : 64),
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

    /* flagstick on the green */
    const flag = new THREE.Group(); flag.name = 'flagstick';
    const gy2 = terrainY(GREEN.x + 0.9, GREEN.z + 0.6);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.010, 2.1, 12),
      new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.5, metalness: 0.1 }));
    stick.position.y = 1.05;
    const cloth = new THREE.PlaneGeometry(0.52, 0.34, 12, 4);
    {
      const p = cloth.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = (p.getX(i) + 0.26) / 0.52;
        p.setZ(i, Math.sin(t * 4.2) * 0.035 * t);
        p.setY(i, p.getY(i) + Math.sin(t * 2.6) * 0.02 * t);
      }
      cloth.computeVertexNormals();
    }
    const flagMesh = new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({
      color: 0xc8102e, roughness: 0.82, metalness: 0, side: THREE.DoubleSide
    }));
    flagMesh.position.set(0.27, 1.86, 0);
    flag.add(stick, flagMesh);
    flag.position.set(GREEN.x + 0.9, gy2, GREEN.z + 0.6);
    flag.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(flag);

    await frame();

    /* tree line */
    const trunkG = new THREE.CylinderGeometry(0.16, 0.30, 2.6, 7);
    const canopyG = new THREE.ConeGeometry(1.9, 6.6, 9, 3);
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.95 });
    const canopyM = new THREE.MeshStandardMaterial({ color: 0x2c4023, roughness: 0.9, flatShading: true });
    const NT = 128;
    const trunks = new THREE.InstancedMesh(trunkG, trunkM, NT);
    const canopies = new THREE.InstancedMesh(canopyG, canopyM, NT);
    const rt = mulberry(555);
    const cc2 = new THREE.Color();
    for (let i = 0; i < NT; i++) {
      const side = i % 2 ? 1 : -1;
      const Z = 24 - (i / NT) * 92 + (rt() - 0.5) * 6;
      const X = fairwayX(Z) + side * (13.5 + rt() * 20);
      const Y = terrainY(X, Z);
      const s = 0.7 + rt() * 0.9;
      m4.compose(new THREE.Vector3(X, Y + 1.3 * s, Z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(X, Y + (2.6 + 3.3) * s, Z), q.setFromEuler(e.set(0, rt() * 6.28, 0)), new THREE.Vector3(s, s * (0.85 + rt() * 0.4), s));
      canopies.setMatrixAt(i, m4);
      cc2.setHSL(0.26 + rt() * 0.04, 0.28 + rt() * 0.16, 0.10 + rt() * 0.09);
      canopies.setColorAt(i, cc2);
    }
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    canopies.castShadow = true;
    trunks.name = 'trunks'; canopies.name = 'canopies';
    scene.add(trunks, canopies);

    /* ---- runtime ---- */
    this._grade = MACRO;
    const startShot = clamp(parseInt(this.getAttribute('start-shot') || this.getAttribute('startshot') || '0', 10) || 0, 0, SHOTS.length - 1);
    this._shot = startShot;
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
      this._applyShadow(66);
      cam.fov = 46;
      cam.updateProjectionMatrix();
      // the macro grade is far too dark for an aerial: open it up
      renderer.toneMappingExposure = 1.34;
      scene.environmentIntensity = 1.35;
      scene.backgroundIntensity = 1.05;
      scene.fog.density = 0.0055;
      sun.intensity = 4.1;
      fill.intensity = 0.9;
    }
    this._loop();
    requestAnimationFrame(() => { cv.style.opacity = '1'; });
    this.setAttribute('data-ready', '');
    this._resolveReady(this);
  }

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

  _applyShadow(half) {
    const c = this._sun.shadow.camera;
    c.left = -half; c.right = half; c.top = half; c.bottom = -half;
    c.near = 0.05; c.far = half * 6 + 40;
    c.updateProjectionMatrix();
    this._sun.target.position.set(0, 0, half > 10 ? -22 : 0);
  }

  _loop() {
    if (this._stop) return;
    requestAnimationFrame(() => this._loop());
    if (!this._visible) return;
    const now = performance.now();
    const T = (now - this._start) / 1000;

    if (!this._reduced) {
      this._ball.rotation.y += 0.00035;
    }

    if (this.isExplore) { this._poseExplore(now, T); this._renderer.render(this._scene, this._cam); return; }

    const S = SHOTS[this._shot];
    const P = this._THREE;
    const live = S.orbit ? orbitPose(T) : S;

    // shot transition
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
      if (this._grade !== S.grade) this._applyGrade(S.grade);   // settle the grade after a transition
    }

    // slow drift + pointer parallax
    const d = this._reduced ? 0 : S.drift;
    this._mouse.x += (this._mouse.tx - this._mouse.x) * 0.045;
    this._mouse.y += (this._mouse.ty - this._mouse.y) * 0.045;
    const px = Math.sin(T * 0.14) * d + this._mouse.x * d * 1.5;
    const py = Math.sin(T * 0.19 + 1.1) * d * 0.5 - this._mouse.y * d * 0.9;
    const pz = Math.cos(T * 0.11) * d * 0.7;
    this._cam.position.set(this._camPos.x + px, this._camPos.y + py, this._camPos.z + pz);
    this._cam.lookAt(this._camTgt);

    if (!this._reduced) {
      this._ball.rotation.y += 0.00035;
    }

    this._renderer.render(this._scene, this._cam);
  }

  _poseExplore(now, T) {
    if (this._flying) {
      let u = (now - this._flyT0) / (FLY_SECONDS * 1000);
      if (u >= 1) { u = 1; }
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;   // ease in-out
      const { pos, tgt } = flyPose(e);
      this._cam.position.set(pos[0], pos[1], pos[2]);
      this._cam.lookAt(tgt[0], tgt[1], tgt[2]);
      this.dispatchEvent(new CustomEvent('flyprogress', { detail: { progress: u } }));
      if (u >= 1) this.stopFlythrough();
      return;
    }
    const o = this._orbit;
    if (!this._reduced) o.theta += 0.00035;                              // idle drift
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

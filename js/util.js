'use strict';
// ---------- Hilfsfunktionen: Zufall, Rauschen, Geometrie, Texturen ----------
const V3 = THREE.Vector3;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const RNG = mulberry32(1899);
const rand = (a = 0, b = 1) => a + RNG() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function lerpAngle(a, b, t) { return a + angDiff(a, b) * t; }

const _perm = new Uint8Array(512);
{
  const r = mulberry32(7);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) _perm[i] = p[i & 255];
}
function _grad(ix, iy) { return _perm[(_perm[ix & 255] + iy) & 255] / 255; }
function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = _grad(ix, iy), b = _grad(ix + 1, iy), c = _grad(ix, iy + 1), d = _grad(ix + 1, iy + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm(x, y, oct = 5) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
function segDist(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / l2, 0, 1);
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz));
}

// ---------- Material-Cache ----------
const _matCache = {};
function lam(color, opts) {
  const k = color + (opts ? JSON.stringify(opts) : '');
  return _matCache[k] || (_matCache[k] = new THREE.MeshLambertMaterial(Object.assign({ color }, opts || {})));
}

// ---------- Geometrie ----------
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
function MX(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new V3(x, y, z), _q.clone(), new V3(sx, sy, sz));
}
// Mehrere Teile (mit Farbe) zu einer Geometrie mit Vertexfarben verschmelzen; uv = Texturkoordinaten übernehmen
function mergeParts(parts, uv = false) {
  const geos = parts.map((p) => { const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone(); if (p.m) g.applyMatrix4(p.m); return g; });
  const n = geos.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uvs = uv ? new Float32Array(n * 2) : null;
  const c = new THREE.Color();
  let o = 0;
  geos.forEach((g, i) => {
    const cnt = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (uv) uvs.set(g.attributes.uv.array, o * 2);
    c.set(parts[i].color !== undefined ? parts[i].color : 0xffffff);
    for (let k = o * 3, e = (o + cnt) * 3; k < e; k += 3) { col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b; }
    o += cnt;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return out;
}
// Starre Lambert-Teile direkt unter einem Knoten zu einem Mesh pro Textur verschmelzen
// (ein Draw Call statt vieler); Untergruppen (Gelenke, Hand, Rotor) bleiben erhalten
const _bakeMats = new Map();
function bakeParts(node) {
  const byMap = new Map();
  for (const c of node.children) {
    const mat = c.material;
    if (!c.isMesh || c.isInstancedMesh || c.children.length || !mat.isMeshLambertMaterial || mat.transparent || mat.vertexColors) continue;
    if (mat.map && !c.geometry.attributes.uv) continue;
    (byMap.get(mat.map) || byMap.set(mat.map, []).get(mat.map)).push(c);
  }
  for (const [map, meshes] of byMap) {
    if (meshes.length < 2) continue;
    const parts = meshes.map((c) => { c.updateMatrix(); node.remove(c); return { geo: c.geometry, m: c.matrix, color: c.material.color.getHex() }; });
    const mat = _bakeMats.get(map) || _bakeMats.set(map, new THREE.MeshLambertMaterial({ vertexColors: true, map })).get(map);
    const m = new THREE.Mesh(mergeParts(parts, !!map), mat);
    m.castShadow = m.receiveShadow = meshes.some((c) => c.castShadow);
    node.add(m);
  }
}
// Box mit UVs, die zur Größe passen (Holzplanken skalieren korrekt)
function boxGeo(w, h, d, tile = 3) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * dims[f][0] / tile, uv.getY(idx) * dims[f][1] / tile);
    }
  }
  return g;
}

// ---------- Texturen (prozedural) ----------
function makeWoodTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ddd'; g.fillRect(0, 0, 256, 256);
  const plank = 32;
  for (let i = 0; i < 8; i++) {
    const shade = 185 + Math.random() * 60;
    g.fillStyle = `rgb(${shade},${shade},${shade})`;
    g.fillRect(0, i * plank, 256, plank - 2);
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(0,0,0,${Math.random() * 0.14})`;
      g.beginPath();
      const y = i * plank + Math.random() * plank;
      g.moveTo(0, y);
      g.bezierCurveTo(80, y + Math.random() * 4 - 2, 160, y + Math.random() * 4 - 2, 256, y);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, i * plank + plank - 2, 256, 2);
    const nx = Math.random() * 256;
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(nx, i * plank, 1.5, plank - 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
function makeGritTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const im = g.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const v = 200 + Math.random() * 55;
    im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
function signTex(text, bg = '#3b2a1a', fg = '#f2d9a0', w = 512, h = 128) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
  let size = 72;
  g.font = `bold ${size}px Rye, Georgia, serif`;
  while (g.measureText(text).width > w - 50 && size > 20) { size -= 4; g.font = `bold ${size}px Rye, Georgia, serif`; }
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
  return t;
}
function cloudTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 28; i++) {
    const x = 50 + Math.random() * 156, y = 44 + Math.random() * 40, r = 22 + Math.random() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return new THREE.CanvasTexture(c);
}

'use strict';
// ---------- Effekte, Figuren, Pferd, Tiere, KI, Sprengstoff ----------
const FX = { tracers: [], puffs: [], flash: null, flashT: 0 };
(function initFX() {
  const tg = new THREE.BoxGeometry(1, 1, 1); tg.translate(0, 0, 0.5);
  for (let i = 0; i < 50; i++) {
    const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false; m.frustumCulled = false; m.userData.life = 0; scene.add(m); FX.tracers.push(m);
  }
  const pg = new THREE.IcosahedronGeometry(0.16, 1);
  for (let i = 0; i < 280; i++) {
    const m = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0xc9a66b, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false; m.userData = { life: 0, v: new V3(), g: 0, max: 1 }; scene.add(m); FX.puffs.push(m);
  }
  FX.flash = new THREE.PointLight(0xffb060, 0, 22, 2); scene.add(FX.flash);
})();
let _ti = 0, _pi = 0;
function spawnTracer(a, b, color = 0xffe9a0, life = 0.09) {
  const m = FX.tracers[_ti++ % FX.tracers.length];
  const len = a.distanceTo(b);
  m.position.copy(a); m.lookAt(b); m.scale.set(0.035, 0.035, len);
  m.material.color.setHex(color); m.material.opacity = 0.9; m.visible = true; m.userData.life = life; m.userData.max = life;
}
function spawnPuff(p, color, n = 5, spread = 1.5, up = 1.5, grav = 3, size = 1, life = 0) {
  for (let i = 0; i < n; i++) {
    const m = FX.puffs[_pi++ % FX.puffs.length];
    m.position.copy(p); m.material.color.setHex(color); m.material.opacity = 0.85; m.visible = true;
    m.userData.v.set(rand(-spread, spread), rand(0, up), rand(-spread, spread));
    m.userData.g = grav; m.userData.life = m.userData.max = life || rand(0.4, 0.8); m.userData.size = size; m.scale.setScalar(size);
  }
}
function muzzleFlash(p) { FX.flash.position.copy(p); FX.flash.distance = 22; FX.flash.intensity = 4; FX.flashT = 0.07; }
function explosionFX(p, r) {
  spawnPuff(p, 0xff7a18, 16, r * 0.5, r * 0.5, -1.5, 8, 0.7);
  spawnPuff(p, 0xffd060, 8, r * 0.3, r * 0.4, -1, 5, 0.5);
  spawnPuff(p, 0x4a4a4a, 18, r * 0.45, r * 0.7, -0.8, 11, 1.5);
  spawnPuff(p, 0xc9a66b, 16, r * 0.9, r * 0.35, 4, 7, 1.1);
  FX.flash.position.copy(p); FX.flash.distance = 70; FX.flash.intensity = 14; FX.flashT = 0.22;
}
function updateFX(dt) {
  for (const m of FX.tracers) if (m.visible) { m.userData.life -= dt; m.material.opacity = Math.max(0, m.userData.life / m.userData.max) * 0.9; if (m.userData.life <= 0) m.visible = false; }
  for (const m of FX.puffs) if (m.visible) {
    const u = m.userData; u.life -= dt;
    u.v.y -= u.g * dt; m.position.addScaledVector(u.v, dt); u.v.multiplyScalar(1 - dt * 0.8);
    m.material.opacity = Math.max(0, u.life / u.max) * 0.85;
    m.scale.setScalar(u.size * (1 + (1 - u.life / u.max) * 1.4));
    if (u.life <= 0) m.visible = false;
  }
  if (FX.flashT > 0) { FX.flashT -= dt; if (FX.flashT <= 0) FX.flash.intensity = 0; }
}

// ---------- Menschen-Modell (runde Formen, Gesicht, Hut, Holster) ----------
// ---------- Figuren: Teile werden zu wenigen Meshes mit Vertexfarben verschmolzen (mehr Detail, weniger Draw-Calls) ----------
const VCMAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const _gc = {};
function gcyl(rt, rb, h, seg = 14) { const k = `c${rt},${rb},${h},${seg}`; return _gc[k] || (_gc[k] = new THREE.CylinderGeometry(rt, rb, h, seg)); }
function gsph(r, ws = 14, hs = 10) { const k = `s${r},${ws},${hs}`; return _gc[k] || (_gc[k] = new THREE.SphereGeometry(r, ws, hs)); }
function gbox(w, h, d) { const k = `b${w},${h},${d}`; return _gc[k] || (_gc[k] = new THREE.BoxGeometry(w, h, d)); }
function gcone(r, h, seg = 8) { const k = `n${r},${h},${seg}`; return _gc[k] || (_gc[k] = new THREE.ConeGeometry(r, h, seg)); }
function gtor(r, t, rs = 6, ts = 14) { const k = `t${r},${t},${rs},${ts}`; return _gc[k] || (_gc[k] = new THREE.TorusGeometry(r, t, rs, ts)); }
const _sc = new THREE.Color();
function shade(hex, k) { _sc.setHex(hex); _sc.multiplyScalar(k); return _sc.getHex(); }
function PB() { return []; }
// Teil hinzufügen: Geometrie, Farbe, Position, Rotation (rx,ry,rz), Skalierung (sx,sy,sz)
function pAdd(pb, geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) { pb.push({ geo, color, m: MX(x, y, z, rx, ry, rz, sx, sy, sz) }); }
// Verschmelzen; optional unten abdunkeln (ao = [y0, y1, minFaktor]) für weiche Schattierung
function pBake(pb, parent, ao) {
  const geo = mergeParts(pb);
  if (ao) {
    const p = geo.attributes.position, c = geo.attributes.color;
    for (let i = 0; i < p.count; i++) { const k = ao[2] + (1 - ao[2]) * clamp((p.getY(i) - ao[0]) / (ao[1] - ao[0]), 0, 1); c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k); }
  }
  const m = new THREE.Mesh(geo, VCMAT); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
// Gebogene Hutkrempe: Seiten nach oben, vorne leicht nach unten
function brimGeo(r, th, curl, droop) {
  const g = new THREE.CylinderGeometry(r, r, th, 32, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) / r, z = p.getZ(i) / r; p.setY(i, p.getY(i) + curl * x * x - droop * Math.max(0, z) * Math.max(0, z) * 1.4 + droop * 0.5 * Math.max(0, -z)); }
  g.computeVertexNormals(); return g;
}
const _brims = {};
function gbrim(r, th, curl, droop) { const k = `${r},${th},${curl},${droop}`; return _brims[k] || (_brims[k] = brimGeo(r, th, curl, droop)); }

function makeHumanoid(o) {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const skin = o.skin || 0xd9a877, skinD = shade(skin, 0.8);
  const pants = o.pants || 0x3a4a5a, shirt = o.shirt || 0x8a4a3a, boot = 0x2a1c14, leather = 0x4a2e1a, dark = 0x1a120c, brass = 0xd8b040;
  const hair = o.hair === undefined ? 0x3a2818 : o.hair;
  const legs = [], arms = [];
  // Beine: Oberschenkel, Knie, Schienbein, Hosenaufschlag, Stiefel mit Absatz und Sporn
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(s * 0.12, 0.93, 0); g.add(leg);
    const b = PB();
    pAdd(b, gsph(0.108, 12, 8), pants, 0, -0.03, 0);
    pAdd(b, gcyl(0.108, 0.083, 0.46), pants, 0, -0.26, 0);
    pAdd(b, gsph(0.085, 10, 8), pants, 0, -0.49, 0.005);
    pAdd(b, gcyl(0.082, 0.07, 0.3), pants, 0, -0.63, 0);
    pAdd(b, gcyl(0.086, 0.088, 0.05), shade(pants, 0.85), 0, -0.64, 0);
    pAdd(b, gcyl(0.074, 0.092, 0.27), boot, 0, -0.77, 0);
    pAdd(b, gcyl(0.095, 0.095, 0.03), shade(boot, 1.5), 0, -0.64, 0);
    pAdd(b, gsph(0.5, 12, 8), boot, 0, -0.875, 0.075, 0, 0, 0, 0.17, 0.11, 0.36);
    pAdd(b, gsph(0.5, 10, 6), shade(boot, 1.35), 0, -0.88, 0.17, 0, 0, 0, 0.14, 0.09, 0.14);
    pAdd(b, gbox(0.12, 0.05, 0.1), dark, 0, -0.905, -0.065);
    pAdd(b, gbox(0.13, 0.02, 0.34), dark, 0, -0.92, 0.06);
    pAdd(b, gsph(0.02, 6, 4), 0xa0a0a0, 0, -0.84, -0.115);
    pAdd(b, gcone(0.022, 0.05, 6), 0xa0a0a0, 0, -0.85, -0.14, -Math.PI / 2);
    pBake(b, leg);
    legs.push(leg);
  }
  // Rumpf, Kopf, Kleidung, Hut – alles statisch in einem Mesh
  const b = PB();
  pAdd(b, gcyl(0.235, 0.24, 0.22, 16), pants, 0, 0.97, 0, 0, 0, 0, 1, 1, 0.75);
  pAdd(b, gcyl(0.27, 0.235, 0.6, 16), shirt, 0, 1.3, 0, 0, 0, 0, 1, 1, 0.72);
  pAdd(b, gsph(0.28, 16, 10), shirt, 0, 1.52, 0, 0, 0, 0, 1, 0.5, 0.74);
  pAdd(b, gtor(0.095, 0.024, 6, 14), shade(shirt, 1.12), 0, 1.6, 0, Math.PI / 2);
  pAdd(b, gcyl(0.06, 0.068, 0.14, 10), skinD, 0, 1.65, 0);
  pAdd(b, gcyl(0.245, 0.245, 0.07, 16), dark, 0, 1.0, 0, 0, 0, 0, 1, 1, 0.75);
  pAdd(b, gbox(0.085, 0.065, 0.03), brass, 0, 1.0, 0.186);
  pAdd(b, gbox(0.09, 0.22, 0.12), leather, 0.27, 0.86, 0.02);
  pAdd(b, gbox(0.035, 0.08, 0.055), 0x5a3a22, 0.27, 0.99, 0.0);
  pAdd(b, gbox(0.08, 0.07, 0.06), leather, -0.255, 0.975, 0.08);
  if (o.vest) {
    pAdd(b, gcyl(0.285, 0.248, 0.48, 16), o.vest, 0, 1.32, 0, 0, 0, 0, 1, 1, 0.76);
    pAdd(b, gbox(0.075, 0.46, 0.02), shirt, 0, 1.32, 0.215);
    for (let i = 0; i < 3; i++) pAdd(b, gsph(0.012, 5, 4), brass, 0, 1.18 + i * 0.12, 0.226);
  }
  if (o.coat) {
    pAdd(b, gcyl(0.29, 0.4, 0.95, 18), o.coat, 0, 0.82, -0.01, 0, 0, 0, 1, 1, 0.72);
    pAdd(b, gcyl(0.15, 0.22, 0.1, 14), o.coat, 0, 1.58, 0, 0, 0, 0, 1, 1, 0.9);
    pAdd(b, gbox(0.02, 0.9, 0.02), shade(o.coat, 0.55), 0, 0.84, 0.262);
    pAdd(b, gbox(0.09, 0.4, 0.03), shade(o.coat, 0.75), 0.1, 1.38, 0.2, 0, 0, 0.22);
    pAdd(b, gbox(0.09, 0.4, 0.03), shade(o.coat, 0.75), -0.1, 1.38, 0.2, 0, 0, -0.22);
  }
  if (o.badge) pAdd(b, gcyl(0.05, 0.05, 0.02, 5), 0xe8c040, 0.15, 1.44, 0.2, Math.PI / 2);
  if (o.poncho) {
    pAdd(b, gcyl(0.2, 0.5, 0.58, 20), o.poncho, 0, 1.35, 0, 0, 0, 0, 1, 1, 0.72);
    pAdd(b, gcyl(0.505, 0.505, 0.06, 20), o.poncho2 || 0xe8d8b0, 0, 1.1, 0, 0, 0, 0, 1, 1, 0.73);
    pAdd(b, gcyl(0.28, 0.4, 0.05, 20), o.poncho2 || 0xe8d8b0, 0, 1.3, 0, 0, 0, 0, 1, 1, 0.73);
    pAdd(b, gcyl(0.12, 0.2, 0.04, 14), o.poncho2 || 0xe8d8b0, 0, 1.63, 0);
  }
  if (o.bandolier) {
    pAdd(b, gbox(0.07, 0.72, 0.04), 0x3a2414, 0.02, 1.3, 0.2, 0, 0, 0.7);
    for (let i = -3; i <= 3; i++) pAdd(b, gcyl(0.016, 0.016, 0.06, 6), 0xc8a040, 0.02 - 0.093 * i, 1.3 + 0.109 * i, 0.226);
  }
  // Kopf
  pAdd(b, gsph(0.135, 18, 14), skin, 0, 1.79, 0.005, 0, 0, 0, 1, 1.18, 1.08);
  pAdd(b, gsph(0.105, 14, 10), skin, 0, 1.725, 0.035, 0, 0, 0, 1, 0.85, 1);
  for (const s of [-1, 1]) {
    pAdd(b, gsph(0.032, 8, 6), skinD, s * 0.136, 1.79, 0, 0, 0, 0, 0.5, 1, 0.8);
    pAdd(b, gsph(0.017, 8, 6), 0xf2eee0, s * 0.05, 1.82, 0.135, 0, 0, 0, 1, 0.7, 0.5);
    pAdd(b, gsph(0.0105, 6, 5), 0x14100c, s * 0.05, 1.82, 0.142, 0, 0, 0, 1, 1, 0.5);
    pAdd(b, gbox(0.05, 0.012, 0.02), hair === null ? 0x3a2818 : hair, s * 0.05, 1.848, 0.136, 0, 0, -s * 0.15);
  }
  pAdd(b, gsph(0.027, 8, 6), skin, 0, 1.775, 0.146, 0, 0, 0, 0.8, 1.15, 1.3);
  pAdd(b, gbox(0.024, 0.05, 0.03), skin, 0, 1.8, 0.14);
  pAdd(b, gbox(0.05, 0.008, 0.01), shade(skin, 0.55), 0, 1.722, 0.14);
  if (o.stache) for (const s of [-1, 1]) pAdd(b, gsph(0.034, 8, 6), hair === null ? 0x2a1a10 : (hair || 0x2a1a10), s * 0.032, 1.742, 0.143, 0, 0, -s * 0.25, 1.5, 0.55, 0.8);
  if (hair !== null) {
    pAdd(b, gsph(0.14, 16, 10), hair, 0, 1.84, -0.03, 0, 0, 0, 1, 0.9, 1);
    for (const s of [-1, 1]) pAdd(b, gsph(0.04, 8, 6), hair, s * 0.115, 1.8, 0.03, 0, 0, 0, 0.4, 1.3, 1);
  }
  if (o.beard) pAdd(b, gsph(0.12, 14, 10), hair === null ? 0x2a1a10 : (hair || 0x2a1a10), 0, 1.69, 0.05, 0, 0, 0, 1, 0.8, 0.8);
  if (o.scarf) {
    pAdd(b, gcyl(0.1, 0.12, 0.1, 14), o.scarf, 0, 1.66, 0.01);
    pAdd(b, gsph(0.04, 8, 6), shade(o.scarf, 0.85), 0.05, 1.6, 0.115);
    pAdd(b, gbox(0.07, 0.17, 0.025), shade(o.scarf, 0.9), 0.06, 1.5, 0.19, 0.1, 0, 0.1);
  }
  if (o.mask) {
    pAdd(b, gcyl(0.14, 0.13, 0.065, 16), o.mask, 0, 1.712, 0.014, 0, 0, 0, 1, 1, 1.1);
    pAdd(b, gsph(0.035, 8, 6), shade(o.mask, 0.8), 0, 1.712, -0.15);
    pAdd(b, gbox(0.06, 0.1, 0.02), shade(o.mask, 0.9), 0.03, 1.66, -0.15, 0.2, 0, 0.2);
  }
  // Hut mit gebogener Krempe
  if (o.hat !== undefined && o.hat !== null) {
    const hs = o.hatStyle || 'cowboy', hat = o.hat, hatD = shade(hat, 0.78), band = o.band;
    if (hs === 'bowler') {
      pAdd(b, gbrim(0.25, 0.025, 0.04, 0.01), hat, 0, 1.935, 0, 0, 0, 0, 1, 1, 1.06);
      pAdd(b, gsph(0.17, 16, 10), hat, 0, 1.95, 0, 0, 0, 0, 1, 1.2, 1);
      pAdd(b, gcyl(0.172, 0.176, 0.035, 14), band || 0x1a1a1a, 0, 1.965, 0);
    } else if (hs === 'sombrero') {
      pAdd(b, gbrim(0.62, 0.03, 0.17, 0.03), hat, 0, 1.92, 0);
      pAdd(b, gcyl(0.1, 0.19, 0.3, 16), hat, 0, 2.08, 0);
      pAdd(b, gsph(0.1, 10, 6), hat, 0, 2.23, 0, 0, 0, 0, 1, 0.4, 1);
      pAdd(b, gcyl(0.192, 0.2, 0.05, 16), band || 0xa02020, 0, 1.97, 0);
      pAdd(b, gbrim(0.585, 0.012, 0.17, 0.03), shade(band || 0xa02020, 1), 0, 1.925, 0);
    } else if (hs === 'flat') {
      pAdd(b, gbrim(0.34, 0.025, 0.02, 0.01), hat, 0, 1.93, 0, 0, 0, 0, 1, 1, 1.05);
      pAdd(b, gcyl(0.18, 0.18, 0.13, 16), hat, 0, 2.0, 0);
      pAdd(b, gcyl(0.17, 0.17, 0.01, 16), hatD, 0, 2.067, 0);
      pAdd(b, gcyl(0.184, 0.184, 0.035, 16), band || 0x2a1a10, 0, 1.955, 0);
    } else if (hs === 'fur') {
      pAdd(b, gcyl(0.17, 0.18, 0.2, 12), hat, 0, 1.98, 0);
      pAdd(b, gsph(0.17, 12, 8), hat, 0, 2.07, 0, 0, 0, 0, 1, 0.55, 1);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; pAdd(b, gsph(0.05, 6, 5), hatD, Math.cos(a) * 0.175, 1.9, Math.sin(a) * 0.175); }
      pAdd(b, gcyl(0.035, 0.02, 0.4, 6), hat, 0, 1.9, -0.25, 0.9);
      pAdd(b, gcyl(0.036, 0.036, 0.04, 6), hatD, 0, 1.76, -0.43, 0.9);
    } else {
      pAdd(b, gbrim(0.36, 0.03, 0.1, 0.05), hat, 0, 1.93, 0.01, 0, 0, 0, 1, 1, 1.08);
      pAdd(b, gcyl(0.158, 0.2, 0.22, 16), hat, 0, 2.03, 0);
      pAdd(b, gsph(0.158, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), hat, 0, 2.14, 0, 0, 0, 0, 1, 0.35, 1);
      pAdd(b, gcyl(0.11, 0.11, 0.012, 12), hatD, 0, 2.168, 0.01, 0, 0, 0, 1, 1, 0.45);
      pAdd(b, gcyl(0.205, 0.209, 0.04, 16), band || 0x2a1a10, 0, 1.96, 0);
      pAdd(b, gbox(0.04, 0.035, 0.012), 0xc8a848, 0, 1.96, 0.21);
    }
  }
  pBake(b, g);
  // Arme: Schulter, Oberarm, Ellbogen, Unterarm, Manschette, Hand mit Daumen
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.34, 1.54, 0); g.add(arm);
    const a = PB();
    pAdd(a, gsph(0.095, 12, 8), shirt, 0, 0, 0);
    pAdd(a, gcyl(0.073, 0.059, 0.3, 12), shirt, 0, -0.15, 0);
    pAdd(a, gsph(0.06, 8, 6), shirt, 0, -0.3, 0);
    pAdd(a, gcyl(0.059, 0.048, 0.28, 12), shirt, 0, -0.44, 0);
    pAdd(a, gcyl(0.052, 0.054, 0.05, 12), shade(shirt, 0.82), 0, -0.56, 0);
    pAdd(a, gsph(0.05, 10, 8), skin, 0, -0.615, 0, 0, 0, 0, 1, 1.15, 0.85);
    pAdd(a, gsph(0.022, 6, 5), skin, -s * 0.04, -0.6, 0.02);
    pAdd(a, gbox(0.07, 0.05, 0.03), skinD, 0, -0.665, 0.01);
    pBake(a, arm);
    arms.push(arm);
  }
  const hand = new THREE.Group(); hand.position.set(0, -0.6, 0.02); hand.rotation.x = Math.PI / 2; arms[1].add(hand);
  return { g, legs, arms, hand, held: undefined };
}

// ---------- Waffenmodelle (Lauf zeigt in +z, Griff am Ursprung) ----------
const _wpnCache = {};
function makeWeaponModel(key) {
  const w = WEAPONS[key], s = w.model || {}, g = new THREE.Group();
  const metal = lam(s.metal || 0x2a2a2e), wood = lam(s.wood || 0x5a3a22);
  const zc = (r1, r2, len, seg = 7) => { const c = new THREE.CylinderGeometry(r1, r2, len, seg); c.rotateX(Math.PI / 2); return c; };
  if (s.kind === 'bow') {
    const inner = new THREE.Group(); inner.rotation.y = -Math.PI / 2; inner.position.z = -0.42; g.add(inner);
    const arc = addMesh(inner, new THREE.TorusGeometry(0.45, 0.016, 4, 14, Math.PI * 0.9), wood, 0, 0, 0, false); arc.rotation.z = -Math.PI * 0.45;
    addMesh(g, new THREE.BoxGeometry(0.004, 0.88, 0.004), lam(0xe8e0c8), 0, 0, -0.35, false);
    addMesh(g, new THREE.BoxGeometry(0.035, 0.1, 0.04), lam(0x3a2414), 0, 0, 0, false);
  } else if (s.kind === 'pistol') {
    const len = s.len || 0.16;
    addMesh(g, new THREE.BoxGeometry(0.04, 0.12, 0.06), wood, 0, -0.06, -0.02, false).rotation.x = 0.3;
    addMesh(g, new THREE.BoxGeometry(0.045, 0.06, 0.12), metal, 0, 0.02, 0.03, false);
    if (s.drum) addMesh(g, zc(0.036, 0.036, 0.07, 8), metal, 0, 0.035, 0.06, false);
    if (s.box) addMesh(g, new THREE.BoxGeometry(0.05, 0.1, 0.07), metal, 0, -0.02, 0.1, false);
    const n = s.double ? 2 : 1;
    for (let i = 0; i < n; i++) addMesh(g, zc(s.bore || 0.014, s.bore || 0.014, len), metal, n > 1 ? (i ? 0.02 : -0.02) : 0, 0.045, 0.09 + len / 2, false);
    if (s.under) addMesh(g, zc(0.01, 0.01, len * 0.8), metal, 0, 0.018, 0.09 + len * 0.4, false);
  } else {
    const len = s.len || 0.7;
    addMesh(g, new THREE.BoxGeometry(0.05, 0.1, s.stock || 0.34), wood, 0, -0.04, -(s.stock || 0.34) / 2 - 0.02, false);
    addMesh(g, new THREE.BoxGeometry(0.055, 0.075, 0.18), metal, 0, 0.02, 0.04, false);
    const n = s.double ? 2 : 1;
    for (let i = 0; i < n; i++) addMesh(g, zc(s.bore || 0.017, s.bore || 0.017, len), metal, n > 1 ? (i ? 0.022 : -0.022) : 0, 0.045, 0.12 + len / 2, false);
    addMesh(g, new THREE.BoxGeometry(0.05, 0.045, len * 0.45), wood, 0, 0.01, 0.14 + len * 0.22, false);
    if (s.pump) addMesh(g, zc(0.028, 0.028, 0.16), wood, 0, 0.012, 0.12 + len * 0.55, false);
    if (s.tube) addMesh(g, zc(0.011, 0.011, len * 0.85), metal, 0, 0.018, 0.12 + len * 0.43, false);
    if (s.scope) addMesh(g, zc(0.024, 0.024, 0.34, 8), lam(0x111114), 0, 0.105, 0.1, false);
    if (s.lever) { const l = addMesh(g, new THREE.TorusGeometry(0.045, 0.008, 4, 8), metal, 0, -0.05, 0.05, false); l.rotation.y = Math.PI / 2; }
  }
  return g;
}
function setHeldWeapon(m, key) {
  if (m.held === key) return;
  m.held = key;
  while (m.hand.children.length) m.hand.remove(m.hand.children[0]);
  if (!key || !WEAPONS[key]) return;
  const proto = _wpnCache[key] || (_wpnCache[key] = makeWeaponModel(key));
  m.hand.add(proto.clone());
}

// ---------- Vierbeiner (Pferd, Hirsch, Kuh, Wolf) ----------
function makeQuad(o) {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const { bl, bw, bh, ll, lt = 0.16 } = o;
  const col = o.color, dk = o.dark || 0x222222, light = shade(col, 1.18), hoofC = shade(dk, 0.6);
  const r0 = bh / 2, sx = bw / bh, by = ll + r0, isHorse = !!o.saddle;
  const b = PB();
  // Rumpf: Brust, Bauch, Hinterhand, Widerrist
  pAdd(b, gcyl(r0, r0 * 0.95, bl * 0.72, 20), col, 0, by, 0, Math.PI / 2, 0, 0, sx, 1, 1);
  pAdd(b, gsph(r0 * 1.03, 18, 12), col, 0, by + 0.01, bl * 0.34, 0, 0, 0, sx, 1.02, 1);
  pAdd(b, gsph(r0 * 1.0, 18, 12), col, 0, by + 0.02, -bl * 0.34, 0, 0, 0, sx * 1.02, 1.02, 1.05);
  pAdd(b, gsph(r0 * 0.55, 12, 8), col, 0, by + r0 * 0.72, bl * 0.2, 0, 0, 0, sx * 0.9, 0.7, 1.5);
  pAdd(b, gsph(r0 * 0.9, 14, 10), light, 0, by - r0 * 0.18, 0, 0, 0, 0, sx * 0.8, 0.7, bl * 0.55 / r0);
  // Hals
  const nl = o.nl, na = o.neckAngle === undefined ? 0.55 : o.neckAngle;
  const nb = new V3(0, ll + bh * 0.85, bl / 2 - 0.1), ca = Math.cos(na), sa = Math.sin(na);
  pAdd(b, gcyl(bw * 0.2, bw * 0.31, nl, 14), col, nb.x, nb.y + nl / 2 * ca, nb.z + nl / 2 * sa, na, 0, 0, 0.9, 1, 1);
  const nt = new V3(0, nb.y + nl * ca, nb.z + nl * sa);
  // Kopf: schräg nach vorne unten
  const ha = o.headAngle === undefined ? (isHorse ? 0.62 : 0.5) : o.headAngle, dir = new V3(0, -Math.sin(ha), Math.cos(ha)).normalize();
  const hl = o.hl, hc = new V3().copy(nt).addScaledVector(dir, hl * 0.5), hm = new V3().copy(nt).addScaledVector(dir, hl);
  pAdd(b, gcyl(bw * 0.25, bw * 0.15, hl, 12), o.headDark ? dk : col, hc.x, hc.y, hc.z, Math.PI / 2 + ha, 0, 0, 0.82, 1, 1);
  pAdd(b, gsph(bw * 0.24, 12, 10), o.headDark ? dk : col, nt.x, nt.y - 0.02, nt.z + 0.0, 0, 0, 0, 0.85, 1, 1.05);
  pAdd(b, gsph(bw * 0.17, 12, 10), dk, hm.x, hm.y, hm.z + 0.005, 0, 0, 0, 0.85, 0.9, 1.05);
  for (const s of [-1, 1]) {
    pAdd(b, gsph(0.012, 5, 4), 0x050505, s * bw * 0.1, hm.y + 0.02, hm.z + bw * 0.12);
    pAdd(b, gsph(0.03, 8, 6), 0x0a0808, s * bw * 0.2, nt.y + 0.02, nt.z + hl * 0.2 * Math.cos(ha) + 0.02, 0, 0, 0, 0.6, 1, 1);
    pAdd(b, gsph(0.009, 5, 4), 0xffffff, s * bw * 0.21, nt.y + 0.03, nt.z + hl * 0.2 * Math.cos(ha) + 0.035);
    pAdd(b, gcone(0.05, o.antlers ? 0.17 : 0.15, 6), col, s * bw * 0.16, nt.y + bw * 0.27, nt.z - 0.03, 0.15, 0, -s * 0.28);
    pAdd(b, gcone(0.028, 0.1, 5), shade(dk, 0.8), s * bw * 0.16, nt.y + bw * 0.26, nt.z - 0.015, 0.15, 0, -s * 0.28);
  }
  if (o.blaze) pAdd(b, gbox(bw * 0.07, hl * 0.7, 0.01), 0xf0ead8, 0, hc.y + 0.05, hc.z + 0.05, Math.PI / 2 + ha);
  // Mähne und Schopf
  if (o.mane) {
    for (let i = 0; i <= 9; i++) {
      const t = i / 9, px = nb.z + nl * t * sa - ca * bw * 0.3 * 0.85, py = nb.y + nl * t * ca + sa * bw * 0.3 * 0.85;
      pAdd(b, gsph(0.07, 8, 6), dk, 0, py, px, 0, 0, 0, 0.55, 1.7, 1.1);
    }
    pAdd(b, gsph(0.06, 8, 6), dk, 0, nt.y + bw * 0.2, nt.z + 0.06, 0, 0, 0, 0.6, 1.1, 1.6);
  }
  if (o.antlers) for (const s of [-1, 1]) {
    const aC = 0xd8cdb0;
    pAdd(b, gcyl(0.015, 0.03, 0.7, 5), aC, s * 0.12, nt.y + 0.4, nt.z + 0.0, -0.15, 0, -s * 0.45);
    pAdd(b, gcyl(0.012, 0.02, 0.4, 5), aC, s * 0.27, nt.y + 0.58, nt.z - 0.02, 0, 0, s * 0.3);
    for (const [h, l] of [[0.25, 0.22], [0.45, 0.2]]) pAdd(b, gcyl(0.008, 0.016, l, 4), aC, s * (0.08 + h * 0.5), nt.y + 0.18 + h * 0.9, nt.z + 0.08, 0.7, 0, -s * 0.2);
  }
  if (o.patches) {
    for (let i = 0; i < 5; i++) pAdd(b, gsph(r0 * 0.7, 8, 6), dk, rand(-0.3, 0.3), by + rand(-0.1, 0.25), rand(-bl * 0.28, bl * 0.28), 0, 0, 0, 1, 0.9, 1.2);
    for (const s of [-1, 1]) pAdd(b, gcone(0.035, 0.18, 6), 0xe8e0c0, s * bw * 0.22, nt.y + bw * 0.28, nt.z + 0.0, 0, 0, -s * 1.0);
    pAdd(b, gsph(r0 * 0.5, 10, 8), 0xe0a0a0, 0, ll + 0.12, -bl * 0.3, 0, 0, 0, 0.9, 0.7, 1);
  }
  // Schwanz: hängt nach hinten unten
  const tl = o.tl || 0.6, tb = new V3(0, ll + bh * 0.86, -bl / 2 - 0.02), tc = o.tailDark ? dk : col;
  pAdd(b, gsph(0.065, 8, 6), col, tb.x, tb.y, tb.z);
  pAdd(b, gcyl(0.085, 0.045, tl, 8), tc, 0, tb.y - tl / 2 * 0.94, tb.z - tl / 2 * 0.34, 0.35, 0, 0);
  if (isHorse || o.tailDark) pAdd(b, gsph(0.09, 8, 6), tc, 0, tb.y - tl * 0.78, tb.z - tl * 0.32, 0.35, 0, 0, 1, tl * 2.2, 1.1);
  // Sattel, Zaumzeug
  if (isHorse) {
    const sy = ll + bh;
    pAdd(b, gbox(bw * 1.1, 0.045, 0.74), 0x8a2a22, 0, sy - 0.005, -0.05);
    pAdd(b, gbox(bw * 0.9, 0.05, 0.5), 0x5b3a22, 0, sy + 0.04, -0.08);
    pAdd(b, gbox(bw * 0.8, 0.07, 0.4), 0x6b4428, 0, sy + 0.09, -0.08);
    pAdd(b, gbox(bw * 0.78, 0.13, 0.07), 0x5b3a22, 0, sy + 0.14, -0.33);
    pAdd(b, gcyl(0.03, 0.045, 0.15, 8), 0x3a2418, 0, sy + 0.18, 0.18);
    pAdd(b, gsph(0.045, 8, 6), 0x3a2418, 0, sy + 0.27, 0.18);
    pAdd(b, gbox(bw * 1.04, 0.05, 0.06), 0x3a2418, 0, ll + bh * 0.42, 0.12);
    pAdd(b, gbox(bw * 1.05, 0.2, 0.04), 0x3a2418, 0, ll + bh * 0.6, 0.12);
    for (const s of [-1, 1]) {
      pAdd(b, gbox(0.025, 0.34, 0.05), 0x3a2418, s * (bw * 0.5 + 0.04), sy - 0.14, -0.04);
      pAdd(b, gtor(0.06, 0.009, 4, 10), 0x9a9a9a, s * (bw * 0.5 + 0.04), sy - 0.34, -0.04, 0, Math.PI / 2, 0);
    }
    pAdd(b, gbox(0.012, 0.012, 0.9), 0x2a1c14, bw * 0.12, ll + bh + 0.04, 0.6, 0.35, 0, 0);
  }
  pBake(b, g, [ll * 0.3, ll + bh, 0.72]);
  // Beine: Oberschenkel, Gelenk, Röhrbein, Fesselgelenk, Huf
  const legs = [];
  for (const [sx2, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const leg = new THREE.Group(); leg.position.set(sx2 * bw * 0.34, ll + 0.05, sz * bl * 0.34); g.add(leg);
    const l = PB(), sock = isHorse && o.dark === HORSE_COLORS[2].d ? 0xf0ead8 : col;
    pAdd(l, gcyl(lt * 0.95, lt * 0.6, ll * 0.52, 10), col, 0, -ll * 0.25, 0);
    pAdd(l, gsph(lt * 0.58, 8, 6), col, 0, -ll * 0.5, 0);
    pAdd(l, gcyl(lt * 0.46, lt * 0.4, ll * 0.42, 8), shade(col, 0.92), 0, -ll * 0.72, 0);
    pAdd(l, gsph(lt * 0.46, 8, 6), shade(col, 0.9), 0, -ll * 0.92, 0.01);
    pAdd(l, gcyl(lt * 0.42, lt * 0.46, ll * 0.1, 8), sock, 0, -ll * 0.95, 0.01);
    pAdd(l, gcyl(lt * 0.52, lt * 0.64, ll * 0.12, 8), hoofC, 0, -ll * 0.99, 0.015);
    if (sz < 0) pAdd(l, gsph(lt * 0.7, 8, 6), col, 0, -ll * 0.14, -0.02, 0, 0, 0, 1, 1.6, 1.1);
    pBake(l, leg, [-ll, 0, 0.8]);
    legs.push(leg);
  }
  return { g, legs };
}
function animateQuad(q, ph, amp) {
  const s = Math.sin(ph) * amp;
  q.legs[0].rotation.x = s; q.legs[3].rotation.x = s;
  q.legs[1].rotation.x = -s; q.legs[2].rotation.x = -s;
}

// ---------- Pferd ----------
const HORSE_COLORS = [{ c: 0x7a4a2a, d: 0x2a1a10 }, { c: 0x3a2a22, d: 0x120c08 }, { c: 0xc9a06a, d: 0xe8dcc0 }, { c: 0x9a9a9a, d: 0x3a3a3a }];
class Horse {
  constructor(x, z, col) {
    const cc = col || HORSE_COLORS[0];
    this.q = makeQuad({ bl: 1.9, bw: 0.62, bh: 0.8, ll: 1.0, lt: 0.17, nl: 0.85, hl: 0.72, color: cc.c, dark: cc.d, mane: true, tailDark: true, tl: 0.9, saddle: true });
    this.g = this.q.g; this.x = x; this.z = z; this.y = heightAt(x, z); this.yaw = rand(0, 6.28);
    this.speed = 0; this.target = 0; this.turn = 0; this.phase = 0; this.grounded = true; this.rider = false; this.calling = false;
    this.stamina = 100; this.tired = false; this.stepAcc = 0; this.pitch = 0;
    scene.add(this.g);
  }
  update(dt) {
    if (!this.rider) {
      if (this.calling) {
        const dx = player.x - this.x, dz = player.z - this.z, d = Math.hypot(dx, dz);
        if (d < 5) { this.calling = false; this.target = 0; }
        else {
          this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 3));
          this.target = d > 25 ? 15 : d > 10 ? 8 : 3;
        }
      } else { this.target = 0; this.turn = 0; }
      this.stamina = Math.min(100, this.stamina + dt * 15);
    }
    this.speed = lerp(this.speed, this.target, 1 - Math.exp(-dt * (this.target > this.speed ? 1.6 : 3.2)));
    if (this.speed < 0.05 && this.target === 0) this.speed = 0;
    const turnRate = this.rider ? (0.5 + 1.5 * (1 - clamp(Math.abs(this.speed) / 18, 0, 1))) : 1;
    this.yaw += this.turn * dt * turnRate * (Math.abs(this.speed) < 0.5 ? 0.9 : 1);
    const inWater = heightAt(this.x, this.z) < WATER_Y + 0.3;
    const sp = this.speed * (inWater ? 0.55 : 1);
    tryMove(this, Math.sin(this.yaw) * sp * dt, Math.cos(this.yaw) * sp * dt, 0.9, 1.4);
    this.y = heightAt(this.x, this.z);
    if (inWater) this.y = Math.max(this.y, WATER_Y - 0.6);
    const fx = this.x + Math.sin(this.yaw) * 1.1, fz = this.z + Math.cos(this.yaw) * 1.1;
    const bx = this.x - Math.sin(this.yaw) * 1.1, bz = this.z - Math.cos(this.yaw) * 1.1;
    this.pitch = lerp(this.pitch, -Math.atan2(heightAt(fx, fz) - heightAt(bx, bz), 2.2), 0.2);
    this.g.position.set(this.x, this.y, this.z);
    this.g.rotation.y = this.yaw; this.g.rotation.x = this.pitch;
    const moving = Math.abs(this.speed) > 0.3;
    this.phase += Math.abs(this.speed) * dt * (this.speed > 11 ? 1.05 : 1.6);
    animateQuad(this.q, this.phase * (this.speed > 11 ? 1.2 : 1) * 1.3, moving ? clamp(Math.abs(this.speed) / 9, 0.25, 1) : 0);
    if (moving) {
      this.stepAcc += Math.abs(this.speed) * dt;
      const stride = this.speed > 11 ? 3.0 : 2.2;
      if (this.stepAcc > stride) {
        this.stepAcc = 0; SFX.hoof(clamp(this.speed / 12, 0.3, 1) * (1 / (1 + Math.hypot(player.x - this.x, player.z - this.z) * 0.05)));
        if (this.speed > 6 && !inWater) spawnPuff(new V3(this.x - Math.sin(this.yaw) * 0.6, this.y + 0.1, this.z - Math.cos(this.yaw) * 0.6), 0xbfa572, this.speed > 11 ? 3 : 1, 0.6, 0.8, 1.5, 0.8, 1);
      }
    }
  }
}

// ---------- Menschen ----------
const humans = [], animals = [];
const KINDS = {
  outlaw: { hp: 60, speed: 4.6, acc: 0.42, dmg: [6, 10], rate: [1.1, 1.9], range: 62, near: 12, far: 30, bounty: [15, 40] },
  boss: { hp: 260, speed: 3.8, acc: 0.55, dmg: [9, 14], rate: [0.7, 1.2], range: 70, near: 14, far: 32, bounty: [400, 400] },
  lawman: { hp: 80, speed: 5.2, acc: 0.5, dmg: [7, 11], rate: [1.0, 1.6], range: 65, near: 12, far: 30, bounty: [0, 0] },
  civilian: { hp: 30, speed: 2.0, acc: 0, dmg: [0, 0], rate: [9, 9], range: 0, near: 0, far: 0, bounty: [0, 6] },
  sheriff: { hp: 130, speed: 5, acc: 0.55, dmg: [8, 12], rate: [0.9, 1.4], range: 65, near: 12, far: 30, bounty: [0, 0] },
};
const VARIANTS = {
  gun: { weapon: 'rev' },
  shotgun: { weapon: 'shotgun', hp: 85, dmg: [16, 24], rate: [1.5, 2.2], acc: 0.7, accFall: 38, near: 3, far: 13, range: 32, speed: 5.8, long: 1.0, pellets: 5, look: { coat: 0x4a3a2a, hat: 0x3a2a1a } },
  rifle: { weapon: 'rifle', hp: 60, dmg: [15, 21], rate: [2.0, 2.8], acc: 0.66, accFall: 260, near: 34, far: 70, range: 125, speed: 3.8, long: 1.5, look: { hat: 0x6a5a3a, band: 0xa02020 } },
  carbine: { weapon: 'carbine', hp: 65, dmg: [9, 13], rate: [0.7, 1.1], acc: 0.5, accFall: 200, near: 16, far: 40, range: 85, speed: 4.4, long: 1.0, look: { hatStyle: 'flat', hat: 0x3a3226, bandolier: true } },
  sawedoff: { weapon: 'sawedoff', hp: 75, dmg: [18, 26], rate: [1.6, 2.4], acc: 0.72, accFall: 28, near: 2, far: 9, range: 22, speed: 6.2, pellets: 5, look: { hatStyle: 'bowler', hat: 0x1a1a1a, vest: 0x5a1a1a } },
  dynamiter: { weapon: 'rev', hp: 65, dmg: [5, 8], rate: [2.0, 3.0], near: 14, far: 34, range: 50, dynamite: true, look: { vest: 0x7a2a1a, scarf: 0x222222 } },
  duelist: { weapon: 'schof', hp: 70, dmg: [24, 32], rate: [0.6, 0.9], acc: 0.72, accFall: 500, near: 0, far: 999, range: 60, noMove: true, look: { shirt: 0xe8e0d0, pants: 0x1a1a1a, hat: 0x111111, scarf: 0xa01818, vest: 0x1a1a1a, stache: true } },
};
const OUTLAW_LOOKS = [
  { shirt: 0x5a3a2a, pants: 0x2f2a26, hat: 0x2a1c14, scarf: 0x8a1a1a, stache: true }, { shirt: 0x3a3f4a, pants: 0x3a3226, hat: 0x4a3a2a, mask: 0x777777 },
  { shirt: 0x6a5a3a, pants: 0x2a2a2a, hat: 0x1a1a1a, vest: 0x3a2a1a, stache: true }, { shirt: 0x7a2a22, pants: 0x3a3a3a, hat: 0x5a4a30, scarf: 0x222222 },
  { shirt: 0xc8b890, pants: 0x4a3a2a, hat: 0x9a8058, hatStyle: 'sombrero', poncho: 0x8a3a1a, poncho2: 0xd8c080, beard: true }, { shirt: 0x4a4a3a, pants: 0x2a2a22, hat: 0x5a4028, hatStyle: 'fur', beard: true, coat: 0x6a4a2a },
  { shirt: 0x2a2a2a, pants: 0x1a1a1a, hat: 0x222222, hatStyle: 'flat', mask: 0x3a1a1a, bandolier: true },
];
const CIV_LOOKS = [
  { shirt: 0xd8d0c0, pants: 0x4a4a52, hat: 0x8a7a5a, stache: true }, { shirt: 0x4a6a8a, pants: 0x3a3226, hat: 0x3a2a1a, vest: 0x5a4a3a },
  { shirt: 0xa84a4a, pants: 0x2a2a3a, hat: null, hair: 0x7a5a2a }, { shirt: 0x6a8a5a, pants: 0x5a4a3a, hat: 0xc9b48a },
  { shirt: 0xc8a0a0, pants: 0x6a4a5a, hat: 0xd8c8a8, hair: 0x5a3a20, coat: 0x8a5a6a },
  { shirt: 0xf0ece0, pants: 0x2a2a2a, hat: 0x2a2a2a, hatStyle: 'bowler', vest: 0x6a1a2a, stache: true }, { shirt: 0xe0d8c0, pants: 0x3a3a3a, hat: 0x3a3a3a, hatStyle: 'flat', coat: 0x2a2a3a, beard: true },
  { shirt: 0xd8c8a0, pants: 0x5a4a3a, hat: 0xb8a070, hatStyle: 'sombrero', poncho: 0x3a6a5a, poncho2: 0xe8d8b0 },
];
const SKINS = [0xd9a877, 0xc48a5e, 0xe8c09a, 0x8a5a3a, 0xb07a52];
const TALK = ['Schöner Tag, Fremder.', 'Halt dich von den Coyote-Hollow-Banditen fern!', 'Der Sheriff sucht Hilfe, sagt man.', 'Im Saloon gibt es den besten Whiskey westlich vom Fluss.', 'Ohne Pferd kommt man hier nicht weit.', 'Nachts heulen die Kojoten. Und Schlimmeres.', 'Black Jack Morgan soll ein Fort im Südwesten haben.', 'Bitte keinen Ärger, Mister.', 'Am Ostende der Stadt wartet ein Revolverheld auf Herausforderer.', 'Der Waffenhändler hat neue Ware. Schrotflinten, Scharfschützengewehre…', 'Wölfe reißen bei Nacht sogar Rinder. Bleib auf der Straße.', 'Sonne, Staub und Ärger. Das ist Copper Creek.'];

class Human {
  constructor(kind, x, z, o = {}) {
    this.kind = kind; this.variant = o.variant || 'gun';
    this.cfg = Object.assign({}, KINDS[kind], VARIANTS[this.variant] || {});
    this.x = x; this.z = z; this.y = heightAt(x, z);
    this.yaw = rand(0, 6.28); this.grounded = true;
    this.hp = this.maxHp = this.cfg.hp * (o.hpMul || 1); this.dead = false; this.deadT = 0; this.looted = false;
    this.state = kind === 'lawman' || kind === 'sheriff' ? 'guard' : kind === 'civilian' ? 'walk' : 'idle';
    this.camp = o.camp === undefined ? -1 : o.camp; this.home = { x, z }; this.tx = x; this.tz = z; this.wanderT = rand(0, 4);
    this.scanT = rand(0, 0.5); this.shootCd = rand(0.5, 1.5); this.clip = 6; this.reloadT = 0; this.aimT = 0; this.dynT = rand(3, 6);
    this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = rand(1, 3); this.alertDelay = 0; this.fleeT = 0; this.phase = rand(0, 6); this.speedNow = 0;
    this.spawned = !!o.spawned; this.name = o.name || ''; this.bountyName = o.bountyName || ''; this.bountyReward = o.bountyReward || 0;
    let look;
    if (kind === 'outlaw') look = Object.assign({}, pick(OUTLAW_LOOKS), this.cfg.look || {});
    else if (kind === 'boss') look = { shirt: 0x1a1a1a, pants: 0x1a1a1a, hat: 0x0a0a0a, scarf: 0xa01818, vest: 0x2a1a10, coat: 0x151515, stache: true, band: 0xc0a040 };
    else if (kind === 'lawman' || kind === 'sheriff') look = { shirt: 0x6a7a8a, pants: 0x3a3a4a, hat: 0x6a5a3a, vest: 0x3a2a1a, badge: true, stache: kind === 'sheriff' };
    else look = Object.assign({}, pick(CIV_LOOKS));
    if (this.bountyName) look.scarf = 0xc01818;
    look.skin = pick(SKINS); look.hair = look.hair === undefined ? pick([0x2a1a10, 0x4a3018, 0x7a5a2a, 0x8a8a8a, 0x1a1a1a]) : look.hair;
    this.m = makeHumanoid(look);
    this.g = this.m.g;
    const sc = kind === 'boss' ? 1.12 : kind === 'civilian' ? rand(0.94, 1.04) : rand(0.97, 1.05);
    this.g.scale.setScalar(sc);
    if (kind !== 'civilian') setHeldWeapon(this.m, this.cfg.weapon || 'rev');
    scene.add(this.g); humans.push(this);
    this.syncModel();
  }
  syncModel() { this.g.position.set(this.x, this.y, this.z); this.g.rotation.y = this.yaw; }
  get eye() { return this.y + 1.55; }
  alertNearby() {
    for (const h of humans) if (h !== this && !h.dead && h.state === 'idle' && h.kind === this.kind && Math.hypot(h.x - this.x, h.z - this.z) < 45) { h.state = 'combat'; h.alertDelay = rand(0.2, 1.2); }
  }
  enterCombat() { if (this.state === 'combat') return; this.state = 'combat'; this.alertDelay = this.alertDelay || rand(0.1, 0.5); this.alertNearby(); }
  hurt(dmg, head) {
    if (this.dead) return;
    this.hp -= dmg;
    spawnPuff(new V3(this.x, this.y + (head ? 1.85 : 1.3), this.z), 0x8a1010, head ? 10 : 5, 1.2, 2, 8, 0.7);
    SFX.hit(true);
    if (this.hp <= 0) { this.die(head); return; }
    if (this.kind === 'civilian') { this.state = 'flee'; this.fleeT = 8; }
    else if (this.state === 'idle' || this.state === 'guard' || this.state === 'duel') { this.enterCombat(); }
    this.stagger = 0.25;
  }
  die(head) {
    this.dead = true; this.state = 'dead'; this.deadT = 0; this.hp = 0;
    setHeldWeapon(this.m, null);
    onKill(this, head);
  }
  moveToward(tx, tz, sp, dt, face = true) {
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    const s = Math.min(sp, d / dt);
    if (face) this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 10));
    tryMove(this, dx / d * s * dt, dz / d * s * dt, 0.4, 1.4);
    return s;
  }
  shoot() {
    const p = player, d = Math.hypot(p.x - this.x, p.z - this.z), c = this.cfg;
    if (!p.alive) return;
    const muzzle = new V3(this.x + Math.sin(this.yaw) * 0.6, this.y + 1.3, this.z + Math.cos(this.yaw) * 0.6);
    const tgt = new V3(p.x, p.y + 1.2, p.z);
    this.aimT = 0.4;
    this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
    let chance = c.acc - d / (c.accFall || 170);
    if (p.mounted && p.horse && p.horse.speed > 7) chance *= 0.6;
    if (p.deadEyeOn) chance *= 0.5;
    chance = clamp(chance, 0.04, 0.88);
    const pellets = c.pellets || 1;
    let hits = 0;
    for (let i = 0; i < pellets; i++) {
      const hit = Math.random() < chance;
      const t2 = tgt.clone();
      if (!hit) { t2.x += rand(-1.8, 1.8); t2.y += rand(-0.8, 1.0); t2.z += rand(-1.8, 1.8); }
      else hits++;
      if (i < 3) spawnTracer(muzzle, t2, c.long ? 0xff9a60 : 0xffd890, 0.08);
    }
    muzzleFlash(muzzle);
    SFX.shot(d, !!c.long);
    if (hits) damagePlayer(rand(c.dmg[0], c.dmg[1]) * (pellets > 1 ? Math.min(1, hits / 2.5) : 1), this.x, this.z);
    else spawnPuff(new V3(tgt.x, heightAt(tgt.x, tgt.z) + 0.2, tgt.z), 0xc9a66b, 3, 1, 1.5, 4);
    this.clip--;
    if (this.clip <= 0) { this.reloadT = rand(2, 3); this.clip = 6; }
    this.shootCd = rand(c.rate[0], c.rate[1]);
  }
  throwDynamite() {
    const p = player, T = 1.35;
    const from = new V3(this.x, this.y + 1.7, this.z);
    const tx = p.x + (p.vx || 0) * T * 0.7, tz = p.z + (p.vz || 0) * T * 0.7, ty = heightAt(tx, tz) + 0.3;
    const vel = new V3((tx - from.x) / T, ((ty - from.y) + 0.5 * 18 * T * T) / T, (tz - from.z) / T);
    spawnBomb(from, vel, 2.5, false);
    this.aimT = 0.6; toast('Dynamit!', 1200);
  }
  update(dt) {
    const p = player;
    if (this.dead) {
      this.deadT += dt;
      const f = Math.min(1, this.deadT / 0.55);
      this.g.rotation.x = -Math.PI / 2 * (f * f * (3 - 2 * f)) * 0.98;
      this.y = heightAt(this.x, this.z) + 0.18 * f; this.syncModel();
      return;
    }
    if (this.stagger > 0) this.stagger -= dt;
    const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz);
    let v = 0;
    const hostile = this.kind === 'outlaw' || this.kind === 'boss' || ((this.kind === 'lawman' || this.kind === 'sheriff') && game.wanted > 0);
    if (this.kind === 'lawman' || this.kind === 'sheriff') {
      if (game.wanted > 0 && p.alive && (d < 130 || this.spawned)) { if (this.state !== 'combat') this.state = 'combat'; }
      else if (this.state === 'combat') this.state = 'guard';
    }
    if (this.kind === 'civilian') v = this.updateCivilian(dt, d);
    else if (this.state === 'duel') { this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), 0.1); }
    else if (this.state === 'idle' || this.state === 'guard') {
      if (this.kind === 'outlaw' || this.kind === 'boss') {
        this.wanderT -= dt;
        if (this.wanderT <= 0) { const a = rand(0, 6.28), r = rand(0, 7); this.tx = this.home.x + Math.cos(a) * r; this.tz = this.home.z + Math.sin(a) * r; this.wanderT = rand(3, 9); if (Math.random() < 0.4) { this.tx = this.x; this.tz = this.z; } }
        v = this.moveToward(this.tx, this.tz, 1.3, dt);
      }
      this.scanT -= dt;
      if (this.scanT <= 0 && hostile) {
        this.scanT = 0.35;
        let range = 46; if (p.mounted && p.horse.speed > 8) range = 70; if (nightFactor > 0.6) range = 34; if (this.variant === 'rifle') range += 30;
        if (p.alive && d < range && losClear(this.x, this.eye, this.z, p.x, p.y + 1.5, p.z)) this.enterCombat();
      }
    } else if (this.state === 'combat') {
      const c = this.cfg;
      if (!p.alive || d > c.range * 2.2) { this.state = this.spawned ? 'combat' : (this.variant === 'duelist' ? 'duel' : 'idle'); return this.animate(dt, 0); }
      if (this.alertDelay > 0) { this.alertDelay -= dt; this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), 0.2); return this.animate(dt, 0); }
      this.strafeT -= dt; if (this.strafeT <= 0) { this.strafe = -this.strafe; this.strafeT = rand(1, 3); }
      const ux = dx / d, uz = dz / d, sp = c.speed;
      let mx = 0, mz = 0;
      if (!c.noMove) {
        if (d > c.far) { mx = ux; mz = uz; }
        else if (d < c.near) { mx = -ux * 0.8; mz = -uz * 0.8; }
        else { mx = -uz * this.strafe * 0.6; mz = ux * this.strafe * 0.6; }
        if (this.kind === 'boss') { mx *= 0.7; mz *= 0.7; }
      }
      const before = { x: this.x, z: this.z };
      tryMove(this, mx * sp * dt, mz * sp * dt, 0.4, 1.4);
      v = Math.hypot(this.x - before.x, this.z - before.z) / dt;
      this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 8));
      if (c.dynamite) {
        this.dynT -= dt;
        if (this.dynT <= 0 && d > 11 && d < 40 && losClear(this.x, this.eye, this.z, p.x, p.y + 1.4, p.z)) { this.throwDynamite(); this.dynT = rand(6, 9); }
      }
      if (this.reloadT > 0) this.reloadT -= dt;
      else {
        this.shootCd -= dt;
        if (this.shootCd <= 0) {
          if (d < c.range && losClear(this.x, this.eye, this.z, p.x, p.y + 1.4, p.z)) this.shoot();
          else this.shootCd = 0.3;
        }
      }
    }
    this.animate(dt, v);
  }
  updateCivilian(dt, d) {
    let v = 0;
    if (this.state === 'flee') {
      this.fleeT -= dt;
      const ax = this.x - (this.fx !== undefined ? this.fx : player.x), az = this.z - (this.fz !== undefined ? this.fz : player.z), l = Math.hypot(ax, az) || 1;
      const before = { x: this.x, z: this.z };
      this.yaw = lerpAngle(this.yaw, Math.atan2(ax, az), 0.15);
      tryMove(this, ax / l * 5.6 * dt, az / l * 5.6 * dt, 0.4, 1.4);
      v = Math.hypot(this.x - before.x, this.z - before.z) / dt;
      if (this.fleeT <= 0) { this.state = 'walk'; this.fx = undefined; }
    } else {
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.tx = clamp(this.home.x + rand(-25, 25), -60, 60); this.tz = clamp(this.home.z + rand(-3, 3), -8.5, 8.5);
        this.wanderT = rand(4, 12); if (Math.random() < 0.35) { this.tx = this.x; this.tz = this.z; }
      }
      v = this.moveToward(this.tx, this.tz, 1.6, dt);
      if (player.aiming && player.alive && d < 16 && !player.mounted) { this.state = 'flee'; this.fleeT = 5; }
    }
    return v;
  }
  animate(dt, v) {
    this.speedNow = lerp(this.speedNow, v, 0.2);
    this.y = heightAt(this.x, this.z);
    if (this.y < WATER_Y) this.y = Math.max(this.y, WATER_Y - 0.5);
    this.phase += this.speedNow * dt * 2.4;
    const amp = clamp(this.speedNow / 4.5, 0, 1) * 0.85, s = Math.sin(this.phase) * amp;
    this.m.legs[0].rotation.x = s; this.m.legs[1].rotation.x = -s;
    if (this.aimT > 0) { this.aimT -= dt; this.m.arms[1].rotation.x = -Math.PI / 2; this.m.arms[0].rotation.x = this.cfg.long ? -Math.PI / 2 : -s * 0.5; }
    else { this.m.arms[1].rotation.x = s * 0.7; this.m.arms[0].rotation.x = -s * 0.7; }
    if (this.state === 'flee') { this.m.arms[0].rotation.x = -2.4; this.m.arms[1].rotation.x = -2.4; }
    this.syncModel();
  }
}

// ---------- Tiere ----------
const ANIMAL = {
  deer: { hp: 40, opts: { bl: 1.25, bw: 0.42, bh: 0.55, ll: 0.75, lt: 0.09, nl: 0.55, hl: 0.4, color: 0x9a6a3a, dark: 0x3a2a1a, antlers: true, tl: 0.25, neckAngle: 0.5 }, drops: { meat: 1, pelt: 1 }, name: 'Hirsch' },
  cow: { hp: 120, opts: { bl: 1.7, bw: 0.7, bh: 0.75, ll: 0.6, lt: 0.14, nl: 0.4, hl: 0.5, color: 0xf0ece0, dark: 0x2a2a2a, patches: true, tl: 0.7, neckAngle: 0.25 }, drops: { meat: 2 }, name: 'Kuh' },
  wolf: { hp: 45, opts: { bl: 1.15, bw: 0.32, bh: 0.44, ll: 0.5, lt: 0.075, nl: 0.3, hl: 0.4, color: 0x6a6a68, dark: 0x2a2a2a, tl: 0.55, neckAngle: 0.3, tailDark: true }, drops: { pelt: 1 }, name: 'Wolf', hostile: true },
};
class Animal {
  constructor(type, x, z) {
    this.type = type; this.cfg = ANIMAL[type]; this.q = makeQuad(this.cfg.opts); this.g = this.q.g;
    this.x = x; this.z = z; this.y = heightAt(x, z); this.yaw = rand(0, 6.28); this.hp = this.cfg.hp; this.dead = false; this.skinned = false;
    this.home = { x, z }; this.state = 'wander'; this.tx = x; this.tz = z; this.wanderT = rand(0, 5); this.phase = 0; this.fleeT = 0; this.grounded = true; this.deadT = 0; this.speed = 0; this.biteT = 0; this.angry = false;
    scene.add(this.g); animals.push(this);
  }
  scare(fx, fz) { if (this.type === 'deer' && !this.dead) { this.state = 'flee'; this.fleeT = 6; this.fx = fx; this.fz = fz; } }
  hurt(dmg) {
    if (this.dead) return;
    this.hp -= dmg; spawnPuff(new V3(this.x, this.y + 1, this.z), 0x8a1010, 4, 1, 2, 8, 0.6); SFX.hit(true);
    if (this.hp <= 0) { this.dead = true; this.deadT = 0; if (this.type === 'cow') addHonor(-3); }
    else if (this.type === 'wolf') this.angry = true; else this.scare(player.x, player.z);
  }
  update(dt) {
    if (this.dead) { this.deadT += dt; const f = Math.min(1, this.deadT / 0.5); this.g.rotation.z = Math.PI / 2 * f; this.g.position.set(this.x, this.y + 0.35 * f, this.z); return; }
    const d = Math.hypot(player.x - this.x, player.z - this.z);
    if (this.type === 'deer' && this.state === 'wander' && d < 24 && (player.mounted ? player.horse.speed > 1 : Math.hypot(player.vx || 0, player.vz || 0) > 2)) this.scare(player.x, player.z);
    let v = 0;
    if (this.type === 'wolf') {
      const aggro = 28 + nightFactor * 35;
      if (player.alive && (d < aggro || (this.angry && d < 110))) {
        if (!this.angry) { this.angry = true; for (const a of animals) if (a.type === 'wolf' && !a.dead && Math.hypot(a.x - this.x, a.z - this.z) < 30) a.angry = true; }
        this.yaw = lerpAngle(this.yaw, Math.atan2(player.x - this.x, player.z - this.z), 1 - Math.exp(-dt * 8));
        if (d > 1.7) { const b = { x: this.x, z: this.z }; tryMove(this, Math.sin(this.yaw) * 8.8 * dt, Math.cos(this.yaw) * 8.8 * dt, 0.5, 1.6); v = Math.hypot(this.x - b.x, this.z - b.z) / dt; }
        else { this.biteT -= dt; if (this.biteT <= 0) { damagePlayer(rand(6, 10), this.x, this.z); this.biteT = 0.9; } }
      } else {
        this.angry = false;
        this.wanderT -= dt;
        if (this.wanderT <= 0) { const a = rand(0, 6.28), r = rand(2, 22); this.tx = this.home.x + Math.cos(a) * r; this.tz = this.home.z + Math.sin(a) * r; this.wanderT = rand(4, 9); }
        const dx = this.tx - this.x, dz = this.tz - this.z, dd = Math.hypot(dx, dz);
        if (dd > 0.5) { this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), 0.08); const b = { x: this.x, z: this.z }; tryMove(this, Math.sin(this.yaw) * 1.6 * dt, Math.cos(this.yaw) * 1.6 * dt, 0.5, 1.5); v = Math.hypot(this.x - b.x, this.z - b.z) / dt; }
      }
    } else if (this.state === 'flee') {
      this.fleeT -= dt;
      const ax = this.x - this.fx, az = this.z - this.fz;
      this.yaw = lerpAngle(this.yaw, Math.atan2(ax, az), 0.12);
      const b = { x: this.x, z: this.z };
      tryMove(this, Math.sin(this.yaw) * 11 * dt, Math.cos(this.yaw) * 11 * dt, 0.6, 1.5);
      v = Math.hypot(this.x - b.x, this.z - b.z) / dt;
      if (this.fleeT <= 0) this.state = 'wander';
    } else {
      this.wanderT -= dt;
      if (this.wanderT <= 0) { const a = rand(0, 6.28), r = rand(2, this.type === 'cow' ? 14 : 30); this.tx = this.home.x + Math.cos(a) * r; this.tz = this.home.z + Math.sin(a) * r; this.wanderT = rand(4, 10); if (Math.random() < 0.5) { this.tx = this.x; this.tz = this.z; } }
      const dx = this.tx - this.x, dz = this.tz - this.z, dd = Math.hypot(dx, dz);
      if (dd > 0.5) { this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), 0.08); const b = { x: this.x, z: this.z }; tryMove(this, Math.sin(this.yaw) * 1.3 * dt, Math.cos(this.yaw) * 1.3 * dt, 0.6, 1.5); v = Math.hypot(this.x - b.x, this.z - b.z) / dt; }
    }
    this.y = heightAt(this.x, this.z);
    this.phase += v * dt * 2.2;
    animateQuad(this.q, this.phase, v > 0.1 ? clamp(v / 6, 0.2, 0.9) : 0);
    this.g.position.set(this.x, this.y, this.z); this.g.rotation.y = this.yaw;
  }
}

// ---------- Geier ----------
const vultures = [];
function makeVulture(cx, cz) {
  const g = new THREE.Group();
  const bodyM = lam(0x1a1a1a);
  addMesh(g, new THREE.BoxGeometry(0.3, 0.2, 0.7), bodyM, 0, 0, 0, false);
  const wings = [];
  for (const s of [-1, 1]) { const w = new THREE.Group(); g.add(w); addMesh(w, new THREE.BoxGeometry(1.4, 0.04, 0.5), bodyM, s * 0.7, 0, 0, false); wings.push(w); }
  scene.add(g);
  vultures.push({ g, wings, cx, cz, a: rand(0, 6.28), r: rand(20, 40), h: rand(35, 55), s: rand(0.15, 0.25) });
}
function updateVultures(dt, t) {
  for (const v of vultures) {
    v.a += v.s * dt;
    const x = v.cx + Math.cos(v.a) * v.r, z = v.cz + Math.sin(v.a) * v.r;
    v.g.position.set(x, heightAt(v.cx, v.cz) + v.h + Math.sin(t + v.a * 3) * 2, z);
    v.g.rotation.y = -v.a; v.g.rotation.z = 0.25;
    v.wings[0].rotation.z = Math.sin(t * 2 + v.a) * 0.25; v.wings[1].rotation.z = -Math.sin(t * 2 + v.a) * 0.25;
  }
}

// ---------- Sprengstoff: Fässer, Dynamit, Explosionen ----------
const explosives = [], bombs = [], pendingBooms = [];
function makeExplosiveBarrel(x, z) {
  const y = heightAt(x, z), g = new THREE.Group(); g.position.set(x, y, z);
  addMesh(g, new THREE.CylinderGeometry(0.42, 0.38, 0.95, 10), lam(0xb02a18), 0, 0.48, 0);
  for (const by of [0.2, 0.76]) addMesh(g, new THREE.CylinderGeometry(0.435, 0.435, 0.06, 10), lam(0x2a2a2a), 0, by, 0, false);
  addMesh(g, new THREE.BoxGeometry(0.3, 0.3, 0.02), lam(0xf0d040), 0, 0.5, 0.41, false);
  scene.add(g);
  const c = addCircle(x, z, 0.5);
  explosives.push({ x, y, z, g, c, dead: false });
}
function spawnBomb(from, vel, fuse, fromPlayer, harmless) {
  const g = new THREE.Group();
  addMesh(g, new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), lam(0xc02818), 0, 0, 0, false).rotation.z = Math.PI / 2;
  const spark = addMesh(g, new THREE.SphereGeometry(0.05, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffa030 }), 0.17, 0.04, 0, false);
  g.position.copy(from); scene.add(g);
  bombs.push({ g, spark, v: vel.clone(), t: fuse, fromPlayer, harmless, sparkT: 0 });
}
function queueExplosion(x, y, z, r, dmg, fromPlayer, delay) { pendingBooms.push({ x, y, z, r, dmg, fromPlayer, t: delay }); }
function explode(x, y, z, r, dmg, fromPlayer, harmless) {
  const pos = new V3(x, y, z);
  explosionFX(pos, r);
  const dP = Math.hypot(player.x - x, player.y + 1 - y, player.z - z);
  SFX.explosion(dP);
  if (dP < 50) player.shake = Math.max(player.shake, 0.3 * (1 - dP / 50));
  for (const h of humans) {
    if (h.dead) continue;
    const d = Math.hypot(h.x - x, h.y + 1 - y, h.z - z);
    if (d < r) {
      const dm = dmg * (1 - d / r);
      if (fromPlayer && (h.kind === 'civilian' || h.kind === 'lawman' || h.kind === 'sheriff')) commitCrime(h.kind === 'civilian' ? 1 : 2);
      h.hurt(dm, false);
      if (!h.dead && h.state !== 'combat' && h.kind !== 'civilian') h.enterCombat();
    }
  }
  for (const a of animals) if (!a.dead && Math.hypot(a.x - x, a.z - z) < r) a.hurt(dmg * (1 - Math.hypot(a.x - x, a.z - z) / r));
  if (player.alive && dP < r && !harmless) damagePlayer(dmg * (1 - dP / r) * 0.75, x, z);
  for (const e of explosives) if (!e.dead && Math.hypot(e.x - x, e.z - z) < r * 0.9) { e.dead = true; queueExplosion(e.x, e.y + 0.5, e.z, 7, 120, fromPlayer, 0.18); scene.remove(e.g); e.c.x = 1e6; }
  for (const b of bombs) if (b.t > 0.2 && b.g.position.distanceTo(pos) < r * 0.8) b.t = 0.12;
  alarm(x, z, 130);
  if (fromPlayer) game.lastShot = performance.now();
}
function explodeBarrel(e, fromPlayer) {
  if (e.dead) return;
  e.dead = true; scene.remove(e.g); e.c.x = 1e6;
  explode(e.x, e.y + 0.5, e.z, 7, 120, fromPlayer);
}
function updateBombs(dt) {
  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i], p = b.g.position;
    b.t -= dt; b.sparkT += dt;
    const gh = heightAt(p.x, p.z) + 0.1;
    if (p.y > gh + 0.01 || b.v.y > 0) {
      b.v.y -= 18 * dt; p.addScaledVector(b.v, dt);
      if (p.y < gh) { p.y = gh; b.v.y = -b.v.y * 0.25; b.v.x *= 0.5; b.v.z *= 0.5; if (Math.abs(b.v.y) < 0.8) b.v.set(0, 0, 0); }
      b.g.rotation.x += dt * 8; b.g.rotation.z += dt * 5;
    }
    if (b.sparkT > 0.06) { b.sparkT = 0; spawnPuff(p, 0xffa030, 1, 0.3, 0.6, 0, 0.5, 0.25); }
    if (b.t <= 0) { scene.remove(b.g); bombs.splice(i, 1); explode(p.x, p.y, p.z, 9, 150, b.fromPlayer, b.harmless); }
  }
  for (let i = pendingBooms.length - 1; i >= 0; i--) {
    const e = pendingBooms[i]; e.t -= dt;
    if (e.t <= 0) { pendingBooms.splice(i, 1); explode(e.x, e.y, e.z, e.r, e.dmg, e.fromPlayer); }
  }
}

// ---------- Bevölkerung ----------
let playerHorse;
const CAMP_VARIANTS = [
  ['gun', 'gun', 'carbine', 'gun', 'shotgun'],
  ['gun', 'carbine', 'sawedoff', 'shotgun', 'rifle', 'dynamiter'],
  ['gun', 'carbine', 'sawedoff', 'shotgun', 'shotgun', 'rifle', 'rifle', 'dynamiter'],
];
const BOUNTY_TARGETS = [
  { name: 'Slim Hollis', reward: 120 }, { name: 'Mad Dog McCall', reward: 180 }, { name: 'Einäugiger Rufus', reward: 150 }, { name: 'Diego „El Gato“ Vargas', reward: 220 },
];
function populate() {
  CAMPS.forEach((c, i) => {
    for (let k = 0; k < c.count; k++) {
      const a = rand(0, 6.28), r = rand(5, c.fort ? 18 : 14);
      new Human('outlaw', c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, { camp: i, variant: CAMP_VARIANTS[i][k % CAMP_VARIANTS[i].length] });
    }
    for (let k = 0; k < 3; k++) makeVulture(c.x, c.z);
    for (let k = 0; k < 3; k++) { const a = rand(0, 6.28), r = rand(5, 9); makeExplosiveBarrel(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r); }
    if (c.fort) { const b = new Human('boss', c.x, c.z - 3, { camp: i, name: 'Black Jack Morgan', variant: 'shotgun' }); setHeldWeapon(b.m, 'pump'); b.home = { x: c.x, z: c.z - 3 }; b.cfg.near = 8; b.cfg.far = 24; }
  });
  // Hinterhalte an den Straßen, jeweils mit Kopfgeld-Anführer
  const amb = [[-80, -40], [160, -130], [-90, 190], [140, 110]];
  amb.forEach((a, i) => {
    const n = 2 + (i % 2);
    for (let k = 0; k < n; k++) new Human('outlaw', a[0] + rand(-12, 12), a[1] + rand(-12, 12), { camp: -1, variant: k === 1 ? 'shotgun' : 'gun' });
    const t = BOUNTY_TARGETS[i];
    const l = new Human('outlaw', a[0], a[1], { camp: -1, variant: 'rifle', bountyName: t.name, bountyReward: t.reward, hpMul: 1.5 });
    l.name = t.name;
  });
  // Stadt
  for (let i = 0; i < 12; i++) { const c = new Human('civilian', rand(-50, 50), rand(-5, 5)); c.home = { x: c.x, z: c.z }; }
  const sh = new Human('sheriff', -8.5, -9.4, { name: 'Sheriff Cole' }); sh.yaw = 0.3; game.sheriff = sh;
  new Human('lawman', -3, -9.4).yaw = 0.2;
  new Human('lawman', 5, 9.2).yaw = Math.PI;
  const du = new Human('outlaw', 38, 2, { camp: -2, variant: 'duelist', name: 'Revolverheld Jack Riley' });
  du.state = 'duel'; du.duelist = true; du.yaw = -Math.PI / 2; game.duelist = du;
  // Tiere
  scatter(16, (x, z, h) => h > 0 && !nearZone(x, z, 1.3) && Math.abs(x) < 700 && Math.abs(z) < 700).forEach((p) => new Animal('deer', p.x, p.z));
  for (let i = 0; i < 6; i++) new Animal('cow', HOME.x + rand(-18, 26), HOME.z + rand(-14, 20));
  for (let i = 0; i < 4; i++) {
    const s = scatter(1, (x, z, h) => h > 0 && Math.hypot(x, z) > 170 && !nearZone(x, z, 1.3) && Math.abs(x) < 700 && Math.abs(z) < 700)[0];
    if (s) for (let k = 0; k < 3; k++) new Animal('wolf', s.x + rand(-6, 6), s.z + rand(-6, 6));
  }
  playerHorse = new Horse(11, 4, HORSE_COLORS[0]);
}
function updateEntities(dt, t) {
  for (const h of humans) h.update(dt);
  for (const a of animals) a.update(dt);
  if (playerHorse) playerHorse.update(dt);
  updateVultures(dt, t);
  updateBombs(dt);
  for (let i = humans.length - 1; i >= 0; i--) {
    const h = humans[i];
    if (h.dead && h.deadT > 90 + (h.looted ? -60 : 0)) { scene.remove(h.g); humans.splice(i, 1); }
  }
}
// Schuss- / Lärm-Alarm
function alarm(x, z, r) {
  for (const h of humans) {
    if (h.dead) continue;
    const d = Math.hypot(h.x - x, h.z - z);
    if (h.kind === 'civilian' && d < r * 0.7) { h.state = 'flee'; h.fleeT = 7; h.fx = x; h.fz = z; }
    else if ((h.kind === 'outlaw' || h.kind === 'boss') && h.state === 'idle' && d < r) h.enterCombat();
  }
  for (const a of animals) if (a.type === 'deer' && Math.hypot(a.x - x, a.z - z) < r * 0.9) a.scare(x, z);
}

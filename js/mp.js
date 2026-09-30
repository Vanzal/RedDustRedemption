'use strict';
// Peer-to-peer Mehrspieler (WebRTC via PeerJS). Der Host (Raumbesitzer) ist Autorität: Er relayt Nachrichten
// zwischen Clients (Stern-Topologie), verwaltet die Spielerliste, Einstellungen (NPCs, PvP), Uhrzeit, Wetter und Kicks.
(() => {
  const PREFIX = 'dustred2-', PROTO = 2, MAX_PLAYERS = 8, SEND_HZ = 15, TIMEOUT = 15;
  const PEER_OPTS = {
    debug: 1,
    config: {
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
        { urls: 'stun:stun.cloudflare.com:3478' },
        // Öffentliches TURN-Relay als Rückfall für strikte NATs (Mobilfunk, Firmennetze)
        { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
      ],
    },
  };
  const COLORS = [0x9a3a2a, 0x2a5a8a, 0x3a7a3a, 0x7a4a9a, 0x9a7a2a, 0x2a7a7a];
  const remotes = new Map(); // id -> Modell + Zustand eines Mitspielers
  const roster = new Map(); // id -> { id, n, o } (vom Host gepflegt, inkl. Host selbst)
  const conns = new Map(); // nur Host: id -> DataConnection
  const lastSeen = new Map(); // id -> Zeitstempel (ms)
  const kicked = new Set(); // nur Host
  const settings = { pvp: true };
  let peer = null, isHost = false, hostConn = null, hostId = '', myId = null, room = '', myName = 'Cowboy', active = false, joinTimer = 0, retries = 0, sendTimer = 0, worldTimer = 0, left = false;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 14) || 'Cowboy';
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };

  const hud = document.createElement('div'); hud.id = 'mpHud'; document.body.appendChild(hud);
  const feed = document.createElement('div'); feed.id = 'killfeed'; document.body.appendChild(feed);
  const status = (s) => { const el = document.getElementById('mpStatus'); if (el) el.textContent = s; };
  function updateHud() {
    hud.style.display = active && game.started ? 'block' : 'none';
    const names = [...roster.values()].map((p) => `<div class="${p.id === myId ? 'me' : p.id === hostId ? 'host' : ''}">${esc(p.n)}${p.id === hostId ? ' ★' : ''}</div>`).join('');
    hud.innerHTML = `<div>RAUM <b>${esc(room)}</b> · ${roster.size} Spieler · O = Menü</div>${names}`;
    if (game.menu === 'room') renderMenu();
  }
  function feedLine(text) {
    const d = document.createElement('div'); d.textContent = text; feed.appendChild(d);
    setTimeout(() => { d.style.opacity = 0; }, 5000); setTimeout(() => d.remove(), 5700);
    while (feed.children.length > 5) feed.firstChild.remove();
  }

  function nameTag(text) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d'); g.font = '30px "Special Elite", Georgia, serif'; g.textAlign = 'center';
    g.lineWidth = 5; g.strokeStyle = '#000'; g.strokeText(text, 128, 42); g.fillStyle = '#f2e2b8'; g.fillText(text, 128, 42);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    s.scale.set(2, 0.5, 1); s.position.y = 2.6; s.renderOrder = 10; return s;
  }
  function buildModel(r) {
    if (r.model) scene.remove(r.model.g);
    const o = OUTFITS[r.outfit] ? OUTFITS[r.outfit].look : { shirt: COLORS[0] };
    r.model = makeHumanoid(o); r.model.g.add(nameTag(r.name)); scene.add(r.model.g);
    r.model.held = undefined;
  }
  function getRemote(id, m) {
    let r = remotes.get(id);
    if (r) return r;
    const ro = roster.get(id);
    r = { id, name: cleanName(ro ? ro.n : m.n), outfit: ro ? ro.o : (m.o | 0), model: null, horse: null, x: m.x, y: m.y, z: m.z, yaw: m.yaw, tx: m.x, ty: m.y, tz: m.z, tyaw: m.yaw, alive: true, aim: false, pitch: 0, weapon: 'rev', mounted: false, hs: 0, sp: 0, phase: 0, hphase: 0, deadT: 0 };
    buildModel(r);
    remotes.set(id, r);
    return r;
  }
  function dropRemote(id) {
    const r = remotes.get(id);
    if (r) { scene.remove(r.model.g); if (r.horse) scene.remove(r.horse.g); remotes.delete(id); }
  }
  function remoteHorse(r) {
    if (!r.horse) {
      const cc = HORSE_COLORS[(r.outfit || 0) % HORSE_COLORS.length];
      r.horse = makeQuad({ bl: 1.9, bw: 0.62, bh: 0.8, ll: 1.0, lt: 0.17, nl: 0.85, hl: 0.72, color: cc.c, dark: cc.d, mane: true, tailDark: true, tl: 0.9, saddle: true });
      scene.add(r.horse.g);
    }
    return r.horse;
  }

  // ---------- Versand ----------
  function sendTo(c, msg) { if (c && c.open) { try { c.send(msg); } catch (e) { /* Verbindung bricht gerade ab */ } } }
  function sendAll(msg, except) {
    if (isHost) { for (const [id, c] of conns) if (id !== except) sendTo(c, msg); }
    else sendTo(hostConn, msg);
  }
  function rosterList() { return [...roster.values()]; }
  function broadcastRoster() { sendAll({ t: 'ro', list: rosterList() }); updateHud(); }

  // ---------- Empfang ----------
  // Host: Nachrichten von Clients prüfen, Absender erzwingen, weiterleiten
  function hostReceive(m, from) {
    if (!m || typeof m !== 'object') return;
    lastSeen.set(from, performance.now());
    if (m.t === 'hi') {
      if (m.v !== PROTO) { kickConn(from, 'Andere Spielversion – bitte Seite neu laden'); return; }
      if (roster.size >= MAX_PLAYERS) { kickConn(from, 'Raum ist voll'); return; }
      roster.set(from, { id: from, n: cleanName(m.n), o: m.o | 0 });
      sendTo(conns.get(from), { t: 'wl', id: from, host: myId, room, set: settings, h: gameHours, r: rainTarget, list: rosterList() });
      broadcastRoster();
      toast(`${cleanName(m.n)} ist beigetreten`, 2500);
      return;
    }
    if (!roster.has(from)) return; // erst nach Begrüßung
    switch (m.t) {
      case 's': case 'sh': case 'bo': m.id = from; sendAll(m, from); handle(m); break;
      case 'h':
        if (!settings.pvp) return;
        m.by = from; m.byName = roster.get(from).n;
        if (m.to === myId) handle(m); else sendTo(conns.get(m.to), m);
        break;
      case 'k': m.vid = from; m.victim = roster.get(from).n; if (m.by && roster.has(m.by)) m.byName = roster.get(m.by).n; sendAll(m, from); handle(m); break;
      case 'l': dropClient(from); break;
    }
  }
  // Alle: Nachricht anwenden (Client bekommt alles über den Host)
  function handle(m) {
    switch (m.t) {
      case 's': {
        if (m.id === myId) return;
        const r = getRemote(m.id, m);
        if ((m.o | 0) !== r.outfit && OUTFITS[m.o | 0]) { r.outfit = m.o | 0; buildModel(r); }
        if (!remotes.get(m.id).seen) { r.x = m.x; r.y = m.y; r.z = m.z; r.yaw = m.yaw; r.seen = true; }
        r.tx = m.x; r.ty = m.y; r.tz = m.z; r.tyaw = m.yaw; r.pitch = m.p || 0; r.aim = !!m.aim; r.weapon = WEAPONS[m.w] ? m.w : 'rev'; r.mounted = !!m.m; r.hs = m.hs || 0; r.sp = m.sp || 0;
        if (r.alive && !m.a) r.deadT = 0;
        r.alive = !!m.a;
        break;
      }
      case 'sh': {
        if (m.id === myId || !Array.isArray(m.a) || !Array.isArray(m.b)) return;
        const a = new V3(...m.a), b = new V3(...m.b), w = WEAPONS[m.w] || WEAPONS.rev;
        spawnTracer(a, b, w.tracer || 0xfff0b0, w.silent ? 0.2 : 0.07);
        if (!w.silent) { muzzleFlash(a); SFX.shot(Math.hypot(a.x - player.x, a.z - player.z), !!w.heavy); }
        break;
      }
      case 'bo': {
        if (m.id === myId || !Array.isArray(m.f) || !Array.isArray(m.v)) return;
        spawnBomb(new V3(...m.f), new V3(...m.v), 2.6, false, !settings.pvp);
        break;
      }
      case 'h':
        if (m.to !== myId || !settings.pvp || !player.alive) return;
        damagePlayer(Math.max(0, Math.min(+m.d || 0, 1000)), 0, 0);
        if (!player.alive) { const k = { t: 'k', by: m.by, byName: m.byName, victim: myName, vid: myId }; sendAll(k); feedLine(`${m.byName} hat dich erschossen`); }
        break;
      case 'k':
        if (m.vid === myId) return;
        if (m.by === myId) { player.money += 10; feedLine(`Du hast ${m.victim} erschossen (+$10)`); }
        else feedLine(`${m.byName || 'Jemand'} hat ${m.victim} erschossen`);
        break;
      case 'l': dropRemote(m.id); break;
      // Nur vom Host:
      case 'wl':
        clearTimeout(joinTimer);
        myId = m.id; hostId = m.host; active = true;
        roster.clear(); for (const p of m.list || []) roster.set(p.id, p);
        applySettings(m.set, false); syncWorld(m.h, m.r, true);
        updateHud(); toast(`Raum ${room} beigetreten`, 3000); status(`Verbunden mit Raum ${room}`);
        break;
      case 'ro': {
        const before = new Set(roster.keys());
        roster.clear(); for (const p of m.list || []) roster.set(p.id, p);
        for (const p of roster.values()) if (!before.has(p.id) && p.id !== myId) toast(`${p.n} ist beigetreten`, 2500);
        for (const id of before) if (!roster.has(id)) { const r = remotes.get(id); if (r) toast(`${r.name} ist gegangen`, 2500); dropRemote(id); }
        for (const [id, r] of remotes) { const p = roster.get(id); if (p && p.n !== r.name) { r.name = p.n; buildModel(r); } }
        updateHud();
        break;
      }
      case 'cfg': applySettings(m.set, true); break;
      case 'w': syncWorld(m.h, m.r, false); break;
      case 'kick': leave(m.reason || 'Du wurdest vom Host aus dem Raum geworfen'); break;
    }
  }

  function applySettings(s, announce) {
    if (!s) return;
    const pvpChanged = !!s.pvp !== settings.pvp;
    settings.pvp = !!s.pvp;
    if (announce && pvpChanged) toast(settings.pvp ? 'PvP ist jetzt an' : 'PvP ist jetzt aus', 3000);
    if (game.menu === 'room') renderMenu();
  }
  function syncWorld(h, r, force) {
    if (typeof h === 'number' && isFinite(h)) { if (force || Math.abs(angDiff(gameHours / 24 * Math.PI * 2, h / 24 * Math.PI * 2)) > 0.01) gameHours = ((h % 24) + 24) % 24; }
    if (typeof r === 'number') { rainTarget = r; weatherT = 1e9; } // Wetter bestimmt der Host
  }

  // ---------- Verbindungen ----------
  function kickConn(id, reason) {
    const c = conns.get(id);
    sendTo(c, { t: 'kick', reason });
    setTimeout(() => { if (c) c.close(); dropClient(id); }, 400);
  }
  function dropClient(id) {
    const had = roster.get(id);
    conns.delete(id); lastSeen.delete(id);
    if (!had) return;
    roster.delete(id); dropRemote(id);
    sendAll({ t: 'l', id }); broadcastRoster();
    toast(`${had.n} hat den Raum verlassen`, 2500);
  }
  function attachHost(c) {
    c.on('data', (m) => hostReceive(m, c.peer));
    c.on('close', () => dropClient(c.peer));
    c.on('error', () => dropClient(c.peer));
  }
  function leave(reason) {
    if (left) return;
    left = true; active = false;
    clearTimeout(joinTimer);
    try { if (hostConn) hostConn.close(); } catch (e) { /* egal */ }
    try { if (peer) peer.destroy(); } catch (e) { /* egal */ }
    for (const id of [...remotes.keys()]) dropRemote(id);
    roster.clear(); conns.clear();
    settings.pvp = true; weatherT = 60;
    game.mode = 'solo'; setNpcsEnabled(true); // ohne Raum: zurück zum Einzelspieler-Inhalt
    updateHud();
    if (reason) { banner('RAUM VERLASSEN', reason, 6000); status(reason); }
  }

  function startHost() {
    isHost = true; room = Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
    status(`Eröffne Raum ${room}…`);
    peer = new Peer(PREFIX + room, PEER_OPTS);
    peer.on('open', (id) => {
      myId = hostId = id; active = true;
      roster.set(id, { id, n: myName, o: player.outfit | 0 });
      updateHud(); toast(`Raumcode: ${room} – Freunde geben ihn ein (O = Menü)`, 8000); status(`Raum ${room} offen`);
    });
    peer.on('connection', (c) => {
      c.on('open', () => {
        if (kicked.has(c.peer)) { sendTo(c, { t: 'kick', reason: 'Du wurdest aus diesem Raum geworfen' }); setTimeout(() => c.close(), 400); return; }
        conns.set(c.peer, c); lastSeen.set(c.peer, performance.now()); attachHost(c);
      });
    });
    peer.on('disconnected', () => { if (!left) setTimeout(() => { if (!left && peer.disconnected && !peer.destroyed) peer.reconnect(); }, 2000); });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && retries++ < 3) { peer.destroy(); startHost(); return; }
      if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') toast('Verbindung zum Vermittlungsserver gestört – versuche erneut…', 4000);
      else toast('Netzwerkfehler: ' + e.type, 4000);
    });
  }
  function startClient(code) {
    room = code.trim().toUpperCase();
    status(`Verbinde mit Raum ${room}…`); toast(`Verbinde mit Raum ${room}…`, 20000);
    peer = new Peer(PEER_OPTS);
    const fail = (why) => { if (!active) leave(why); };
    joinTimer = setTimeout(() => fail(`Keine Verbindung zu Raum ${room}. Firewall/NAT blockiert oder Raum geschlossen. Du spielst alleine.`), 25000);
    peer.on('open', (id) => {
      myId = id;
      hostConn = peer.connect(PREFIX + room, { reliable: true, serialization: 'json' });
      hostConn.on('open', () => { lastSeen.set('host', performance.now()); sendTo(hostConn, { t: 'hi', v: PROTO, n: myName, o: player.outfit | 0 }); });
      hostConn.on('data', (m) => { lastSeen.set('host', performance.now()); if (m && typeof m === 'object') handle(m); });
      hostConn.on('close', () => { if (!left) leave('Der Host hat den Raum geschlossen'); });
      hostConn.on('error', () => fail(`Verbindung zu Raum ${room} fehlgeschlagen`));
    });
    peer.on('disconnected', () => { if (!left && !active) setTimeout(() => { if (!left && peer.disconnected && !peer.destroyed) peer.reconnect(); }, 2000); });
    peer.on('error', (e) => fail(e.type === 'peer-unavailable' ? `Raum ${room} nicht gefunden – du spielst alleine` : `Netzwerkfehler (${e.type}) – du spielst alleine`));
  }
  function start(name, code, solo) {
    myName = cleanName(name); store('dr-name', myName);
    if (solo) { status('Solo-Modus'); return; }
    if (typeof Peer === 'undefined') { status('Mehrspieler nicht verfügbar (PeerJS blockiert). Solo-Modus.'); toast('Mehrspieler nicht verfügbar – Solo-Modus', 4000); return; }
    if (code && code.trim()) startClient(code); else startHost();
  }

  // ---------- Takt: Zustand senden, Timeouts prüfen (läuft auch bei verstecktem Tab) ----------
  setInterval(() => {
    if (!active) return;
    const p = player, now = performance.now();
    sendAll({ t: 's', id: myId, o: p.outfit | 0, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(3), p: +p.camPitch.toFixed(3), a: p.alive, aim: p.aiming || p.faceT > 0 || p.deadEyeOn, w: p.weapon, m: p.mounted, hs: p.mounted && p.horse ? +p.horse.speed.toFixed(1) : 0, sp: p.mounted ? 0 : +Math.hypot(p.vx, p.vz).toFixed(1) });
    if (isHost) {
      if ((worldTimer += 1 / SEND_HZ) > 4) { worldTimer = 0; sendAll({ t: 'w', h: gameHours, r: rainTarget }); }
      for (const [id, t] of lastSeen) if (now - t > TIMEOUT * 1000) { const c = conns.get(id); if (c) c.close(); dropClient(id); }
    } else if (now - (lastSeen.get('host') || now) > TIMEOUT * 1000) leave('Verbindung zum Host verloren');
  }, 1000 / SEND_HZ);

  window.MP = {
    remotes,
    pvp() { return settings.pvp; },
    get active() { return active; },
    get isHost() { return isHost; },
    sendShot(a, b, w) { if (active) sendAll({ t: 'sh', id: myId, w, a: [a.x, a.y, a.z], b: [b.x, b.y, b.z] }); },
    sendBomb(f, v) { if (active) sendAll({ t: 'bo', id: myId, f: [f.x, f.y, f.z], v: [v.x, v.y, v.z] }); },
    sendHit(to, d) {
      if (!active || to === myId || !settings.pvp) return;
      const m = { t: 'h', to, d, by: myId, byName: myName };
      if (isHost) sendTo(conns.get(to), m); else sendAll(m);
    },
    kick(id) {
      if (!isHost || !active || id === myId || !roster.has(id)) return;
      const n = roster.get(id).n;
      kicked.add(id); kickConn(id, 'Du wurdest vom Host aus dem Raum geworfen');
      toast(`${n} wurde gekickt`, 2500);
    },
    setNpcs(on) {
      if (active) return; // Mehrspieler hat nie NPCs
      setNpcsEnabled(on); toast(on ? 'NPCs aktiviert' : 'Alle NPCs deaktiviert', 2000);
      if (game.menu === 'room') renderMenu();
    },
    setPvp(on) {
      if (!active || !isHost) return;
      applySettings({ pvp: on }, false);
      toast(on ? 'PvP an' : 'PvP aus', 2000);
      sendAll({ t: 'cfg', set: settings });
    },
    inviteLink() { return location.origin + location.pathname + '?room=' + room; },
    roomHTML() {
      const owner = !active || isHost;
      const onOff = (v) => (v ? 'An' : 'Aus');
      const toggle = (act, v, label, desc, enabled) => `<div class="row"><div class="rn"><b>${label}</b><small>${desc}</small></div><span class="cnt">${onOff(v)}</span>${enabled ? `<button data-act="${act}" data-id="${v ? 1 : 0}">${v ? 'Ausschalten' : 'Einschalten'}</button>` : ''}</div>`;
      const players = active ? rosterList().map((p) => `<div class="row"><div class="rn"><b>${esc(p.n)}${p.id === hostId ? '<span class="tag">Host</span>' : ''}${p.id === myId ? '<span class="tag">Du</span>' : ''}</b><small>${esc((OUTFITS[p.o] || OUTFITS[0]).name)}</small></div>${isHost && p.id !== myId ? `<button class="danger" data-act="kick" data-id="${esc(p.id)}">Kicken</button>` : ''}</div>`).join('') : '<p class="intro">Du spielst alleine. Starte neu und lass den Raumcode leer, um einen Raum zu eröffnen.</p>';
      const invite = active ? `<div class="row"><div class="rn"><b>Raumcode ${esc(room)}</b><small>${esc(MP.inviteLink())}</small></div><button data-act="copy">Link kopieren</button></div>` : '';
      return `<div class="mh"><h2>${active ? 'RAUM ' + esc(room) : 'SPIEL'}</h2><div class="mmoney">${active ? roster.size + ' / ' + MAX_PLAYERS : ''}</div></div>
        ${owner ? '' : '<p class="intro">Nur der Host kann Spieler kicken und Einstellungen ändern.</p>'}
        <div class="cols"><div class="col"><h3>Spieler</h3>${players}${invite}</div>
        <div class="col"><h3>${owner ? 'Admin' : 'Einstellungen'}</h3>
          ${active ? toggle('pvp', settings.pvp, 'PvP', 'Spieler können sich gegenseitig verletzen', isHost) + '<p class="intro">Im Mehrspieler gibt es keine NPCs.</p>' : toggle('npcs', !game.npcsOff, 'NPCs', 'Banditen, Bürger, Gesetzeshüter und Tiere', true)}
        </div></div><div class="mf">O / Esc = schließen</div>`;
    },
    tick(dt) {
      const k = 1 - Math.exp(-dt * 14);
      for (const r of remotes.values()) {
        r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k; r.yaw = lerpAngle(r.yaw, r.tyaw, k);
        const m = r.model, g = m.g;
        g.position.set(r.x, r.y, r.z); g.rotation.y = r.yaw;
        const rw = WEAPONS[r.weapon] || WEAPONS.rev;
        setHeldWeapon(m, r.alive ? r.weapon : null);
        if (r.mounted && r.alive) {
          const h = remoteHorse(r); h.g.visible = true;
          h.g.position.set(r.x + Math.sin(r.yaw) * 0.1, r.y - 0.86, r.z + Math.cos(r.yaw) * 0.1); h.g.rotation.y = r.yaw;
          r.hphase += r.hs * dt * (r.hs > 11 ? 1.05 : 1.6);
          animateQuad(h, r.hphase * (r.hs > 11 ? 1.2 : 1) * 1.3, r.hs > 0.3 ? clamp(r.hs / 9, 0.25, 1) : 0);
        } else if (r.horse) r.horse.g.visible = false;
        if (!r.alive) { r.deadT += dt; const f = Math.min(1, r.deadT / 0.6); g.rotation.x = -Math.PI / 2 * f * 0.98; g.position.y = r.y + 0.18 * f; continue; }
        g.rotation.x = 0;
        r.phase += r.sp * dt * 2.3;
        const amp = clamp(r.sp / 5, 0, 1) * 0.9, s = Math.sin(r.phase) * amp;
        if (r.mounted) { m.legs[0].rotation.x = m.legs[1].rotation.x = -0.35; m.legs[0].rotation.z = -0.35; m.legs[1].rotation.z = 0.35; }
        else { m.legs[0].rotation.x = s; m.legs[1].rotation.x = -s; m.legs[0].rotation.z = m.legs[1].rotation.z = 0; }
        if (r.aim) { m.arms[1].rotation.x = -Math.PI / 2 - (r.pitch - 0.05); m.arms[0].rotation.x = rw.type === 'long' ? m.arms[1].rotation.x : -s * 0.5; }
        else { m.arms[1].rotation.x = r.mounted ? -0.7 : s * 0.7; m.arms[0].rotation.x = r.mounted ? -0.7 : -s * 0.7; }
      }
    },
  };

  addEventListener('beforeunload', () => { if (!active) return; if (isHost) for (const c of conns.values()) sendTo(c, { t: 'kick', reason: 'Der Host hat den Raum geschlossen' }); else sendAll({ t: 'l', id: myId }); });
  const $el = (id) => document.getElementById(id);
  $el('btnPlay').addEventListener('click', () => { if (!peer && !left) start($el('mpName').value, $el('mpRoom').value, game.mode === 'solo'); setTimeout(updateHud, 0); });
  for (const id of ['mpName', 'mpRoom']) $el(id).addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') $el('btnPlay').click(); });
  const saved = store('dr-name'); if (saved) $el('mpName').value = saved;
  // Raumcode per Link: ?room=ABCD
  const q = new URLSearchParams(location.search).get('room'); if (q) $el('mpRoom').value = q.slice(0, 8);
})();

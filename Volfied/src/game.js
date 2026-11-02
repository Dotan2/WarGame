'use strict';
(() => {
  const C = window.VOLFIED_CONFIG;
  const W = C.gridW, H = C.gridH, CELL = C.cell;
  const PW = W * CELL, PH = H * CELL;
  const UNC = 0, CLM = 1, TRL = 2; // unclaimed, claimed, trail being cut
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const DIR_ORDER = ['up', 'down', 'left', 'right'];
  const DEBUG = new URLSearchParams(location.search).has('debug');

  const canvas = document.getElementById('game');
  canvas.width = PW; canvas.height = PH;
  const ctx = canvas.getContext('2d');

  // ---------- grid ----------
  const grid = new Uint8Array(W * H);
  const edge = new Uint8Array(W * H); // claimed cell touching unclaimed: the "shield line" the ship rides on
  const trailIndex = new Int32Array(W * H).fill(-1);
  const visited = new Uint8Array(W * H);
  const seen = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);

  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const maskCv = mk(W, H), maskCtx = maskCv.getContext('2d'), maskImg = maskCtx.createImageData(W, H);
  const edgeCv = mk(W, H), edgeCtx = edgeCv.getContext('2d'), edgeImg = edgeCtx.createImageData(W, H);
  const revealCv = mk(PW, PH), revealCtx = revealCv.getContext('2d');
  let artCv = null, bgCv = null;

  // ---------- state ----------
  const S = {
    mode: 'title', modeT: 0, level: 0, score: 0, lives: C.lives, hi: loadHi(),
    player: null, enemies: [], bullets: [], shots: [], boxes: [], particles: [], toasts: [],
    spark: null, timers: { S: 0, T: 0, P: 0, L: 0 }, shield: C.shieldMax,
    claimedCells: 0, totalCells: (W - 2) * (H - 2), percent: 0, target: C.defaultTarget,
    fireCd: 0, clearInfo: null, levelCfg: null,
  };
  window.__volfied = S; // for debugging from the console

  // ---------- input ----------
  const held = new Set();
  const pressed = new Set();
  const dirStack = [];
  const KEY_DIR = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
  addEventListener('keydown', e => {
    if (BLOCK.has(e.code)) e.preventDefault();
    if (!held.has(e.code)) pressed.add(e.code);
    held.add(e.code);
    const d = KEY_DIR[e.code];
    if (d) { const i = dirStack.indexOf(d); if (i >= 0) dirStack.splice(i, 1); dirStack.push(d); }
  });
  addEventListener('keyup', e => {
    held.delete(e.code);
    const d = KEY_DIR[e.code];
    if (d && !Object.entries(KEY_DIR).some(([k, v]) => v === d && held.has(k))) {
      const i = dirStack.indexOf(d); if (i >= 0) dirStack.splice(i, 1);
    }
  });
  addEventListener('blur', () => { held.clear(); dirStack.length = 0; if (S.mode === 'play') S.mode = 'paused'; });
  const currentDir = () => dirStack[dirStack.length - 1] || null;
  const isCut = () => held.has('Space');
  const isFire = () => held.has('KeyX') || held.has('KeyZ');

  // ---------- audio ----------
  let actx = null, muted = false;
  function beep(freq, dur, type = 'square', vol = 0.05, slide = 0) {
    if (muted) return;
    try {
      actx = actx || new AudioContext();
      const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
    } catch (_) { /* audio unavailable */ }
  }

  // ---------- helpers ----------
  const idx = (x, y) => y * W + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const rand = (a, b) => a + Math.random() * (b - a);
  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function loadHi() { try { return +localStorage.getItem('volfied.hi') || 0; } catch (_) { return 0; } }
  function saveHi() { try { localStorage.setItem('volfied.hi', String(S.hi)); } catch (_) { /* storage blocked */ } }
  function toast(text, x, y, color = '#fff') { S.toasts.push({ text, x, y, color, t: 0 }); }
  function burst(x, y, color, n = 20, sp = 120) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = rand(sp * 0.3, sp);
      S.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.4, 0.9), t: 0, color });
    }
  }

  // ---------- art (placeholder theme: procedural) ----------
  function makeArt(n) {
    const cv = mk(PW, PH), g = cv.getContext('2d'), r = rng(n * 7919 + 13);
    const h = (n * 47 + 200) % 360;
    const lg = g.createLinearGradient(0, 0, PW, PH);
    lg.addColorStop(0, `hsl(${h},70%,45%)`); lg.addColorStop(1, `hsl(${h + 60},70%,22%)`);
    g.fillStyle = lg; g.fillRect(0, 0, PW, PH);
    for (let i = 0; i < 45; i++) {
      g.fillStyle = `hsla(${h + r() * 140},80%,${50 + r() * 25}%,${0.12 + r() * 0.3})`;
      g.beginPath(); g.arc(r() * PW, r() * PH, 15 + r() * 150, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2;
    for (let i = 0; i < 14; i++) { g.beginPath(); g.moveTo(r() * PW, r() * PH); g.bezierCurveTo(r() * PW, r() * PH, r() * PW, r() * PH, r() * PW, r() * PH); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.font = 'bold 130px Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('ROUND ' + (n + 1), PW / 2, PH / 2);
    return cv;
  }
  function makeBg(n) {
    const cv = mk(PW, PH), g = cv.getContext('2d'), r = rng(n * 31 + 7);
    g.fillStyle = '#05060d'; g.fillRect(0, 0, PW, PH);
    g.strokeStyle = 'rgba(80,120,255,0.07)'; g.lineWidth = 1;
    for (let x = 0; x < PW; x += 20) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, PH); g.stroke(); }
    for (let y = 0; y < PH; y += 20) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(PW, y + 0.5); g.stroke(); }
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(200,220,255,${0.2 + r() * 0.6})`; g.fillRect(r() * PW, r() * PH, r() < 0.9 ? 1 : 2, 1); }
    return cv;
  }

  // ---------- level setup ----------
  function levelConfig(n) {
    const L = C.levels[n % C.levels.length], mul = Math.pow(C.loopSpeedMul, Math.floor(n / C.levels.length));
    const cl = JSON.parse(JSON.stringify(L));
    cl.bosses.forEach(b => b.speed *= mul); cl.minions.forEach(m => m.speed *= mul);
    cl.target = L.target || C.defaultTarget;
    return cl;
  }

  function newGame() {
    S.score = 0; S.lives = C.lives; S.level = 0;
    startLevel(0);
  }

  function startLevel(n) {
    const L = S.levelCfg = levelConfig(n);
    S.level = n; S.target = L.target;
    grid.fill(UNC); trailIndex.fill(-1);
    for (let x = 0; x < W; x++) { grid[idx(x, 0)] = CLM; grid[idx(x, H - 1)] = CLM; }
    for (let y = 0; y < H; y++) { grid[idx(0, y)] = CLM; grid[idx(W - 1, y)] = CLM; }
    S.claimedCells = 0; S.percent = 0;
    artCv = makeArt(n); bgCv = makeBg(n);
    computeEdges(); rebuildLayers();

    S.player = { x: W >> 1, y: H - 1, drawing: false, trail: [], start: -1, acc: 0, lastDir: 'up', inv: C.respawnInvuln };
    S.enemies = []; S.bullets = []; S.shots = []; S.particles = []; S.toasts = []; S.spark = null;
    S.timers = { S: 0, T: 0, P: 0, L: 0 }; S.shield = C.shieldMax; S.fireCd = 0;

    const nb = L.bosses.length;
    L.bosses.forEach((b, i) => {
      const x = nb === 1 ? W / 2 : W * (i + 1) / (nb + 1), y = H * 0.42;
      S.enemies.push(makeEnemy(b.type, x, y, b, true));
    });
    for (const m of L.minions) for (let i = 0; i < m.n; i++) {
      let x, y;
      do { x = rand(10, W - 10); y = rand(10, H - 30); } while (S.enemies.some(e => Math.hypot(e.x - x, e.y - y) < e.r + 8));
      S.enemies.push(makeEnemy(m.type, x, y, m, false));
    }
    S.boxes = [];
    const keys = Object.keys(C.powerupWeights);
    const total = keys.reduce((a, k) => a + C.powerupWeights[k], 0);
    for (let i = 0; i < L.boxes; i++) {
      let x, y, tries = 0;
      do { x = Math.floor(rand(8, W - 8)); y = Math.floor(rand(8, H - 8)); tries++; }
      while (tries < 200 && (S.boxes.some(b => Math.hypot(b.x - x, b.y - y) < 18) || S.enemies.some(e => e.boss && Math.hypot(e.x - x, e.y - y) < e.r + 10)));
      let roll = Math.random() * total, kind = keys[0];
      for (const k of keys) { roll -= C.powerupWeights[k]; if (roll <= 0) { kind = k; break; } }
      S.boxes.push({ x, y, kind });
    }
    setMode('intro');
  }

  function makeEnemy(type, x, y, cfg, boss) {
    const a = (Math.floor(Math.random() * 4) * 90 + rand(25, 65)) * Math.PI / 180;
    return {
      type, boss, x, y, vx: Math.cos(a) * cfg.speed, vy: Math.sin(a) * cfg.speed, speed: cfg.speed,
      r: boss ? cfg.r : (type === 'chaser' ? 1.4 : 1.7), hp: cfg.hp || 1, maxHp: cfg.hp || 1, cfg,
      t: rand(0.5, 1.5), spawnT: cfg.spawnEvery || 0, fireT: cfg.fireEvery || 0, dashT: cfg.dashEvery || 0,
      dashing: 0, rot: 0, hist: [], histT: 0, flash: 0,
    };
  }

  function setMode(m) { S.mode = m; S.modeT = 0; }

  // ---------- area claiming ----------
  function computeEdges() {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (grid[i] !== CLM) { edge[i] = 0; continue; }
      let e = 0;
      for (let dy = -1; dy <= 1 && !e; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (inb(nx, ny) && grid[idx(nx, ny)] !== CLM) { e = 1; break; }
      }
      edge[i] = e;
    }
  }

  function rebuildLayers(full = false) {
    const md = maskImg.data, ed = edgeImg.data;
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      md[o + 3] = full || grid[i] === CLM ? 255 : 0;
      if (edge[i] && !full) { ed[o] = 120; ed[o + 1] = 230; ed[o + 2] = 255; ed[o + 3] = 255; } else ed[o + 3] = 0;
    }
    maskCtx.putImageData(maskImg, 0, 0); edgeCtx.putImageData(edgeImg, 0, 0);
    revealCtx.globalCompositeOperation = 'source-over';
    revealCtx.clearRect(0, 0, PW, PH);
    revealCtx.drawImage(artCv, 0, 0);
    revealCtx.globalCompositeOperation = 'destination-in';
    revealCtx.imageSmoothingEnabled = false;
    revealCtx.drawImage(maskCv, 0, 0, PW, PH);
    revealCtx.globalCompositeOperation = 'source-over';
  }

  function flood(start) {
    let qh = 0, qt = 0;
    queue[qt++] = start; visited[start] = 1;
    while (qh < qt) {
      const i = queue[qh++], x = i % W, y = (i / W) | 0;
      if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W);
    }
    function push(n) { if (!visited[n] && grid[n] === UNC) { visited[n] = 1; queue[qt++] = n; } }
  }

  // nearest cell satisfying pred, BFS over the whole grid
  function nearestCell(x, y, pred) {
    x = Math.max(0, Math.min(W - 1, x | 0)); y = Math.max(0, Math.min(H - 1, y | 0));
    seen.fill(0);
    let qh = 0, qt = 0; const s = idx(x, y);
    queue[qt++] = s; seen[s] = 1;
    while (qh < qt) {
      const i = queue[qh++];
      if (pred(i)) return i;
      const cx = i % W, cy = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!inb(nx, ny)) continue;
        const n = idx(nx, ny);
        if (!seen[n]) { seen[n] = 1; queue[qt++] = n; }
      }
    }
    return -1;
  }

  function closeTrail() {
    const p = S.player, t = p.trail;
    for (const i of t) { grid[i] = CLM; trailIndex[i] = -1; }
    let claimed = t.length;
    p.trail = []; p.drawing = false; S.spark = null;

    // The side(s) holding a boss stay open; everything else is claimed.
    visited.fill(0);
    const bosses = S.enemies.filter(e => e.boss);
    let regions = 0;
    for (const b of bosses) {
      const s = nearestCell(b.x, b.y, i => grid[i] === UNC);
      if (s < 0 || visited[s]) continue;
      regions++; flood(s);
    }
    const split = bosses.length > 1 && regions > 1;
    for (let i = 0; i < W * H; i++) if (grid[i] === UNC && !visited[i]) { grid[i] = CLM; claimed++; }

    S.claimedCells += claimed;
    S.percent = Math.min(100, S.claimedCells / S.totalCells * 100);
    const frac = claimed / S.totalCells;
    const pts = Math.round(claimed * C.pointsPerCell * (frac >= C.bigCutFraction ? 2 : 1));
    S.score += pts;
    computeEdges(); rebuildLayers();

    const px = (p.x + 0.5) * CELL, py = (p.y + 0.5) * CELL;
    toast(`+${(frac * 100).toFixed(1)}%  ${pts}${frac >= C.bigCutFraction ? ' x2' : ''}`, px, py - 12, '#9ff');
    beep(520, 0.08, 'square', 0.05, 400); setTimeout(() => beep(880, 0.1, 'triangle', 0.04), 70);

    // small enemies caught inside the claimed area die
    S.enemies = S.enemies.filter(e => {
      if (e.boss || grid[idx(e.x | 0, e.y | 0)] !== CLM) return true;
      S.score += C.minionKill; burst(e.x * CELL, e.y * CELL, '#ffb347', 18); toast('+' + C.minionKill, e.x * CELL, e.y * CELL, '#ffb347');
      return false;
    });
    S.bullets = S.bullets.filter(b => grid[idx(b.x | 0, b.y | 0)] !== CLM);
    S.boxes = S.boxes.filter(b => { if (grid[idx(b.x, b.y)] !== CLM) return true; applyPower(b); return false; });

    const pi = idx(p.x, p.y);
    if (!edge[pi]) { const n = nearestCell(p.x, p.y, i => edge[i] === 1); if (n >= 0) { p.x = n % W; p.y = (n / W) | 0; } }

    if (S.mode !== 'play') return; // a power-up may already have ended the round
    if (split) winRound('split');
    else if (S.percent >= S.target) winRound('area');
  }

  function applyPower(b) {
    const k = b.kind, px = b.x * CELL, py = b.y * CELL;
    const names = { S: 'SPEED', T: 'TIME STOP', P: 'SHIELD PAUSE', L: 'LASER', C: 'CLEAR', B: 'BOSS HIT', '1UP': '1 UP' };
    toast(names[k], px, py, '#ffd24f'); burst(px, py, '#ffd24f', 14, 80);
    beep(660, 0.08, 'triangle', 0.05); setTimeout(() => beep(990, 0.12, 'triangle', 0.05), 80);
    if (C.powerupDurations[k]) S.timers[k] = C.powerupDurations[k];
    if (k === 'P') S.shield = Math.min(C.shieldMax, S.shield + 20);
    if (k === 'C') S.enemies = S.enemies.filter(e => { if (e.boss) return true; S.score += C.minionKill; burst(e.x * CELL, e.y * CELL, '#ffb347'); return false; });
    if (k === '1UP') S.lives++;
    if (k === 'B') { const boss = S.enemies.find(e => e.boss); if (boss) damageBoss(boss, Math.ceil(boss.maxHp * 0.4)); }
  }

  function damageBoss(b, dmg) {
    b.hp -= dmg; b.flash = 0.12; beep(200, 0.05, 'sawtooth', 0.04);
    if (b.hp > 0) return;
    S.enemies = S.enemies.filter(e => e !== b);
    burst(b.x * CELL, b.y * CELL, '#ff6', 70, 260); beep(120, 0.6, 'sawtooth', 0.08, -80);
    if (!S.enemies.some(e => e.boss)) winRound('boss');
  }

  function winRound(how) {
    const over = Math.max(0, Math.floor(S.percent) - S.target);
    const info = { how, percent: S.percent, areaBonus: over * C.percentBonus, special: 0 };
    if (how === 'boss') info.special = C.bossKillBonus;
    if (how === 'split') info.special = C.splitBonus;
    S.score += info.areaBonus + info.special;
    S.clearInfo = info;
    if (S.score > S.hi) { S.hi = S.score; saveHi(); }
    rebuildLayers(true);
    setMode('clear');
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.15, 'triangle', 0.05), i * 120));
  }

  // ---------- player ----------
  function pushTrail(i) { const p = S.player; trailIndex[i] = p.trail.length; p.trail.push(i); grid[i] = TRL; }

  function stepPlayer() {
    const p = S.player;
    if (p.drawing && !isCut()) { // released the cut button: rewind along the line
      const last = p.trail.pop(); grid[last] = UNC; trailIndex[last] = -1;
      const ni = p.trail.length ? p.trail[p.trail.length - 1] : p.start;
      p.x = ni % W; p.y = (ni / W) | 0;
      if (!p.trail.length) { p.drawing = false; S.spark = null; }
      return true;
    }
    const d = currentDir();
    if (!d) return false;
    const nx = p.x + DIRS[d][0], ny = p.y + DIRS[d][1];
    if (!inb(nx, ny)) return false;
    const ni = idx(nx, ny), c = grid[ni];
    if (!p.drawing) {
      if (c === CLM) { if (!edge[ni]) return false; p.x = nx; p.y = ny; p.lastDir = d; return true; }
      if (c === UNC && isCut()) { p.drawing = true; p.start = idx(p.x, p.y); pushTrail(ni); p.x = nx; p.y = ny; p.lastDir = d; return true; }
      return false;
    }
    if (c === TRL) return false; // the line can't cross itself
    p.lastDir = d; p.x = nx; p.y = ny;
    if (c === UNC) { pushTrail(ni); return true; }
    closeTrail(); // reached the border again
    return true;
  }

  function updatePlayer(dt) {
    const p = S.player;
    if (p.inv > 0) p.inv -= dt;
    const retracting = p.drawing && !isCut();
    const spd = retracting ? C.retractSpeed : (S.timers.S > 0 ? C.playerSpeedBoost : C.playerSpeed);
    p.acc += spd * dt;
    while (p.acc >= 1) {
      p.acc -= 1;
      if (!stepPlayer()) { p.acc = 0; break; }
      if (S.mode !== 'play') return;
    }
    // laser
    S.fireCd -= dt;
    if (S.timers.L > 0 && isFire() && S.fireCd <= 0) fireLaser();
  }

  function fireLaser() {
    const p = S.player;
    let d = currentDir() || p.lastDir;
    const opens = dd => { const x = p.x + DIRS[dd][0], y = p.y + DIRS[dd][1]; return inb(x, y) && grid[idx(x, y)] !== CLM; };
    if (!opens(d)) d = [p.lastDir, ...DIR_ORDER].find(opens);
    if (!d) return;
    S.fireCd = C.laserCooldown;
    S.shots.push({ x: p.x + 0.5, y: p.y + 0.5, vx: DIRS[d][0] * C.laserSpeed, vy: DIRS[d][1] * C.laserSpeed });
    beep(1400, 0.04, 'square', 0.025, -600);
  }

  function killPlayer() {
    const p = S.player;
    burst((p.x + 0.5) * CELL, (p.y + 0.5) * CELL, '#fff', 40, 200);
    beep(300, 0.5, 'sawtooth', 0.08, -250);
    S.lives--;
    setMode('dying');
  }

  function respawn() {
    const p = S.player;
    if (p.drawing) {
      for (const i of p.trail) { grid[i] = UNC; trailIndex[i] = -1; }
      p.trail = []; p.drawing = false; p.x = p.start % W; p.y = (p.start / W) | 0;
    }
    p.inv = C.respawnInvuln; p.acc = 0;
    S.spark = null; S.bullets = []; S.shield = C.shieldMax;
    setMode('play');
  }

  // ---------- enemies ----------
  function blockedAt(x, y, r) {
    const n = Math.max(8, Math.ceil(Math.PI * 2 * r / 1.2));
    if (cellSolid(x, y)) return true;
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2;
      if (cellSolid(x + Math.cos(a) * r, y + Math.sin(a) * r)) return true;
    }
    return false;
  }
  function cellSolid(x, y) { const cx = Math.floor(x), cy = Math.floor(y); return !inb(cx, cy) || grid[idx(cx, cy)] === CLM; }

  function moveEntity(e, dt) {
    const stuck = blockedAt(e.x, e.y, e.r); // region shrank around it: only keep the center out of claimed cells
    const test = (x, y) => stuck ? cellSolid(x, y) : blockedAt(x, y, e.r);
    const nx = e.x + e.vx * dt;
    if (test(nx, e.y)) e.vx = -e.vx; else e.x = nx;
    const ny = e.y + e.vy * dt;
    if (test(e.x, ny)) e.vy = -e.vy; else e.y = ny;
  }

  function setSpeed(e, s) { const m = Math.hypot(e.vx, e.vy) || 1; e.vx = e.vx / m * s; e.vy = e.vy / m * s; }
  function rotate(e, a) { const c = Math.cos(a), s = Math.sin(a); [e.vx, e.vy] = [e.vx * c - e.vy * s, e.vx * s + e.vy * c]; }

  function updateEnemy(e, dt) {
    const p = S.player, px = p.x + 0.5, py = p.y + 0.5;
    const cfg = e.cfg;
    e.rot += dt * (e.boss ? 1.2 : 4);
    switch (e.type) {
      case 'wander':
        e.t -= dt; if (e.t <= 0) { rotate(e, rand(-1, 1)); e.t = rand(0.6, 1.6); }
        break;
      case 'chaser': {
        const dx = px - e.x, dy = py - e.y, m = Math.hypot(dx, dy) || 1;
        e.vx += (dx / m * e.speed - e.vx) * 1.5 * dt; e.vy += (dy / m * e.speed - e.vy) * 1.5 * dt;
        setSpeed(e, e.speed);
        break;
      }
      case 'bouncer':
        if (e.boss) { e.t -= dt; if (e.t <= 0) { rotate(e, rand(-0.6, 0.6)); e.t = rand(2, 4); } }
        break;
      case 'hunter':
        if (e.dashing > 0) {
          e.dashing -= dt; if (e.dashing <= 0) setSpeed(e, e.speed);
        } else {
          e.dashT -= dt;
          if (e.dashT <= 0) {
            e.dashT = cfg.dashEvery; e.dashing = 1.1;
            const dx = px - e.x, dy = py - e.y, m = Math.hypot(dx, dy) || 1;
            e.vx = dx / m * e.speed * cfg.dashMul; e.vy = dy / m * e.speed * cfg.dashMul;
          }
        }
        break;
      case 'spawner':
        e.spawnT -= dt;
        if (e.spawnT <= 0) {
          e.spawnT = cfg.spawnEvery;
          if (S.enemies.filter(m => !m.boss).length < cfg.spawnCap) {
            const t = cfg.spawnType;
            S.enemies.push(makeEnemy(t, e.x, e.y, { speed: t === 'chaser' ? 13 : 22 }, false));
            burst(e.x * CELL, e.y * CELL, '#c9f', 10, 60);
          }
        }
        break;
      case 'shooter':
        e.t -= dt; if (e.t <= 0) { rotate(e, rand(-0.8, 0.8)); e.t = rand(1, 2.5); }
        e.fireT -= dt;
        if (e.fireT <= 0) {
          e.fireT = cfg.fireEvery;
          const base = Math.atan2(py - e.y, px - e.x), n = cfg.spread;
          for (let k = 0; k < n; k++) {
            const a = base + (k - (n - 1) / 2) * 0.28;
            S.bullets.push({ x: e.x + Math.cos(a) * e.r, y: e.y + Math.sin(a) * e.r, vx: Math.cos(a) * cfg.bulletSpeed, vy: Math.sin(a) * cfg.bulletSpeed });
          }
          beep(240, 0.06, 'square', 0.025);
        }
        break;
    }
    moveEntity(e, dt);
    if (e.flash > 0) e.flash -= dt;
    e.histT -= dt;
    if (e.boss && e.histT <= 0) { e.histT = 0.05; e.hist.unshift([e.x, e.y]); if (e.hist.length > 8) e.hist.pop(); }

    // touching the line being cut ignites a spark that runs toward the ship
    if (p.drawing) {
      const rr = e.r + 0.5, x0 = Math.floor(e.x - rr), x1 = Math.floor(e.x + rr), y0 = Math.floor(e.y - rr), y1 = Math.floor(e.y + rr);
      let best = -1;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (!inb(x, y)) continue;
        const ti = trailIndex[idx(x, y)];
        if (ti > best && Math.hypot(x + 0.5 - e.x, y + 0.5 - e.y) <= rr) best = ti;
      }
      if (best >= 0) ignite(best);
    }
    if (vulnerable() && Math.hypot(e.x - px, e.y - py) < e.r + C.playerR) killPlayer();
  }

  function vulnerable() { const p = S.player; return p.inv <= 0 && (p.drawing || S.shield <= 0); }

  function ignite(k) {
    if (!S.spark) { S.spark = { pos: k }; beep(900, 0.08, 'sawtooth', 0.03, 300); }
    else S.spark.pos = Math.max(S.spark.pos, k);
  }

  // ---------- main update ----------
  function update(dt) {
    S.modeT += dt;
    if (pressed.has('KeyM')) muted = !muted;
    switch (S.mode) {
      case 'title': if (pressed.has('Enter') || pressed.has('Space')) newGame(); break;
      case 'intro': if (S.modeT > 1.6 || pressed.has('Enter')) setMode('play'); break;
      case 'paused': if (pressed.has('KeyP') || pressed.has('Escape') || pressed.has('Enter')) S.mode = 'play'; break;
      case 'dying': updateFx(dt); if (S.modeT > 1.4) { if (S.lives <= 0) { if (S.score > S.hi) { S.hi = S.score; saveHi(); } setMode('over'); } else respawn(); } break;
      case 'clear': updateFx(dt); if (S.modeT > 1.2 && (pressed.has('Enter') || pressed.has('Space'))) startLevel(S.level + 1); break;
      case 'over': if (S.modeT > 1 && pressed.has('Enter')) setMode('title'); break;
      case 'play':
        if (pressed.has('KeyP') || pressed.has('Escape')) { S.mode = 'paused'; break; }
        if (DEBUG && pressed.has('KeyN')) { S.percent = 100; winRound('area'); break; }
        updatePlay(dt);
        break;
    }
    pressed.clear();
  }

  function updatePlay(dt) {
    const T = S.timers;
    for (const k in T) if (T[k] > 0) T[k] = Math.max(0, T[k] - dt);
    if (T.P <= 0) S.shield = Math.max(0, S.shield - C.shieldDrainPerSec * dt);

    updatePlayer(dt);
    if (S.mode !== 'play') return;

    const frozen = T.T > 0;
    if (!frozen) {
      for (const e of [...S.enemies]) { updateEnemy(e, dt); if (S.mode !== 'play') return; }
      // spark chases the ship along the line
      const p = S.player;
      if (S.spark && p.drawing) {
        S.spark.pos += C.sparkSpeed * dt;
        if (S.spark.pos >= p.trail.length - 0.5 && p.inv <= 0) { killPlayer(); return; }
      }
      const px = p.x + 0.5, py = p.y + 0.5;
      S.bullets = S.bullets.filter(b => {
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (cellSolid(b.x, b.y)) return false;
        if (vulnerable() && Math.hypot(b.x - px, b.y - py) < 0.8 + C.playerR) { killPlayer(); return false; }
        return true;
      });
      if (S.mode !== 'play') return;
    } else if (S.spark && S.player.drawing && S.spark.pos >= S.player.trail.length - 0.5 && S.player.inv <= 0) {
      killPlayer(); return; // rewinding into a frozen spark still kills
    }

    // laser shots
    S.shots = S.shots.filter(s => {
      for (let k = 0; k < 4; k++) {
        s.x += s.vx * dt / 4; s.y += s.vy * dt / 4;
        if (cellSolid(s.x, s.y)) return false;
        for (const e of S.enemies) {
          if (Math.hypot(e.x - s.x, e.y - s.y) < e.r + 0.6) {
            if (e.boss) damageBoss(e, 1);
            else { S.enemies = S.enemies.filter(m => m !== e); S.score += C.minionKill; burst(e.x * CELL, e.y * CELL, '#ffb347'); toast('+' + C.minionKill, e.x * CELL, e.y * CELL, '#ffb347'); }
            return false;
          }
        }
      }
      return true;
    });
    updateFx(dt);
  }

  function updateFx(dt) {
    S.particles = S.particles.filter(q => { q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.97; q.vy *= 0.97; return q.t < q.life; });
    S.toasts = S.toasts.filter(t => { t.t += dt; t.y -= 20 * dt; return t.t < 1.3; });
  }

  // ---------- render ----------
  function render() {
    ctx.imageSmoothingEnabled = false;
    if (S.mode === 'title') return renderTitle();
    ctx.drawImage(bgCv, 0, 0);
    ctx.drawImage(revealCv, 0, 0);
    ctx.drawImage(edgeCv, 0, 0, PW, PH);

    const now = performance.now() / 1000;
    // boxes
    for (const b of S.boxes) {
      const x = b.x * CELL, y = b.y * CELL;
      ctx.fillStyle = '#8a93a8'; ctx.fillRect(x - 7, y - 7, 14, 14);
      ctx.strokeStyle = '#dfe6f5'; ctx.lineWidth = 1; ctx.strokeRect(x - 6.5, y - 6.5, 13, 13);
      ctx.fillStyle = '#1b2033'; ctx.font = 'bold 11px Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(DEBUG ? b.kind[0] : '?', x, y + 1);
    }
    // trail
    const p = S.player;
    if (p.trail.length) {
      ctx.fillStyle = '#ff9d3c';
      for (const i of p.trail) ctx.fillRect((i % W) * CELL, ((i / W) | 0) * CELL, CELL, CELL);
    }
    if (S.spark && p.trail.length) {
      const i = p.trail[Math.max(0, Math.min(p.trail.length - 1, Math.floor(S.spark.pos)))];
      const x = (i % W + 0.5) * CELL, y = (((i / W) | 0) + 0.5) * CELL, r = 5 + Math.sin(now * 40) * 2;
      ctx.fillStyle = '#fff'; ctx.shadowColor = '#ff3'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
    // enemies
    const frozen = S.timers.T > 0;
    for (const e of S.enemies) drawEnemy(e, frozen);
    // bullets / shots
    ctx.fillStyle = '#ff5a8a';
    for (const b of S.bullets) { ctx.beginPath(); ctx.arc(b.x * CELL, b.y * CELL, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#ff3b3b';
    for (const s of S.shots) { const hz = s.vx !== 0; ctx.fillRect(s.x * CELL - (hz ? 6 : 1.5), s.y * CELL - (hz ? 1.5 : 6), hz ? 12 : 3, hz ? 3 : 12); }
    // player
    if (S.mode !== 'dying' && !(p.inv > 0 && Math.floor(now * 12) % 2)) drawPlayer(p);
    // fx
    for (const q of S.particles) { ctx.globalAlpha = 1 - q.t / q.life; ctx.fillStyle = q.color; ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3); }
    ctx.globalAlpha = 1;
    ctx.font = 'bold 13px Consolas, monospace'; ctx.textAlign = 'center';
    for (const t of S.toasts) { ctx.globalAlpha = Math.max(0, 1 - t.t / 1.3); ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y); }
    ctx.globalAlpha = 1;

    if (S.mode === 'intro') banner(`ROUND ${S.level + 1}`, `CLAIM ${S.target}% OF THE FIELD`);
    if (S.mode === 'paused') banner('PAUSED', 'P / Esc to continue');
    if (S.mode === 'over') banner('GAME OVER', `SCORE ${S.score}   -   Enter`);
    if (S.mode === 'clear') {
      const c = S.clearInfo;
      const how = { area: 'AREA CLAIMED', boss: 'BOSS DESTROYED!', split: 'BOSSES SPLIT!' }[c.how];
      banner(`ROUND ${S.level + 1} CLEAR`, `${how}  ${c.percent.toFixed(1)}%`,
        [`AREA BONUS  ${c.areaBonus}`, c.special ? `SPECIAL BONUS  ${c.special}` : '', S.modeT > 1.2 ? 'Enter / Space - next round' : ''].filter(Boolean));
    }
  }

  function drawPlayer(p) {
    const x = (p.x + 0.5) * CELL, y = (p.y + 0.5) * CELL;
    if (!p.drawing && S.shield > 0) {
      ctx.strokeStyle = S.timers.P > 0 ? 'rgba(255,210,80,.8)' : 'rgba(80,210,255,.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = p.drawing ? '#ffcf6b' : '#ffffff';
    if (S.timers.L > 0) { ctx.shadowColor = '#f33'; ctx.shadowBlur = 10; }
    if (S.timers.S > 0) { ctx.shadowColor = '#3ff'; ctx.shadowBlur = 10; }
    ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 6, y); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1a2a55'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }

  const BOSS_COLORS = { bouncer: '#ff4fa3', hunter: '#ff7a2f', spawner: '#b06bff', shooter: '#3fe07a' };
  function drawEnemy(e, frozen) {
    const x = e.x * CELL, y = e.y * CELL;
    if (e.boss) {
      const col = e.flash > 0 ? '#fff' : (frozen ? '#8fb7ff' : BOSS_COLORS[e.type]);
      const R = e.r * CELL;
      for (let k = e.hist.length - 1; k >= 1; k--) {
        const [hx, hy] = e.hist[k], rr = R * (1 - k / 10) * 0.6;
        ctx.globalAlpha = 0.25 + 0.5 * (1 - k / e.hist.length); ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(hx * CELL, hy * CELL, rr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      const spikes = { bouncer: 6, hunter: 3, spawner: 8, shooter: 5 }[e.type];
      ctx.fillStyle = col; ctx.beginPath();
      for (let k = 0; k < spikes * 2; k++) {
        const a = e.rot + k * Math.PI / spikes, rr = k % 2 ? R * 0.72 : R;
        k ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#10142a'; ctx.beginPath(); ctx.arc(x, y, R * 0.38, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + Math.cos(e.rot * 0.7) * R * 0.15, y + Math.sin(e.rot * 0.7) * R * 0.15, R * 0.14, 0, Math.PI * 2); ctx.fill();
      if (e.hp < e.maxHp) {
        ctx.fillStyle = '#300'; ctx.fillRect(x - R, y - R - 8, R * 2, 4);
        ctx.fillStyle = '#f44'; ctx.fillRect(x - R, y - R - 8, R * 2 * e.hp / e.maxHp, 4);
      }
      return;
    }
    const R = e.r * CELL;
    ctx.fillStyle = frozen ? '#8fb7ff' : { bouncer: '#ffd24f', wander: '#4fd1ff', chaser: '#ff5a5a' }[e.type];
    ctx.save(); ctx.translate(x, y); ctx.rotate(e.rot);
    if (e.type === 'bouncer') ctx.fillRect(-R * 0.8, -R * 0.8, R * 1.6, R * 1.6);
    else if (e.type === 'wander') { ctx.beginPath(); ctx.moveTo(R, 0); ctx.lineTo(-R * 0.7, R * 0.8); ctx.lineTo(-R * 0.7, -R * 0.8); ctx.closePath(); ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#000'; ctx.fillRect(R * 0.2, -1.5, 3, 3); }
    ctx.restore();
  }

  function banner(title, sub, lines = []) {
    const h = 110 + lines.length * 22;
    ctx.fillStyle = 'rgba(2,4,12,0.72)'; ctx.fillRect(0, PH / 2 - h / 2, PW, h);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px Consolas, monospace'; ctx.fillText(title, PW / 2, PH / 2 - h / 2 + 40);
    ctx.fillStyle = '#9fd8ff'; ctx.font = '18px Consolas, monospace'; ctx.fillText(sub, PW / 2, PH / 2 - h / 2 + 78);
    ctx.fillStyle = '#ffd24f'; ctx.font = '16px Consolas, monospace';
    lines.forEach((l, i) => ctx.fillText(l, PW / 2, PH / 2 - h / 2 + 106 + i * 22));
  }

  function renderTitle() {
    if (!bgCv) bgCv = makeBg(0);
    ctx.drawImage(bgCv, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#4fd1ff'; ctx.font = 'bold 72px Consolas, monospace'; ctx.fillText('VOLFIED', PW / 2, 170);
    ctx.fillStyle = '#6f86b3'; ctx.font = '16px Consolas, monospace'; ctx.fillText('mechanics prototype - theme TBD', PW / 2, 215);
    ctx.fillStyle = '#cfe3ff'; ctx.font = '15px Consolas, monospace';
    [
      'Ride the border. Hold SPACE and steer into the field to cut a line.',
      'Reach the border again to claim the side WITHOUT the boss.',
      'Release SPACE mid-cut and the ship rewinds along its line.',
      'Enemies touching your line send a spark racing toward you.',
      'Shield keeps you safe on the border - until the counter hits 0.',
      'Claim grey ? boxes for power-ups. Win: 80% area, kill the boss,',
      'or (two-boss rounds) cut the bosses apart.',
    ].forEach((l, i) => ctx.fillText(l, PW / 2, 290 + i * 24));
    if (Math.floor(performance.now() / 500) % 2) { ctx.fillStyle = '#ffd24f'; ctx.font = 'bold 22px Consolas, monospace'; ctx.fillText('PRESS ENTER', PW / 2, 500); }
    ctx.fillStyle = '#6f86b3'; ctx.font = '14px Consolas, monospace'; ctx.fillText('HI ' + S.hi, PW / 2, 545);
  }

  // ---------- HUD ----------
  const $ = id => document.getElementById(id);
  const hud = { score: $('hScore'), hi: $('hHi'), round: $('hRound'), lives: $('hLives'), shield: $('hShield'), shieldNum: $('hShieldNum'), area: $('hArea'), target: $('hTarget'), power: $('hPower') };
  const last = {};
  function setText(el, key, v) { if (last[key] !== v) { last[key] = v; el.textContent = v; } }
  function updateHud() {
    setText(hud.score, 's', String(S.score));
    setText(hud.hi, 'h', String(Math.max(S.hi, S.score)));
    setText(hud.round, 'r', String(S.level + 1));
    setText(hud.lives, 'l', String(Math.max(0, S.lives)));
    setText(hud.area, 'a', S.percent.toFixed(1) + '%');
    setText(hud.target, 't', '/ ' + S.target + '%');
    setText(hud.shieldNum, 'sn', String(Math.ceil(S.shield)));
    const w = (S.shield / C.shieldMax * 100).toFixed(1) + '%';
    if (last.sw !== w) { last.sw = w; hud.shield.style.width = w; }
    const cls = S.timers.P > 0 ? 'paused' : (S.shield < 20 ? 'low' : '');
    if (last.sc !== cls) { last.sc = cls; hud.shield.className = cls; }
    const pw = Object.entries(S.timers).filter(([, v]) => v > 0).map(([k, v]) => `<span>${k} ${Math.ceil(v)}</span>`).join(' ');
    if (last.pw !== pw) { last.pw = pw; hud.power.innerHTML = pw; }
  }

  // ---------- loop ----------
  const STEP = 1 / 60;
  let acc = 0, prev = performance.now();
  function frame(now) {
    acc += Math.min(0.1, (now - prev) / 1000); prev = now;
    while (acc >= STEP) { update(STEP); acc -= STEP; }
    render(); updateHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // ?debug: advance the simulation by n fixed steps (lets tests run without rAF)
  if (DEBUG) window.__step = n => { for (let i = 0; i < n; i++) update(STEP); render(); updateHud(); };
})();

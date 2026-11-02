'use strict';
// Pure match simulation: no DOM, no rendering. Every change goes through step(match, dt, inputFn),
// so the same code can later run on an authoritative server for online play.
(() => {
  const GC = window.GC = window.GC || {};
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const DX = [0, 0, -1, 1], DY = [-1, 1, 0, 0];
  const clamp01 = u => (u < 0 ? 0 : u > 1 ? 1 : u);
  GC.DIRS = DIRS;
  GC.DIR_NAMES = ['up', 'down', 'left', 'right'];

  GC.rng = seed => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  GC.createMatch = (cfg, seed) => {
    const W = cfg.gridW, H = cfg.gridH, N = W * H;
    const m = {
      cfg, W, H, N, rnd: GC.rng(seed),
      owner: new Int8Array(N).fill(-1), // territory owner per cell
      trail: new Int8Array(N).fill(-1), // whose open line runs through the cell
      visited: new Uint8Array(N), queue: new Int32Array(N),
      inset: 0, nextInsetAt: cfg.zone.start,
      time: 0, duration: cfg.matchSeconds, suddenDeath: false, over: false, winner: null, ranking: null,
      aliveCells: N, players: [], events: [],
      orbs: [], nextOrbAt: cfg.orbs.first, crown: -1,
    };
    cfg.players.forEach((o, id) => m.players.push({
      id, name: o.name, color: o.color, isBot: !!o.isBot, aggr: o.aggr || 0.5,
      x: 0, y: 0, lastDir: 'up', acc: 0, steps: 0, drawing: false, trailCells: [], start: -1,
      alive: true, out: false, respawnT: 0,
      energy: 0, dashT: 0, shieldT: 0, frozenT: 0, slowT: 0, cd: 0,
      kills: 0, deaths: 0, cells: 0, pct: 0, brain: {},
      skill: o.skill ?? 0.7, skin: o.skin || null,
      streak: 0, lastKillT: -99, nemesis: -1, orbs: 0,
    }));
    const spots = cfg.spots || [[0.22, 0.27], [0.78, 0.27], [0.22, 0.73], [0.78, 0.73]];
    m.players.forEach((p, i) => placePad(m, p, Math.round(W * spots[i][0]), Math.round(H * spots[i][1]), cfg.baseSize));
    countCells(m);
    return m;
  };

  const inArena = (m, x, y) => x >= m.inset && y >= m.inset && x < m.W - m.inset && y < m.H - m.inset;
  GC.inArena = inArena;

  function placePad(m, p, cx, cy, size) {
    const h = size >> 1;
    for (let dy = -h; dy <= h; dy++) for (let dx = -h; dx <= h; dx++) {
      const x = cx + dx, y = cy + dy;
      if (inArena(m, x, y)) m.owner[y * m.W + x] = p.id;
    }
    p.x = cx; p.y = cy;
  }

  function clearTrail(m, p) {
    for (const c of p.trailCells) if (m.trail[c] === p.id) m.trail[c] = -1;
    p.trailCells = []; p.drawing = false;
  }

  // A cut line or a burned line knocks the player out. They lose the share of their land nearest
  // to the kill (cfg.koLoss) to the killer, or to free land if nobody did it, and keep the rest.
  // In sudden death they are out for good, so the rest becomes free land.
  function eliminate(m, q, killer, cause, extraLost = 0) {
    if (!q.alive) return;
    const trail = q.trailCells.slice(0, 400);
    clearTrail(m, q);
    const cells = [];
    for (let i = 0; i < m.N; i++) if (m.owner[i] === q.id) cells.push(i);
    const kx = killer ? killer.x : q.x, ky = killer ? killer.y : q.y, W = m.W;
    cells.sort((a, b) => (Math.abs(a % W - kx) + Math.abs(((a / W) | 0) - ky)) - (Math.abs(b % W - kx) + Math.abs(((b / W) | 0) - ky)));
    const lose = Math.round(cells.length * m.cfg.koLoss), taken = killer ? lose : 0;
    for (let k = 0; k < lose; k++) m.owner[cells[k]] = killer ? killer.id : -1;
    const kept = m.suddenDeath ? 0 : cells.length - lose;
    if (m.suddenDeath) for (let k = lose; k < cells.length; k++) m.owner[cells[k]] = -1;
    q.alive = false; q.deaths++; q.respawnT = m.cfg.respawnDelay; q.energy = 0;
    q.dashT = q.shieldT = q.frozenT = q.slowT = 0;
    if (m.suddenDeath) q.out = true;
    // streaks, revenge on whoever knocked you out last, and the bounty on the crown holder
    let streak = 0, revenge = false, bounty = false;
    if (killer) {
      const cfg = m.cfg;
      streak = m.time - killer.lastKillT <= cfg.streakWindow ? killer.streak + 1 : 1;
      killer.streak = streak; killer.lastKillT = m.time; killer.kills++;
      revenge = killer.nemesis === q.id; if (revenge) killer.nemesis = -1;
      bounty = m.crown === q.id;
      const bonus = cfg.energyPerKill + (revenge ? cfg.revengeEnergy : 0) + (bounty ? cfg.bountyEnergy : 0);
      killer.energy = Math.min(cfg.energyMax, killer.energy + bonus);
      q.nemesis = killer.id;
    }
    m.events.push({
      type: 'elim', who: q.id, by: killer ? killer.id : -1, cause, taken, lost: cells.length - kept + extraLost, kept, trail,
      x: q.x, y: q.y, kx: killer ? killer.x : q.x, ky: killer ? killer.y : q.y, streak, revenge, bounty,
    });
  }

  // Comes back on the land kept after the knockout when there is any, otherwise on a new small base.
  function respawn(m, p) {
    const cfg = m.cfg, h = cfg.respawnSize >> 1, lo = m.inset + h + 2;
    const spanX = Math.max(1, m.W - 2 * lo), spanY = Math.max(1, m.H - 2 * lo);
    const own = [];
    for (let i = 0; i < m.N; i++) if (m.owner[i] === p.id) own.push(i);
    let best = null, bestScore = -Infinity;
    for (let k = 0; k < 40; k++) {
      let cx = lo + Math.floor(m.rnd() * spanX), cy = lo + Math.floor(m.rnd() * spanY);
      if (own.length) { const c = own[Math.floor(m.rnd() * own.length)]; cx = c % m.W; cy = (c / m.W) | 0; }
      let free = 0;
      for (let dy = -h; dy <= h; dy++) for (let dx = -h; dx <= h; dx++) {
        const i = (cy + dy) * m.W + cx + dx;
        if (m.owner[i] === -1 || m.owner[i] === p.id) free++;
        if (m.trail[i] >= 0) free -= 5;
      }
      let dmin = 60;
      for (const q of m.players) if (q !== p && q.alive) dmin = Math.min(dmin, Math.abs(q.x - cx) + Math.abs(q.y - cy));
      const score = free * 2 + dmin;
      if (score > bestScore) { bestScore = score; best = [cx, cy]; }
    }
    placePad(m, p, best[0], best[1], cfg.respawnSize);
    p.alive = true; p.drawing = false; p.trailCells = []; p.acc = 0; p.lastDir = 'up'; p.brain = {};
    p.energy = cfg.respawnEnergy; p.shieldT = cfg.spawnShield; // comeback: some energy and a short shield
    m.events.push({ type: 'respawn', who: p.id, x: p.x, y: p.y });
  }

  // Paper.io-style claim: the line becomes territory, plus everything it encloses together with
  // the player's own land (including rival land). Rivals caught inside are cut or trapped.
  function claim(m, p) {
    const W = m.W, H = m.H, ins = m.inset, cfg = m.cfg;
    const closeCall = p.trailCells.length >= cfg.closeCallMin && GC.threatDist(m, p) <= cfg.closeCallDist;
    for (const c of p.trailCells) { m.owner[c] = p.id; m.trail[c] = -1; }
    let gained = p.trailCells.length;
    p.trailCells = []; p.drawing = false;

    const vis = m.visited, q = m.queue;
    vis.fill(0);
    let qh = 0, qt = 0;
    const seed = i => { if (!vis[i] && m.owner[i] !== p.id) { vis[i] = 1; q[qt++] = i; } };
    for (let x = ins; x < W - ins; x++) { seed(ins * W + x); seed((H - 1 - ins) * W + x); }
    for (let y = ins; y < H - ins; y++) { seed(y * W + ins); seed(y * W + W - 1 - ins); }
    while (qh < qt) {
      const i = q[qh++], x = i % W, y = (i / W) | 0;
      if (x > ins) seed(i - 1);
      if (x < W - 1 - ins) seed(i + 1);
      if (y > ins) seed(i - W);
      if (y < H - 1 - ins) seed(i + W);
    }
    const victims = new Set(), losses = {};
    for (let y = ins; y < H - ins; y++) for (let x = ins; x < W - ins; x++) {
      const i = y * W + x;
      if (vis[i] || m.owner[i] === p.id) continue;
      vis[i] = 2; // enclosed
      const t = m.trail[i], o = m.owner[i];
      if (t >= 0 && t !== p.id) victims.add(t);
      if (o >= 0) losses[o] = (losses[o] || 0) + 1;
      m.owner[i] = p.id; gained++;
    }
    const trapped = [];
    for (const r of m.players) {
      if (r === p || !r.alive || vis[r.y * W + r.x] !== 2) continue;
      if (r.drawing) victims.add(r.id); else trapped.push(r);
    }
    // land lost by rivals who stay in play (knocked-out and trapped rivals report their own loss)
    const plainLosses = {};
    for (const id in losses) if (!victims.has(+id) && !trapped.some(r => r.id === +id)) plainLosses[id] = losses[id];
    // players far behind the leader charge energy faster
    let lead = 0;
    for (const r of m.players) lead = Math.max(lead, r.pct);
    const catchUp = 1 + cfg.catchUp * clamp01(1 - p.pct / Math.max(1, lead));
    p.energy = Math.min(cfg.energyMax, p.energy + gained * cfg.energyPerCell * catchUp + (closeCall ? cfg.closeCallEnergy : 0));
    m.events.push({ type: 'claim', who: p.id, gained, losses: plainLosses, x: p.x, y: p.y, closeCall });
    for (const v of victims) eliminate(m, m.players[v], p, 'enclosed', losses[v] || 0);
    for (const r of trapped) trap(m, r, p, losses[r.id] || 0);
  }

  // Trapping rule: a rival enclosed while safe on their land loses all of it and is thrown to the center.
  function trap(m, r, by, enclosedLoss) {
    if (!r.alive) return;
    let lost = enclosedLoss;
    for (let i = 0; i < m.N; i++) if (m.owner[i] === r.id) { m.owner[i] = -1; lost++; }
    clearTrail(m, r);
    const fx = r.x, fy = r.y;
    placePad(m, r, m.W >> 1, m.H >> 1, m.cfg.trapPad);
    r.brain = {};
    const bounty = m.crown === r.id;
    if (bounty) by.energy = Math.min(m.cfg.energyMax, by.energy + m.cfg.bountyEnergy);
    m.events.push({ type: 'trap', who: r.id, by: by.id, lost, fx, fy, x: r.x, y: r.y, bounty });
  }

  function applyZone(m) {
    const W = m.W, H = m.H, k = m.inset - 1, victims = new Set();
    const burn = i => { m.owner[i] = -1; if (m.trail[i] >= 0) victims.add(m.trail[i]); };
    for (let x = k; x < W - k; x++) { burn(k * W + x); burn((H - 1 - k) * W + x); }
    for (let y = k; y < H - k; y++) { burn(y * W + k); burn(y * W + W - 1 - k); }
    for (const p of m.players) if (p.alive && !inArena(m, p.x, p.y)) victims.add(p.id);
    for (const v of victims) eliminate(m, m.players[v], null, 'zone');
  }

  function useAbility(m, p, kind) {
    const a = m.cfg.abilities[kind];
    if (!a || p.cd > 0 || p.energy < a.cost) return;
    let target = null;
    if (kind === 'freeze') {
      let best = Infinity;
      for (const r of m.players) {
        if (r === p || !r.alive) continue;
        const s = Math.abs(r.x - p.x) + Math.abs(r.y - p.y) - (r.drawing ? 1000 : 0);
        if (s < best) { best = s; target = r; }
      }
      if (!target) return;
      target.frozenT = a.dur;
    }
    p.energy -= a.cost; p.cd = m.cfg.abilityCooldown;
    if (kind === 'dash') p.dashT = a.dur;
    if (kind === 'shield') p.shieldT = a.dur;
    m.events.push({ type: 'ability', who: p.id, kind, target: target ? target.id : -1, x: p.x, y: p.y });
  }

  function stepPlayer(m, p, inp) {
    const W = m.W;
    if (p.drawing && !inp.cut) { // Space released: rewind along the line
      const last = p.trailCells.pop();
      if (m.trail[last] === p.id) m.trail[last] = -1;
      const ni = p.trailCells.length ? p.trailCells[p.trailCells.length - 1] : p.start;
      p.x = ni % W; p.y = (ni / W) | 0;
      if (!p.trailCells.length) p.drawing = false;
      return true;
    }
    let d = inp.dir;
    if (!d && p.dashT > 0) d = p.lastDir; // a dash keeps you moving: fast but hard to control
    if (!d) return false;
    const nx = p.x + DIRS[d][0], ny = p.y + DIRS[d][1];
    if (!inArena(m, nx, ny)) { p.dashT = 0; return false; }
    const n = ny * W + nx, t = m.trail[n];
    if (t === p.id) return false; // can't cross your own line
    const mine = m.owner[n] === p.id;
    if (!mine && !p.drawing && !inp.cut) return false;
    if (t >= 0) {
      const r = m.players[t];
      if (r.shieldT > 0) { // shielded line: bounce off and slow down
        p.slowT = m.cfg.shieldSlowDur; p.dashT = 0;
        m.events.push({ type: 'bump', who: p.id, on: r.id, x: nx, y: ny });
        return false;
      }
      eliminate(m, r, p, 'cut');
    }
    const from = p.y * W + p.x;
    p.x = nx; p.y = ny; p.lastDir = d;
    if (!mine) {
      if (!p.drawing) { p.drawing = true; p.start = from; }
      m.trail[n] = p.id; p.trailCells.push(n);
    } else if (p.drawing) claim(m, p);
    return true;
  }

  // Energy cells: random pickups on free land, collected by whoever's land covers them. They give energy, never land.
  function addOrb(m, x, y, kind) {
    const o = m.cfg.orbs;
    m.orbs.push({ x, y, kind, value: kind === 'surge' ? o.surge : o.energy, t0: m.time });
  }
  GC.addOrb = addOrb;
  function spawnOrb(m) {
    const pad = 4;
    for (let k = 0; k < 30; k++) {
      const x = m.inset + pad + Math.floor(m.rnd() * (m.W - 2 * (m.inset + pad)));
      const y = m.inset + pad + Math.floor(m.rnd() * (m.H - 2 * (m.inset + pad)));
      const i = y * m.W + x;
      if (m.owner[i] !== -1 || m.trail[i] !== -1 || m.orbs.some(b => Math.abs(b.x - x) + Math.abs(b.y - y) < 8)) continue;
      addOrb(m, x, y, m.rnd() < m.cfg.orbs.surgeChance ? 'surge' : 'energy');
      return;
    }
  }
  function stepOrbs(m) {
    const cfg = m.cfg;
    m.orbs = m.orbs.filter(b => {
      if (!inArena(m, b.x, b.y)) return false;
      const ow = m.owner[b.y * m.W + b.x];
      if (ow < 0) return true;
      const p = m.players[ow];
      if (!p.alive) return true;
      p.energy = Math.min(cfg.energyMax, p.energy + b.value); p.orbs++;
      m.events.push({ type: 'orb', who: ow, value: b.value, kind: b.kind, x: b.x, y: b.y });
      return false;
    });
    if (m.time >= m.nextOrbAt) { m.nextOrbAt += cfg.orbs.every; if (m.orbs.length < cfg.orbs.max) spawnOrb(m); }
  }

  // The crown sits on the leader; knocking out or trapping its holder pays a bounty.
  function updateCrown(m) {
    if (m.time < m.cfg.crownAfter) return;
    let top = null;
    for (const p of m.players) if (!top || p.cells > top.cells) top = p;
    const cur = m.crown >= 0 ? m.players[m.crown] : null;
    if (!top.cells || top === cur || (cur && top.pct < cur.pct + 0.5)) return;
    const from = m.crown;
    m.crown = top.id;
    m.events.push({ type: 'crown', who: top.id, from, x: top.x, y: top.y });
  }

  // how close the nearest rival head is to any cell of p's open line
  GC.threatDist = (m, p) => {
    if (!p.trailCells.length) return Infinity;
    let best = Infinity;
    const tc = p.trailCells, W = m.W;
    for (const e of m.players) {
      if (e === p || !e.alive) continue;
      const slack = e.frozenT * m.cfg.speed;
      for (let k = tc.length - 1; k >= 0; k--) {
        const c = tc[k], d = Math.abs(e.x - c % W) + Math.abs(e.y - ((c / W) | 0)) + slack;
        if (d < best) best = d;
      }
    }
    return best;
  };

  // Claim preview: what p would gain by heading home on the shortest path right now.
  // Fills mask with 1 for gained cells and 3 for the path home; returns { count, pct } or null.
  GC.previewClaim = (m, p, mask) => {
    mask.fill(0);
    if (!p.alive || !p.drawing || !p.trailCells.length) return null;
    const W = m.W, H = m.H, ins = m.inset, q = m.queue, vis = m.visited;
    const prev = m.prevBuf || (m.prevBuf = new Int32Array(m.N));
    vis.fill(0);
    const head = p.y * W + p.x;
    let qh = 0, qt = 0, goal = -1;
    q[qt++] = head; vis[head] = 1; prev[head] = -1;
    while (qh < qt && goal < 0) {
      const i = q[qh++], x = i % W, y = (i / W) | 0;
      for (let k = 0; k < 4 && goal < 0; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (!inArena(m, nx, ny)) continue;
        const n = ny * W + nx;
        if (vis[n] || m.trail[n] === p.id) continue;
        vis[n] = 1; prev[n] = i;
        if (m.owner[n] === p.id) goal = n; else q[qt++] = n;
      }
    }
    if (goal < 0) return null;
    const path = [];
    for (let c = prev[goal]; c >= 0 && c !== head; c = prev[c]) path.push(c);
    for (const c of p.trailCells) mask[c] = 2;
    for (const c of path) mask[c] = 2;
    vis.fill(0); qh = qt = 0;
    const seed = i => { if (!vis[i] && mask[i] !== 2 && m.owner[i] !== p.id) { vis[i] = 1; q[qt++] = i; } };
    for (let x = ins; x < W - ins; x++) { seed(ins * W + x); seed((H - 1 - ins) * W + x); }
    for (let y = ins; y < H - ins; y++) { seed(y * W + ins); seed(y * W + W - 1 - ins); }
    while (qh < qt) {
      const i = q[qh++], x = i % W, y = (i / W) | 0;
      if (x > ins) seed(i - 1);
      if (x < W - 1 - ins) seed(i + 1);
      if (y > ins) seed(i - W);
      if (y < H - 1 - ins) seed(i + W);
    }
    let count = 0;
    for (let y = ins; y < H - ins; y++) for (let x = ins; x < W - ins; x++) {
      const i = y * W + x;
      if (m.owner[i] === p.id) { mask[i] = 0; continue; }
      if (mask[i] === 2 || !vis[i]) { mask[i] = 1; count++; }
    }
    for (const c of path) mask[c] = 3;
    return { count, pct: count / m.aliveCells * 100 };
  };

  function countCells(m) {
    for (const p of m.players) p.cells = 0;
    for (let i = 0; i < m.N; i++) { const o = m.owner[i]; if (o >= 0) m.players[o].cells++; }
    m.aliveCells = (m.W - 2 * m.inset) * (m.H - 2 * m.inset);
    for (const p of m.players) p.pct = p.cells / m.aliveCells * 100;
  }

  // reason: 'domination' (reached winPercent), 'lastStanding' (sudden death) or 'time'
  function finish(m, winner, reason) {
    m.over = true; m.endReason = reason;
    m.ranking = [...m.players].sort((a, b) => (b.cells - a.cells) || (b.kills - a.kills) || (a.deaths - b.deaths));
    if (winner) m.ranking = [winner, ...m.ranking.filter(p => p !== winner)];
    m.winner = m.ranking[0];
    m.events.push({ type: 'over', who: m.winner.id, reason });
  }

  // inputFn(player, match) -> { dir: 'up'|'down'|'left'|'right'|null, cut: bool, ability: 'dash'|'shield'|'freeze'|null }
  GC.step = (m, dt, inputFn) => {
    if (m.over) return;
    const cfg = m.cfg, P = m.players;
    m.time += dt;
    if (!m.suddenDeath && m.time >= m.duration - cfg.suddenDeath) {
      m.suddenDeath = true;
      for (const p of P) if (!p.alive) p.out = true;
      m.events.push({ type: 'sudden' });
    }
    if (m.inset < cfg.zone.maxInset && m.time >= m.nextInsetAt) {
      m.inset++; m.nextInsetAt += cfg.zone.every;
      applyZone(m);
      m.events.push({ type: 'zone', inset: m.inset });
    }
    for (const p of P) {
      if (!p.alive) { if (!p.out && (p.respawnT -= dt) <= 0) respawn(m, p); continue; }
      p.dashT = Math.max(0, p.dashT - dt); p.shieldT = Math.max(0, p.shieldT - dt);
      p.frozenT = Math.max(0, p.frozenT - dt); p.slowT = Math.max(0, p.slowT - dt); p.cd = Math.max(0, p.cd - dt);
    }
    const inputs = P.map(p => (p.alive ? inputFn(p, m) : null));
    P.forEach((p, i) => { if (p.alive && inputs[i].ability) useAbility(m, p, inputs[i].ability); });
    P.forEach((p, i) => {
      if (!p.alive || p.frozenT > 0) { p.acc = 0; return; }
      const rewinding = p.drawing && !inputs[i].cut;
      const spd = rewinding ? cfg.rewindSpeed : cfg.speed * (p.dashT > 0 ? cfg.dashMul : 1) * (p.slowT > 0 ? cfg.slowMul : 1);
      p.acc += spd * dt;
    });
    // interleave single-cell steps so nobody gets to move twice before the others move once
    for (let any = true; any;) {
      any = false;
      P.forEach((p, i) => {
        if (!p.alive || p.frozenT > 0 || p.acc < 1 || !inputs[i]) return;
        any = true; p.acc -= 1;
        if (stepPlayer(m, p, inputs[i])) p.steps++; else p.acc = 0;
      });
    }
    stepOrbs(m);
    countCells(m);
    updateCrown(m);
    for (const p of P) {
      if (p.pct >= cfg.winPercent) return finish(m, p, 'domination');
      if (!p.warned && p.pct >= cfg.winPercent * 0.8) { p.warned = true; m.events.push({ type: 'close', who: p.id }); }
      if (p.warned && p.pct < cfg.winPercent * 0.6) p.warned = false;
    }
    if (m.suddenDeath) {
      const living = P.filter(p => p.alive);
      if (living.length <= 1) return finish(m, living[0] || null, 'lastStanding');
    }
    if (m.time >= m.duration) finish(m, null, 'time');
  };
})();

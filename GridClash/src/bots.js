'use strict';
// Bot brains. A bot only produces the same input a human would (dir / cut / ability).
(() => {
  const GC = window.GC;
  const DX = [0, 0, -1, 1], DY = [-1, 1, 0, 0], DN = GC.DIR_NAMES;
  const PERP = { up: ['left', 'right'], down: ['left', 'right'], left: ['up', 'down'], right: ['up', 'down'] };
  let dist = null, first = null, queue = null;

  function bfs(m, start, passable, goal, maxDist) {
    if (!dist || dist.length !== m.N) { dist = new Int32Array(m.N); first = new Int8Array(m.N); queue = new Int32Array(m.N); }
    dist.fill(-1);
    const W = m.W, H = m.H;
    let h = 0, t = 0;
    queue[t++] = start; dist[start] = 0; first[start] = -1;
    while (h < t) {
      const i = queue[h++], d = dist[i];
      if (i !== start && goal(i)) return { dir: DN[first[i]], dist: d, cell: i };
      if (d >= maxDist || (i !== start && !passable(i))) continue;
      const x = i % W, y = (i / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (dist[n] >= 0 || (!goal(n) && !passable(n))) continue;
        dist[n] = d + 1; first[n] = i === start ? k : first[i]; queue[t++] = n;
      }
    }
    return null;
  }

  // cells about to burn count as dead for planning
  function deadish(m, i) {
    const z = m.cfg.zone;
    const soon = m.inset < z.maxInset && m.time >= m.nextInsetAt - z.warn - 1 ? 1 : 0;
    const k = m.inset + soon, x = i % m.W, y = (i / m.W) | 0;
    return x < k || y < k || x >= m.W - k || y >= m.H - k;
  }

  function room(m, p, d) {
    let n = 0, x = p.x, y = p.y;
    while (n < 60) { x += GC.DIRS[d][0]; y += GC.DIRS[d][1]; if (deadish(m, y * m.W + x) || x < 0 || y < 0 || x >= m.W || y >= m.H) break; n++; }
    return n;
  }

  function planExpedition(m, p) {
    const b = p.brain, r = m.rnd, a = p.aggr;
    // sometimes go for a nearby energy cell: first along x, then along y, a little past it
    const orb = m.orbs.reduce((best, o) => {
      const d = Math.abs(o.x - p.x) + Math.abs(o.y - p.y);
      return d < 30 && d > 2 && (!best || d < best.d) ? { o, d } : best;
    }, null);
    if (orb && r() < 0.6) {
      const dx = orb.o.x - p.x, dy = orb.o.y - p.y, legs = [];
      if (dx) legs.push({ d: dx > 0 ? 'right' : 'left', n: Math.abs(dx) + 2 });
      if (dy) legs.push({ d: dy > 0 ? 'down' : 'up', n: Math.abs(dy) + 2 });
      if (legs.length) { b.legs = legs; b.maxTrail = 40 + a * 90; b.mode = 'out'; return; }
    }
    const opts = DN.map(d => ({ d, w: Math.max(0, room(m, p, d) - 6) + 1 }));
    let roll = r() * opts.reduce((s, o) => s + o.w, 0), d = opts[0].d;
    for (const o of opts) { roll -= o.w; if (roll <= 0) { d = o.d; break; } }
    const [pa, pb] = PERP[d], perp = room(m, p, pa) + r() * 20 > room(m, p, pb) + r() * 20 ? pa : pb;
    b.legs = [{ d, n: 4 + Math.floor(r() * (6 + a * 18)) }, { d: perp, n: 4 + Math.floor(r() * (8 + a * 22)) }];
    b.maxTrail = 30 + a * 90;
    b.mode = 'out';
  }

  function nextOk(m, p, d, pass) {
    const nx = p.x + GC.DIRS[d][0], ny = p.y + GC.DIRS[d][1];
    return nx >= 0 && ny >= 0 && nx < m.W && ny < m.H && pass(ny * m.W + nx);
  }

  GC.botThink = (p, m) => {
    const b = p.brain, cfg = m.cfg, ab = cfg.abilities;
    // lower skill = slower reactions
    if (b.cache && b.cacheSteps === p.steps && m.time - b.cacheT < 0.05 + (1 - p.skill) * 0.3) return b.cache;
    const stepped = b.lastSteps === undefined ? 0 : p.steps - b.lastSteps;
    b.lastSteps = p.steps;
    const head = p.y * m.W + p.x;
    const pass = i => !deadish(m, i) && m.trail[i] !== p.id;
    const isPrey = i => { const t = m.trail[i]; return t >= 0 && t !== p.id && m.players[t].shieldT <= 0; };
    const out = { dir: null, cut: true, ability: null };
    b.mode = b.mode || 'idle';

    if (p.drawing) {
      if (b.mode === 'out' && stepped > 0 && b.legs.length) {
        b.legs[0].n -= stepped;
        if (b.legs[0].n <= 0) b.legs.shift();
        if (!b.legs.length) b.mode = 'return';
      }
      const home = bfs(m, head, pass, i => m.owner[i] === p.id && !deadish(m, i), 400);
      const homeDist = home ? home.dist : 999;
      const threat = GC.threatDist(m, p);
      const danger = threat <= homeDist + 2 + (1 - p.aggr) * 5;
      if (b.mode === 'hunt') {
        const h = bfs(m, head, pass, isPrey, 25);
        if (!h || (danger && h.dist > threat)) b.mode = 'return';
        else out.dir = h.dir;
      }
      if (danger && b.mode !== 'hunt') {
        b.mode = 'return';
        if (threat <= 4 && p.shieldT <= 0 && p.energy >= ab.shield.cost) out.ability = 'shield';
        else if (homeDist > 5 && p.dashT <= 0 && p.energy >= ab.dash.cost) out.ability = 'dash';
      }
      if (p.trailCells.length > b.maxTrail && b.mode === 'out') b.mode = 'return';
      if (b.mode === 'out') {
        const d = b.legs[0].d;
        if (nextOk(m, p, d, pass)) out.dir = d; else b.mode = 'return';
      }
      if (!out.dir) out.dir = home ? home.dir : DN.find(d => nextOk(m, p, d, pass)) || null;
    } else {
      if (b.mode !== 'out') b.mode = 'idle';
      const h = bfs(m, head, pass, isPrey, 10 + p.aggr * 30);
      if (h && p.aggr > 0.2) {
        b.mode = 'hunt'; out.dir = h.dir;
        const prey = m.players[m.trail[h.cell]];
        if (h.dist <= 14 && prey.frozenT <= 0 && p.energy >= ab.freeze.cost) out.ability = 'freeze';
        else if (h.dist > 6 && p.aggr > 0.6 && p.energy >= ab.dash.cost + 20) out.ability = 'dash';
      } else {
        if (b.mode !== 'out' || !b.legs || !b.legs.length) planExpedition(m, p);
        for (let tries = 0; tries < 4 && !nextOk(m, p, b.legs[0].d, pass); tries++) planExpedition(m, p);
        out.dir = b.legs[0].d;
      }
    }
    if (out.ability && m.rnd() > 0.3 + 0.7 * p.skill) out.ability = null;
    b.cache = out; b.cacheSteps = p.steps; b.cacheT = m.time;
    return out;
  };
})();

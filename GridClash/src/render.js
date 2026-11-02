'use strict';
(() => {
  const GC = window.GC;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const light = c => `rgb(${Math.min(255, c[0] + 60)},${Math.min(255, c[1] + 60)},${Math.min(255, c[2] + 60)})`;
  const ROT = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 };
  const clamp01 = u => (u < 0 ? 0 : u > 1 ? 1 : u);
  const easeOut = u => 1 - Math.pow(1 - u, 3);
  const easeOutBack = u => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
  const FLASH = 0.5; // seconds a changed cell glows
  const hsl = (h, l = 0.62) => { // hue 0..360 -> [r, g, b], full saturation
    const f = n => { const k = (n + h / 30) % 12, a = Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
    return [f(0), f(8), f(4)];
  };

  // Ship shapes (cosmetic only), drawn pointing right around (0, 0).
  GC.drawShip = (ctx, shape, fill, stroke) => {
    ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1.5;
    ctx.beginPath();
    const poly = pts => { ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath(); };
    if (shape === 'arrow') poly([9, 0, -1, 7, -1, 3, -7, 3, -7, -3, -1, -3, -1, -7]);
    else if (shape === 'delta') poly([9, 0, -6, 7, -4, 0, -6, -7]);
    else if (shape === 'orb') { ctx.arc(-1, 0, 6, 0, Math.PI * 2); ctx.moveTo(10, 0); ctx.lineTo(4, 4); ctx.lineTo(4, -4); ctx.closePath(); }
    else if (shape === 'star') { const pts = []; for (let k = 0; k < 10; k++) { const r = k % 2 ? 3.6 : 8.5, a = k * Math.PI / 5; pts.push(Math.cos(a) * r, Math.sin(a) * r); } poly(pts); }
    else poly([8, 0, -6, 6, -3, 0, -6, -6]);
    ctx.fill(); ctx.stroke();
  };

  GC.createRenderer = (canvas, cfg) => {
    const W = cfg.gridW, H = cfg.gridH, N = W * H, CELL = cfg.cell, PW = W * CELL, PH = H * CELL;
    canvas.width = PW; canvas.height = PH;
    const ctx = canvas.getContext('2d');
    const gridCv = mk(W, H), gctx = gridCv.getContext('2d'), img = gctx.createImageData(W, H);
    const cx = v => (v + 0.5) * CELL;

    // Cell-change tracking: any change of owner animates (claim waves, stolen land, erased land).
    const prevOwner = new Int8Array(N), fromOwner = new Int8Array(N).fill(-1), changeT = new Float32Array(N).fill(-10);
    let lastMatch = null, T = 0, zoneT = -10;
    const fx = { particles: [], popups: [], rings: [], beams: [], announce: null, shake: 0, jumps: {}, spawns: {}, origins: {} };
    const opt = { shake: true };
    let preview = null, previewMask = null, danger = 0; // set each frame by the game for the human player

    const bg = mk(PW, PH);
    {
      const g = bg.getContext('2d');
      g.fillStyle = '#070912'; g.fillRect(0, 0, PW, PH);
      g.strokeStyle = 'rgba(90,120,255,0.07)';
      for (let x = 0; x <= PW; x += CELL * 4) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, PH); g.stroke(); }
      for (let y = 0; y <= PH; y += CELL * 4) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(PW, y + 0.5); g.stroke(); }
    }

    // ---------- effect primitives ----------
    function burst(x, y, color, n = 16, sp = 120, o = {}) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = sp * (0.3 + Math.random() * 0.7);
        fx.particles.push({ x, y, vx: Math.cos(a) * v + (o.vx || 0), vy: Math.sin(a) * v + (o.vy || 0), g: o.g || 0, life: (o.life || 0.6) * (0.6 + Math.random() * 0.7), t: 0, color, size: o.size || 3 });
      }
    }
    function popup(text, x, y, color, size = 14, o = {}) {
      fx.popups.push({ text, x: Math.max(30, Math.min(PW - 30, x)), y: Math.max(20, y), color, size, t0: T + (o.delay || 0), life: o.life || 1.4, rise: o.rise ?? 34 });
    }
    function ring(x, y, r0, r1, color, life = 0.5, width = 3, delay = 0) { fx.rings.push({ x, y, r0, r1, color, life, width, t0: T + delay }); }
    function beam(x1, y1, x2, y2, color, life = 0.4) { fx.beams.push({ x1, y1, x2, y2, color, life, t0: T }); }
    // a less important announcement waits until the current one is over
    function announce(text, sub = '', color = '#fff', life = 1.5, prio = 1) {
      const a = { text, sub, color, life, prio, t0: T }, cur = fx.announce;
      if (cur && cur.prio > prio && T - cur.t0 < cur.life * 0.7) fx.next = a; else fx.announce = a;
    }
    function shake(a) { if (opt.shake) fx.shake = Math.max(fx.shake, a); }

    function update(dt) {
      T += dt;
      fx.particles = fx.particles.filter(q => { q.t += dt; q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.96; q.vy *= 0.96; return q.t < q.life; });
      fx.popups = fx.popups.filter(q => T - q.t0 < q.life);
      fx.rings = fx.rings.filter(r => T - r.t0 < r.life);
      fx.beams = fx.beams.filter(b => T - b.t0 < b.life);
      if (fx.announce && T - fx.announce.t0 > fx.announce.life) { fx.announce = fx.next || null; if (fx.next) fx.next.t0 = T; fx.next = null; }
      fx.shake *= Math.exp(-dt * 9); if (fx.shake < 0.1) fx.shake = 0;
    }

    // ---------- events -> visuals ----------
    // opts.humanId: whose events get announcements and shakes; opts.quiet: no announcements / shake (demos, attract mode)
    function fxEvents(m, events, opts = {}) {
      const P = m.players, hid = opts.humanId ?? -1, quiet = !!opts.quiet;
      const pct = c => c / m.aliveCells * 100;
      const fmt = v => (v >= 10 ? v.toFixed(0) : v.toFixed(1));
      for (const e of events) {
        const who = P[e.who], x = e.x !== undefined ? cx(e.x) : 0, y = e.y !== undefined ? cx(e.y) : 0;
        switch (e.type) {
          case 'claim': {
            fx.origins[e.who] = { x: e.x, y: e.y };
            const v = pct(e.gained), isH = e.who === hid;
            popup(`+${fmt(v)}%`, x, y - 14, light(who.color), Math.min(32, 13 + v * 2.2) + (isH ? 3 : 0));
            ring(x, y, 4, 18 + Math.min(60, v * 5), rgb(who.color), 0.55, 3);
            burst(x, y, who.color, 8 + Math.min(30, v * 3), 70, { life: 0.5 });
            for (const id in e.losses) {
              const q = P[id], lv = pct(e.losses[id]);
              if (q.alive && lv >= 0.1) popup(`-${fmt(lv)}%`, cx(q.x), cx(q.y) - 14, '#ff6b6b', Math.min(26, 13 + lv * 2), { delay: 0.15 });
            }
            if (e.closeCall) { popup('CLOSE CALL!', x, y - 36, '#ff9d3c', 13, { delay: 0.1, rise: 20 }); ring(x, y, 4, 30, '#ff9d3c', 0.4, 2, 0.1); }
            if (!quiet && isH && v >= 5) announce('BIG CLAIM!', `+${fmt(v)}%`, '#9ff', 1.1);
            else if (!quiet && isH && e.closeCall) { announce('CLOSE CALL!', `+${cfg.closeCallEnergy} energy`, '#ff9d3c', 0.9); shake(2); }
            break;
          }
          case 'elim': {
            if (e.by >= 0) fx.origins[e.by] = { x: e.kx, y: e.ky };
            fx.origins[-1] = { x: e.x, y: e.y };
            for (const c of e.trail) if (Math.random() < 0.6) burst(cx(c % W), cx((c / W) | 0), who.color, 1, 60, { life: 0.8, g: 60 });
            burst(x, y, who.color, 40, 230, { life: 0.8 });
            burst(x, y, [255, 255, 255], 14, 160, { life: 0.4 });
            ring(x, y, 6, 70, '#ffffff', 0.6, 5); ring(x, y, 6, 45, rgb(who.color), 0.7, 3, 0.08);
            // the loss sinks below the wreck, the killer's gain rises above, so they never overlap
            popup(`-${fmt(pct(e.lost))}%`, x, y + 22, '#ff6b6b', Math.min(30, 16 + pct(e.lost) * 1.2), { life: 1.6, rise: -26 });
            popup(e.cause === 'zone' ? 'BURNED' : 'KO', x, y - 44, '#fff', 12, { rise: 18 });
            if (e.by >= 0) {
              const k = P[e.by], kxp = cx(e.kx), kyp = cx(e.ky);
              popup(`+${fmt(pct(e.taken))}%`, kxp, kyp - 16, light(k.color), Math.min(30, 16 + pct(e.taken) * 1.4), { delay: 0.2, life: 1.6 });
              ring(kxp, kyp, 4, 40, rgb(k.color), 0.5, 3, 0.2);
            }
            const streakName = e.streak >= 4 ? 'RAMPAGE' : ['', '', 'DOUBLE KO', 'TRIPLE KO'][e.streak] || '';
            if (e.by >= 0) {
              const kxp = cx(e.kx), kyp = cx(e.ky);
              let off = 40;
              if (streakName) { popup(streakName, kxp, kyp - off, '#ffd24f', 15, { delay: 0.3, rise: 22 }); off += 16; }
              if (e.revenge) { popup('REVENGE!', kxp, kyp - off, '#ff4fa3', 14, { delay: 0.4, rise: 22 }); off += 16; }
              if (e.bounty) popup(`BOUNTY +${cfg.bountyEnergy}`, kxp, kyp - off, '#ffd24f', 13, { delay: 0.5, rise: 22 });
            }
            if (!quiet) {
              shake(e.who === hid || e.by === hid ? 9 : 3);
              if (e.by === hid) {
                const title = streakName ? streakName + '!' : e.revenge ? 'REVENGE!' : 'KO!';
                const bonus = [e.revenge && streakName && 'REVENGE', e.bounty && 'CROWN BOUNTY'].filter(Boolean).join(' + ');
                announce(title, `+${fmt(pct(e.taken))}% from ${who.name}${bonus ? '  -  ' + bonus : ''}`, streakName ? '#ffb347' : e.revenge ? '#ff4fa3' : '#ffd24f', 1.5, 2);
              } else if (e.who === hid) announce('KNOCKED OUT', e.by >= 0 ? `by ${P[e.by].name} - get REVENGE for bonus energy` : 'burned by the zone', '#ff6b6b', 1.5, 2);
            }
            break;
          }
          case 'trap': {
            const fxp = cx(e.fx), fyp = cx(e.fy), by = P[e.by];
            fx.jumps[e.who] = { fx: fxp, fy: fyp, t0: T, dur: 0.6 };
            fx.origins[e.by] = { x: by.x, y: by.y };
            fx.origins[-1] = { x: e.fx, y: e.fy };
            burst(fxp, fyp, who.color, 26, 150);
            popup(`-${fmt(pct(e.lost))}%`, fxp, fyp - 16, '#ff6b6b', Math.min(30, 16 + pct(e.lost) * 1.2), { life: 1.6 });
            popup('TRAPPED!', fxp, fyp - 40, '#ffd24f', 13, { rise: 18 });
            ring(x, y, 30, 4, rgb(who.color), 0.4, 3, 0.45); ring(x, y, 4, 36, '#fff', 0.5, 3, 0.6);
            if (e.bounty) popup(`BOUNTY +${cfg.bountyEnergy}`, cx(by.x), cx(by.y) - 36, '#ffd24f', 13, { delay: 0.3, rise: 22 });
            if (!quiet) {
              shake(e.who === hid || e.by === hid ? 7 : 2);
              if (e.who === hid) announce('TRAPPED!', 'your land is gone - thrown to the center', '#ffd24f', 1.5, 2);
              else if (e.by === hid) announce('TRAPPED!', `${who.name} lost ${fmt(pct(e.lost))}%`, '#9ff', 1.5, 2);
            }
            break;
          }
          case 'ability': {
            const col = { dash: '#ffd24f', shield: '#ffffff', freeze: '#bfe9ff' }[e.kind];
            popup(e.kind.toUpperCase() + '!', x, y - 30, col, 12, { rise: 22, life: 1 });
            if (e.kind === 'dash') { ring(x, y, 4, 30, col, 0.35, 3); burst(x, y, [255, 210, 80], 18, 160, { life: 0.35 }); }
            if (e.kind === 'shield') { ring(x, y, 24, 10, col, 0.35, 3); ring(x, y, 4, 34, col, 0.5, 2, 0.1); }
            if (e.kind === 'freeze' && e.target >= 0) {
              const t = P[e.target], tx = cx(t.x), ty = cx(t.y);
              beam(x, y, tx, ty, col, 0.45);
              burst(tx, ty, [190, 233, 255], 26, 110, { life: 0.7 });
              ring(tx, ty, 4, 34, col, 0.5, 3, 0.1);
              if (!quiet && e.target === hid) announce('FROZEN!', `by ${who.name}`, col, 0.9);
            }
            break;
          }
          case 'bump':
            burst(x, y, [255, 157, 60], 12, 100, { life: 0.35 });
            popup('BOUNCE', x, y - 12, '#ff9d3c', 11, { rise: 16, life: 0.8 });
            if (!quiet && e.who === hid) shake(3);
            break;
          case 'zone': {
            zoneT = T;
            const k = e.inset - 1;
            for (let n = 0; n < 70; n++) {
              const side = Math.floor(Math.random() * 4), s = Math.random();
              const px = side < 2 ? k + s * (W - 1 - 2 * k) : side === 2 ? k : W - 1 - k;
              const py = side >= 2 ? k + s * (H - 1 - 2 * k) : side === 0 ? k : H - 1 - k;
              burst(cx(px), cx(py), Math.random() < 0.5 ? [255, 120, 40] : [255, 60, 40], 1, 30, { vy: -50, life: 1.2, size: 2.5 });
            }
            if (!quiet) { shake(1.5); if (e.inset === 1) announce('ZONE SHRINKING', 'the edge is burning', '#ff9d3c', 1.4); }
            break;
          }
          case 'sudden': if (!quiet) { announce('SUDDEN DEATH', 'no more respawns', '#ff5a5a', 1.8, 2); shake(6); } break;
          case 'respawn':
            fx.spawns[e.who] = { t0: T };
            for (let n = 0; n < 18; n++) {
              const a = Math.random() * Math.PI * 2, r = 40;
              fx.particles.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: -Math.cos(a) * 110, vy: -Math.sin(a) * 110, g: 0, life: 0.35, t: 0, color: who.color, size: 3 });
            }
            ring(x, y, 34, 4, rgb(who.color), 0.35, 3); ring(x, y, 4, 26, '#fff', 0.4, 2, 0.35);
            break;
          case 'orb': {
            const col = e.kind === 'surge' ? '#ffd24f' : '#c99bff';
            popup(`+${e.value} ENERGY`, x, y - 12, col, e.kind === 'surge' ? 15 : 12, { rise: 26 });
            ring(x, y, 3, e.kind === 'surge' ? 34 : 22, col, 0.45, 3);
            burst(x, y, e.kind === 'surge' ? [255, 210, 80] : [190, 140, 255], e.kind === 'surge' ? 26 : 14, 110, { life: 0.5 });
            break;
          }
          case 'crown':
            popup('CROWN', x, y - 34, '#ffd24f', 13, { rise: 20 });
            ring(x, y, 4, 30, '#ffd24f', 0.5, 3);
            if (!quiet) {
              if (e.who === hid) announce('YOU HAVE THE CROWN', 'rivals get a bounty for taking you down', '#ffd24f', 1.4, 0);
              else if (e.from === hid) announce('CROWN LOST', `${who.name} leads now`, '#ff9d3c', 1.0, 0);
            }
            break;
          case 'close':
            if (!quiet) announce(`${who.id === hid ? 'YOU ARE' : who.name} AT ${Math.floor(who.pct)}%`, `first to ${cfg.winPercent}% wins`, light(who.color), 1.6);
            break;
          case 'over':
            for (let n = 0; n < 160; n++) {
              fx.particles.push({ x: Math.random() * PW, y: -10 - Math.random() * 80, vx: (Math.random() - 0.5) * 60, vy: 40 + Math.random() * 80, g: 60, life: 2.5 + Math.random(), t: 0, color: Math.random() < 0.7 ? who.color : [255, 255, 255], size: 4 });
            }
            break;
        }
      }
    }

    // ---------- grid ----------
    function syncGrid(m) {
      if (m !== lastMatch) {
        prevOwner.set(m.owner); fromOwner.fill(-1); changeT.fill(-10);
        lastMatch = m; fx.jumps = {}; fx.spawns = {}; fx.origins = {};
        return;
      }
      const o = m.owner, org = fx.origins;
      for (let i = 0; i < N; i++) {
        const ow = o[i];
        if (ow === prevOwner[i]) continue;
        fromOwner[i] = prevOwner[i]; prevOwner[i] = ow;
        const g = org[ow];
        let delay = 0;
        if (g) delay = Math.min(0.6, (Math.abs(i % W - g.x) + Math.abs(((i / W) | 0) - g.y)) * 0.008); // wave spreads from the event
        changeT[i] = T + delay;
      }
      fx.origins = {};
    }

    let hidG = -1;
    function drawGrid(m, hid) {
      hidG = hid;
      syncGrid(m);
      const d = img.data, P = m.players, ins = m.inset;
      const warn = m.inset < cfg.zone.maxInset && m.time >= m.nextInsetAt - cfg.zone.warn;
      const blink = Math.floor(T * 8) % 2;
      const burnGlow = clamp01(1 - (T - zoneT) / 0.8);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, o = i * 4;
        const ringIdx = Math.min(x, y, W - 1 - x, H - 1 - y);
        if (ringIdx < ins) { // burned zone, the freshest ring still glowing
          const s = (x + y) % 6 === 0 ? 40 : 18;
          const gl = ringIdx === ins - 1 ? burnGlow : 0;
          d[o] = s + 10 + 230 * gl; d[o + 1] = 4 + 90 * gl; d[o + 2] = 8 + 20 * gl; d[o + 3] = 255; continue;
        }
        const t = m.trail[i];
        if (t >= 0) {
          const q = P[t], skin = q.skin && q.skin.trail;
          let c = q.color, k = 1;
          if (skin === 'rainbow') c = hsl(((x + y) * 9 + T * 160) % 360);
          else if (skin === 'dotted') k = (x + y) & 1 ? 0.55 : 1;
          else if (skin === 'pulse') k = 0.7 + 0.3 * Math.sin(T * 9 - (x + y) * 0.5);
          let r = Math.min(255, (c[0] + 70) * k), g = Math.min(255, (c[1] + 70) * k), b = Math.min(255, (c[2] + 70) * k);
          if (t === hidG && danger > 0) { // your line pulses red when a rival gets close
            const w = danger * (0.55 + 0.45 * Math.sin(T * (8 + 14 * danger)));
            r += (255 - r) * w; g *= 1 - w * 0.8; b *= 1 - w * 0.8;
          }
          if (q.shieldT > 0 && blink) r = g = b = 255;
          d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
        } else {
          const age = T - changeT[i];
          const ow = age < 0 ? fromOwner[i] : m.owner[i]; // the wave has not reached this cell yet
          if (ow >= 0) {
            const c = P[ow].color;
            const edge = (x > 0 && m.owner[i - 1] !== ow) || (x < W - 1 && m.owner[i + 1] !== ow) || (y > 0 && m.owner[i - W] !== ow) || (y < H - 1 && m.owner[i + W] !== ow);
            const k = edge ? 1 : 0.42;
            let r = c[0] * k, g = c[1] * k, b = c[2] * k, a = edge ? 255 : 215;
            if (age >= 0 && age < FLASH) { const w = (1 - age / FLASH) * 0.85; r += (255 - r) * w; g += (255 - g) * w; b += (255 - b) * w; a = 255; }
            d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
          } else if (age >= 0 && age < FLASH && fromOwner[i] >= 0) { // land lost: fades out red
            const c = P[fromOwner[i]].color, f = 1 - age / FLASH;
            d[o] = Math.min(255, c[0] * 0.5 + 150 * f); d[o + 1] = c[1] * 0.35 * f; d[o + 2] = c[2] * 0.35 * f; d[o + 3] = 230 * f;
          } else d[o + 3] = 0;
          const pv = previewMask && hidG >= 0 && previewMask[i];
          if (pv === 1) { // ghost of the land you'd get by heading home now
            const c = P[hidG].color, a = ((x + y + Math.floor(T * 14)) % 6 < 3) ? 0.42 : 0.2;
            d[o] = d[o] * (1 - a) + c[0] * a; d[o + 1] = d[o + 1] * (1 - a) + c[1] * a; d[o + 2] = d[o + 2] * (1 - a) + c[2] * a; d[o + 3] = Math.max(d[o + 3], 150);
          } else if (pv === 3 && (x + y + Math.floor(T * 10)) % 3 === 0) { // the way home
            d[o] = 255; d[o + 1] = 255; d[o + 2] = 255; d[o + 3] = 150;
          }
        }
        if (warn && ringIdx === ins && blink) { d[o] = 255; d[o + 1] = 60; d[o + 2] = 40; d[o + 3] = 200; }
      }
      gctx.putImageData(img, 0, 0);
    }

    // ---------- players ----------
    function headPos(p) {
      let x = cx(p.x), y = cx(p.y), s = 1, lift = 0;
      const j = fx.jumps[p.id];
      if (j) { // thrown across the map in an arc
        const u = (T - j.t0) / j.dur;
        if (u >= 1) delete fx.jumps[p.id];
        else {
          const e = easeOut(u);
          x = j.fx + (x - j.fx) * e; y = j.fy + (y - j.fy) * e;
          lift = Math.sin(Math.PI * u) * 60; s = 1 + Math.sin(Math.PI * u) * 0.9;
          if (Math.random() < 0.8) burst(x, y - lift, p.color, 1, 20, { life: 0.4 });
        }
      }
      const sp = fx.spawns[p.id];
      if (sp) { const u = (T - sp.t0) / 0.45; if (u >= 1) delete fx.spawns[p.id]; else s *= Math.max(0.01, easeOutBack(clamp01(u))); }
      return { x, y: y - lift, s };
    }

    function drawPlayer(p, m, hid) {
      const { x, y, s } = headPos(p);
      if (p.id === hid) { // keep track of yourself
        ctx.strokeStyle = rgb(p.color, 0.35 + 0.15 * Math.sin(T * 6)); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 13 + Math.sin(T * 6) * 2, 0, Math.PI * 2); ctx.stroke();
        if (m.time < 3 && PW >= 600) {
          const by = y - 44 + Math.sin(T * 10) * 4;
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x, by + 10); ctx.lineTo(x - 7, by); ctx.lineTo(x + 7, by); ctx.closePath(); ctx.fill();
          ctx.font = 'bold 11px Consolas, monospace'; ctx.textAlign = 'center'; ctx.fillText('THIS IS YOU', x, by - 5);
        }
      }
      if (p.shieldT > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 11 + Math.sin(T * 20) * 1.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      if (p.dashT > 0) { burst(x, y, p.color, 2, 30, { life: 0.3 }); burst(x, y, [255, 230, 140], 1, 20, { life: 0.25 }); }
      ctx.save(); ctx.translate(x, y); ctx.rotate(ROT[p.lastDir]); ctx.scale(s, s);
      if (p.dashT > 0) { ctx.shadowColor = '#ffd24f'; ctx.shadowBlur = 14; }
      GC.drawShip(ctx, p.skin ? p.skin.ship : 'dart', rgb(p.color), p.id === hid ? '#fff' : '#0a0d18');
      ctx.restore();
      if (p.frozenT > 0) {
        const sz = 9 + Math.sin(T * 30) * 1;
        ctx.fillStyle = 'rgba(190,233,255,0.25)'; ctx.fillRect(x - sz, y - sz, sz * 2, sz * 2);
        ctx.strokeStyle = '#bfe9ff'; ctx.lineWidth = 2; ctx.strokeRect(x - sz, y - sz, sz * 2, sz * 2);
        ctx.beginPath(); ctx.moveTo(x - sz, y - sz); ctx.lineTo(x + sz, y + sz); ctx.moveTo(x + sz, y - sz); ctx.lineTo(x - sz, y + sz); ctx.stroke();
      }
      ctx.fillStyle = rgb(p.color, 0.95); ctx.font = 'bold 10px Consolas, monospace'; ctx.textAlign = 'center';
      ctx.fillText(p.name, x, y - 12);
      const crowned = m.crown === p.id;
      if (crowned) { // the leader wears the crown
        const cy0 = y - 24 + Math.sin(T * 4) * 1.5;
        ctx.save(); ctx.shadowColor = '#ffd24f'; ctx.shadowBlur = 8; ctx.fillStyle = '#ffd24f';
        ctx.beginPath(); ctx.moveTo(x - 7, cy0 + 4); ctx.lineTo(x - 7, cy0 - 3); ctx.lineTo(x - 3.5, cy0); ctx.lineTo(x, cy0 - 5); ctx.lineTo(x + 3.5, cy0); ctx.lineTo(x + 7, cy0 - 3); ctx.lineTo(x + 7, cy0 + 4); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      // active ability tag, so a sudden speed-up or a bounce is never a mystery
      const tagText = p.frozenT > 0 ? 'FROZEN' : p.dashT > 0 ? 'DASH' : p.shieldT > 0 ? 'SHIELD' : p.slowT > 0 ? 'SLOWED' : null;
      if (tagText) {
        const col = { FROZEN: '#bfe9ff', DASH: '#ffd24f', SHIELD: '#ffffff', SLOWED: '#ff9d3c' }[tagText];
        ctx.font = 'bold 9px Consolas, monospace';
        const w = ctx.measureText(tagText).width + 6, ps = 1 + 0.08 * Math.sin(T * 12);
        ctx.save(); ctx.translate(x, y - (crowned ? 38 : 28)); ctx.scale(ps, ps);
        ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(-w / 2, -5, w, 11);
        ctx.fillStyle = col; ctx.fillText(tagText, 0, 3.5);
        ctx.restore();
      }
    }

    // ---------- fx layers ----------
    function drawFx() {
      for (const r of fx.rings) {
        const u = (T - r.t0) / r.life; if (u < 0) continue;
        ctx.globalAlpha = 1 - u; ctx.strokeStyle = r.color; ctx.lineWidth = Math.max(0.5, r.width * (1 - u));
        ctx.beginPath(); ctx.arc(r.x, r.y, Math.max(0.5, r.r0 + (r.r1 - r.r0) * easeOut(u)), 0, Math.PI * 2); ctx.stroke();
      }
      for (const b of fx.beams) {
        const u = (T - b.t0) / b.life;
        ctx.globalAlpha = 1 - u; ctx.strokeStyle = b.color; ctx.lineWidth = 4 * (1 - u) + 1;
        ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      }
      for (const q of fx.particles) {
        ctx.globalAlpha = 1 - q.t / q.life; ctx.fillStyle = typeof q.color === 'string' ? q.color : rgb(q.color);
        ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      for (const q of fx.popups) {
        const u = (T - q.t0) / q.life; if (u < 0) continue;
        const s = u < 0.18 ? Math.max(0.01, easeOutBack(u / 0.18)) : 1;
        ctx.save();
        ctx.globalAlpha = u > 0.65 ? Math.max(0, 1 - (u - 0.65) / 0.35) : 1;
        ctx.translate(q.x, q.y - q.rise * easeOut(clamp01(u))); ctx.scale(s, s);
        ctx.font = `bold ${q.size}px Consolas, monospace`;
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(q.text, 0, 0);
        ctx.fillStyle = q.color; ctx.fillText(q.text, 0, 0);
        ctx.restore();
      }
      const a = fx.announce;
      if (a) {
        const u = (T - a.t0) / a.life;
        const s = u < 0.12 ? 2.4 - 1.4 * easeOut(u / 0.12) : 1 + 0.03 * Math.sin(T * 8);
        ctx.save();
        ctx.globalAlpha = u > 0.75 ? Math.max(0, 1 - (u - 0.75) / 0.25) : clamp01(u / 0.08);
        ctx.translate(PW / 2, PH * 0.3); ctx.scale(s, s);
        ctx.font = 'bold 46px Consolas, monospace'; ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(a.text, 0, 0); ctx.fillStyle = a.color; ctx.fillText(a.text, 0, 0);
        if (a.sub) { ctx.font = 'bold 17px Consolas, monospace'; ctx.lineWidth = 4; ctx.strokeText(a.sub, 0, 36); ctx.fillStyle = '#fff'; ctx.fillText(a.sub, 0, 36); }
        ctx.restore();
      }
      ctx.textBaseline = 'alphabetic';
    }

    function draw(m, hid = -1) {
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      if (fx.shake) ctx.translate((Math.random() * 2 - 1) * fx.shake, (Math.random() * 2 - 1) * fx.shake);
      ctx.drawImage(bg, 0, 0);
      if (m) {
        drawGrid(m, hid);
        ctx.drawImage(gridCv, 0, 0, PW, PH);
        drawOrbs(m);
        for (const p of m.players) if (p.alive) drawPlayer(p, m, hid);
        const you = m.players[hid];
        if (preview && you && you.alive && you.drawing) {
          const lx = cx(you.x), ly = cx(you.y) + 22;
          ctx.font = 'bold 13px Consolas, monospace'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          const txt = `+${preview.pct.toFixed(1)}%`;
          ctx.strokeText(txt, lx, ly); ctx.fillStyle = light(you.color); ctx.fillText(txt, lx, ly);
        }
      }
      drawFx();
      ctx.restore();
      if (danger > 0.05) { // red edges when your line is in danger
        const a = danger * (0.25 + 0.2 * Math.sin(T * (6 + 10 * danger)));
        const gr = ctx.createRadialGradient(PW / 2, PH / 2, PH * 0.35, PW / 2, PH / 2, PW * 0.65);
        gr.addColorStop(0, 'rgba(255,30,40,0)'); gr.addColorStop(1, `rgba(255,30,40,${a})`);
        ctx.fillStyle = gr; ctx.fillRect(0, 0, PW, PH);
      }
    }

    function drawOrbs(m) {
      for (const b of m.orbs) {
        const x = cx(b.x), y = cx(b.y), big = b.kind === 'surge';
        const s = Math.max(0.01, easeOutBack(clamp01((m.time - b.t0) / 0.4))) * (1 + 0.15 * Math.sin(T * 6 + b.x));
        const col = big ? '#ffd24f' : '#b06bff', r = big ? 7 : 5;
        ctx.save(); ctx.translate(x, y); ctx.rotate(T * 2); ctx.scale(s, s);
        ctx.shadowColor = col; ctx.shadowBlur = 12;
        ctx.fillStyle = col; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }

    // ---------- screens ----------
    function banner(title, sub, lines = []) {
      const h = 110 + lines.length * 22;
      ctx.fillStyle = 'rgba(2,4,12,0.75)'; ctx.fillRect(0, PH / 2 - h / 2, PW, h);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.font = 'bold 38px Consolas, monospace'; ctx.fillText(title, PW / 2, PH / 2 - h / 2 + 40);
      ctx.fillStyle = '#9fd8ff'; ctx.font = '17px Consolas, monospace'; ctx.fillText(sub, PW / 2, PH / 2 - h / 2 + 76);
      ctx.font = '15px Consolas, monospace';
      lines.forEach((l, i) => { ctx.fillStyle = l.color || '#ffd24f'; ctx.fillText(l.text || l, PW / 2, PH / 2 - h / 2 + 104 + i * 22); });
      ctx.textBaseline = 'alphabetic';
    }

    function countdown(t) {
      const n = 3 - Math.floor(t), u = t % 1;
      ctx.save();
      ctx.fillStyle = `rgba(2,4,12,${0.45 * (1 - u * 0.3)})`; ctx.fillRect(0, 0, PW, PH);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = 1 - Math.max(0, (u - 0.6) / 0.4);
      ctx.translate(PW / 2, PH / 2 - 10);
      const s = 2.6 - 1.6 * easeOut(Math.min(1, u / 0.35));
      ctx.scale(s, s);
      ctx.font = 'bold 90px Consolas, monospace'; ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(String(n), 0, 0); ctx.fillStyle = ['#ff5a5a', '#ffd24f', '#9ff'][3 - n] || '#fff'; ctx.fillText(String(n), 0, 0);
      ctx.restore();
      ctx.textAlign = 'center'; ctx.fillStyle = '#cfe3ff'; ctx.font = 'bold 18px Consolas, monospace';
      ctx.fillText(`GET READY - FIRST TO ${cfg.winPercent}% WINS`, PW / 2, PH / 2 + 80);
      ctx.textBaseline = 'alphabetic';
    }

    // dims the attract match behind the menu
    function drawTitle() {
      const gr = ctx.createLinearGradient(0, 0, 0, PH);
      gr.addColorStop(0, 'rgba(3,4,10,0.78)'); gr.addColorStop(0.5, 'rgba(3,4,10,0.5)'); gr.addColorStop(1, 'rgba(3,4,10,0.8)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, PW, PH);
    }

    return {
      draw, drawTitle, banner, countdown, fxEvents, announce, burst, popup, update, ctx, PW, PH, CELL,
      setPreview(mask, info) { previewMask = info ? mask : null; preview = info; },
      setDanger(v) { danger = v; },
      setOptions(o) { Object.assign(opt, o); },
    };
  };
})();
